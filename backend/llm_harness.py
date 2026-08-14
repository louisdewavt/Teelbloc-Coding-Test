import os
import time
import subprocess
import json
import tempfile
import traceback
from groq import Groq
import sys

# Add pushworld path for validation
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "pushworld", "python3", "src"))
# pyrefly: ignore [missing-import]
from pushworld.puzzle import PushWorldPuzzle, Actions

def extract_python_code(text: str) -> str:
    """Extracts python code from markdown block if present."""
    if "```python" in text:
        start = text.find("```python") + 9
        end = text.find("```", start)
        if end != -1:
            return text[start:end].strip()
    elif "```" in text:
        start = text.find("```") + 3
        end = text.find("```", start)
        if end != -1:
            return text[start:end].strip()
    return text.strip()

SYSTEM_PROMPT = """You are an expert Python programmer and AI solver for PushWorld.
PushWorld is a sokoban-like puzzle. You will be given the ASCII representation of a puzzle.
Your task is to write a self-contained Python script to solve it.

The script must define a function:
`def solve(puzzle_text: str) -> str:`
which returns a string of actions containing only the characters 'U', 'D', 'L', 'R' (Up, Down, Left, Right).

Puzzle ASCII Rules:
- The puzzle is a grid where each cell's token is separated by spaces.
- 'W': wall
- 'A': agent (the pusher)
- 'AW': agent-only wall
- 'M0', 'M1', etc.: movable objects (parts of a multi-block object share the same ID)
- 'G0', 'G1', etc.: goal positions for the corresponding movable objects
- '.': empty space

To parse the puzzle correctly without string index errors, use this snippet:
```python
def parse_puzzle(puzzle_text):
    return [line.split() for line in puzzle_text.strip().splitlines() if line.strip()]
```
Your code must be clean, use no external libraries except standard ones, and be computationally efficient.
Output ONLY the python code inside a ```python ``` block. Do not use input() or print() for interaction, only define the solve function.
"""

async def solve_with_llm(puzzle_name: str, puzzle_file_path: str, max_iterations: int = 5):
    """
    Async generator that yields SSE JSON strings containing progress.
    """
    client = Groq()
    
    with open(puzzle_file_path, "r") as f:
        puzzle_text = f.read()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Please write a python script to solve this puzzle:\n\n{puzzle_text}\n\nRemember to define `def solve(puzzle_text: str) -> str:`."}
    ]
    
    for i in range(1, max_iterations + 1):
        yield "data: " + json.dumps({"iteration": i, "status": "thinking", "message": f"Asking Groq (Iteration {i}/{max_iterations})..."}) + "\n\n"
        
        max_retries = 4
        retry_delay = 2
        reply = None
        for attempt in range(max_retries):
            try:
                response = client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=messages,
                    temperature=0.7,
                )
                reply = response.choices[0].message.content
                # Add the assistant's reply to the conversation history
                messages.append({"role": "assistant", "content": reply})
                break
            except Exception as e:
                error_str = str(e)
                if "503" in error_str or "429" in error_str:
                    if attempt < max_retries - 1:
                        yield "data: " + json.dumps({"iteration": i, "status": "thinking", "message": f"Server busy. Retrying in {retry_delay}s... (Attempt {attempt+1}/{max_retries})"}) + "\n\n"
                        time.sleep(retry_delay)
                        retry_delay *= 2
                        continue
                yield "data: " + json.dumps({"iteration": i, "status": "error", "message": f"API Error: {error_str}"}) + "\n\n"
                break
                
        if reply is None:
            break
            
        code = extract_python_code(reply)
        yield "data: " + json.dumps({"iteration": i, "status": "testing", "code": code, "message": "Executing generated code..."}) + "\n\n"
        
        # Create a temporary sandbox file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as temp_script:
            temp_script.write(code)
            temp_script.write("\n\n")
            temp_script.write("if __name__ == '__main__':\n")
            temp_script.write("    import sys\n")
            temp_script.write("    with open(sys.argv[1], 'r') as f:\n")
            temp_script.write("        print(solve(f.read()))\n")
            temp_script_name = temp_script.name

        try:
            # Run the sandbox
            proc = subprocess.run(
                [sys.executable, temp_script_name, puzzle_file_path],
                capture_output=True,
                text=True,
                timeout=15
            )
            stdout = proc.stdout.strip()
            stderr = proc.stderr.strip()
            
            if proc.returncode != 0:
                error_msg = f"Execution failed with return code {proc.returncode}.\nStderr: {stderr}\nStdout: {stdout}"
                yield "data: " + json.dumps({"iteration": i, "status": "failed", "message": "Execution Error", "details": error_msg}) + "\n\n"
                messages.append({"role": "user", "content": f"Your code failed to execute. Here is the error:\n```\n{error_msg}\n```\nPlease fix the code and try again."})
                continue
                
            # If execution succeeds, validate the plan natively
            valid_lines = [line.strip() for line in stdout.split('\n') if set(line.strip()).issubset(set("UDLR")) and len(line.strip()) > 0]
            if not valid_lines:
                error_msg = f"Your code returned an invalid plan string (must be only U,D,L,R and non-empty). Output was: {stdout[:100]}"
                yield "data: " + json.dumps({"iteration": i, "status": "failed", "message": "Invalid Output", "details": error_msg}) + "\n\n"
                messages.append({"role": "user", "content": f"Your code executed successfully but the output is invalid.\n```\n{error_msg}\n```\nPlease fix the code."})
                continue
            plan = valid_lines[-1]
                
            # Validate plan using PushWorld native logic
            try:
                p = PushWorldPuzzle(puzzle_file_path)
                s = p.initial_state
                failed_at = -1
                for idx, char in enumerate(plan):
                    action = Actions.FROM_CHAR[char]
                    s = p.get_next_state(s, action)
                    # Note: we might want to track if state didn't change (hit a wall)
                    
                if p.is_goal_state(s):
                    yield "data: " + json.dumps({"iteration": i, "status": "success", "plan": plan, "message": "Goal reached!"}) + "\n\n"
                    break
                else:
                    error_msg = f"The plan of length {len(plan)} executed but did not reach the goal state."
                    yield "data: " + json.dumps({"iteration": i, "status": "failed", "message": "Logical Error", "details": error_msg}) + "\n\n"
                    messages.append({"role": "user", "content": f"Your generated plan ({plan[:20]}...) does not solve the puzzle. It stops at a non-goal state.\nPlease fix your algorithm."})
                    continue
            except Exception as e:
                error_msg = f"Error during plan validation: {str(e)}"
                yield "data: " + json.dumps({"iteration": i, "status": "failed", "message": "Validation Error", "details": error_msg}) + "\n\n"
                messages.append({"role": "user", "content": f"Your plan caused a validation error: {error_msg}. Please fix the code."})
                continue
                
        except subprocess.TimeoutExpired:
            error_msg = "Code execution timed out after 15 seconds."
            yield "data: " + json.dumps({"iteration": i, "status": "failed", "message": "Timeout", "details": error_msg}) + "\n\n"
            messages.append({"role": "user", "content": "Your code timed out. Please write a more efficient algorithm."})
            continue
        finally:
            if os.path.exists(temp_script_name):
                os.remove(temp_script_name)
                
    else:
        yield "data: " + json.dumps({"iteration": max_iterations, "status": "max_iterations", "message": "Reached maximum iterations without success."}) + "\n\n"
