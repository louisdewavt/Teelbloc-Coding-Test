import sys
import os
import time
from collections import deque
import heapq
import subprocess

# Add pushworld path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "pushworld", "python3", "src"))
# pyrefly: ignore [missing-import]
from pushworld.puzzle import Actions, PushWorldPuzzle
# pyrefly: ignore [missing-import]
from pushworld.config import RGD_PLANNER_PATH

def get_action_char(action):
    for char, act in Actions.FROM_CHAR.items():
        if act == action:
            return char
    return "?"

def solve_bfs(puzzle: PushWorldPuzzle, time_limit=300):
    start_time = time.time()
    start_state = puzzle.initial_state
    
    if puzzle.is_goal_state(start_state):
        return {"status": "success", "plan": "", "states_explored": 0, "elapsed_time": 0.0}
    
    queue = deque([(start_state, [])])
    visited = {start_state}
    states_explored = 0
    
    last_update_time = time.time()
    
    while queue:
        # Check time limit
        elapsed_time = time.time() - start_time
        if elapsed_time > time_limit:
            return {"status": "timeout", "states_explored": states_explored, "elapsed_time": elapsed_time}
            
        state, path = queue.popleft()
        states_explored += 1
        
        # Periodic progress report hook can be added here
        if time.time() - last_update_time > 0.2:
            last_update_time = time.time()
            # We can use a callback or generator to stream this, but for now we return status periodically if used as generator.
            
        for action in range(4):
            next_state = puzzle.get_next_state(state, action)
            if next_state == state:
                continue # No movement
                
            if next_state not in visited:
                visited.add(next_state)
                new_path = path + [action]
                
                if puzzle.is_goal_state(next_state):
                    plan_str = "".join(get_action_char(a) for a in new_path)
                    return {
                        "status": "success",
                        "plan": plan_str,
                        "states_explored": states_explored,
                        "elapsed_time": time.time() - start_time
                    }
                queue.append((next_state, new_path))
                
    return {"status": "failure", "reason": "no solution exists", "states_explored": states_explored, "elapsed_time": time.time() - start_time}

def solve_dfs(puzzle: PushWorldPuzzle, time_limit=300):
    start_time = time.time()
    start_state = puzzle.initial_state
    
    if puzzle.is_goal_state(start_state):
        return {"status": "success", "plan": "", "states_explored": 0, "elapsed_time": 0.0}
    
    stack = [(start_state, [])]
    visited = {start_state}
    states_explored = 0
    
    while stack:
        elapsed_time = time.time() - start_time
        if elapsed_time > time_limit:
            return {"status": "timeout", "states_explored": states_explored, "elapsed_time": elapsed_time}
            
        state, path = stack.pop()
        states_explored += 1
        
        if puzzle.is_goal_state(state):
            plan_str = "".join(get_action_char(a) for a in path)
            return {
                "status": "success",
                "plan": plan_str,
                "states_explored": states_explored,
                "elapsed_time": elapsed_time
            }
            
        for action in range(4):
            next_state = puzzle.get_next_state(state, action)
            if next_state == state:
                continue
                
            if next_state not in visited:
                visited.add(next_state)
                stack.append((next_state, path + [action]))
                
    return {"status": "failure", "reason": "no solution exists", "states_explored": states_explored, "elapsed_time": time.time() - start_time}

# Simple Manhattan Distance / BFS Grid Heuristic for Greedy Best-First Search as an initial RGD implementation
def get_grid_distances_to_goals(puzzle: PushWorldPuzzle):
    # For each movable target object, find its goal and calculate shortest grid distance to it
    # neglecting other movable objects, but avoiding walls.
    width, height = puzzle.dimensions
    walls = puzzle.wall_positions
    
    distances = {}
    for i, goal_pos in enumerate(puzzle.goal_state):
        # run a BFS on grid to find distance from all cells to this goal
        dist = {goal_pos: 0}
        q = deque([goal_pos])
        while q:
            curr = q.popleft()
            curr_dist = dist[curr]
            x, y = curr
            for dx, dy in [(-1,0), (1,0), (0,-1), (0,1)]:
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in walls:
                    if (nx, ny) not in dist:
                        dist[(nx, ny)] = curr_dist + 1
                        q.append((nx, ny))
        distances[i] = dist
    return distances

def solve_rgd(puzzle: PushWorldPuzzle, file_path: str, time_limit=300):
    start_time = time.time()
    
    # Try C++ planner if exists
    if os.path.exists(RGD_PLANNER_PATH) or os.path.exists(RGD_PLANNER_PATH + ".exe"):
        planner_exe = RGD_PLANNER_PATH if os.path.exists(RGD_PLANNER_PATH) else RGD_PLANNER_PATH + ".exe"
        try:
            process = subprocess.run(
                [planner_exe, "N+RGD", file_path],
                capture_output=True,
                text=True,
                timeout=time_limit
            )
            out = process.stdout.strip()
            elapsed_time = time.time() - start_time
            if "NO SOLUTION" in out:
                return {"status": "failure", "reason": "no solution exists", "states_explored": "N/A (C++)", "elapsed_time": elapsed_time}
            elif puzzle.is_goal_state(puzzle.initial_state):
                return {"status": "success", "plan": "", "states_explored": "N/A (C++)", "elapsed_time": elapsed_time}
            elif set(out).issubset(set("UDLR")) and len(out) > 0:
                return {"status": "success", "plan": out, "states_explored": "N/A (C++)", "elapsed_time": elapsed_time}
            else:
                return {"status": "error", "reason": f"Unknown output: {out[:100]}", "states_explored": "N/A (C++)", "elapsed_time": elapsed_time}
        except subprocess.TimeoutExpired:
            return {"status": "timeout", "states_explored": "N/A (C++)", "elapsed_time": time_limit}
        except Exception as e:
            print(f"Error running C++ RGD: {e}", file=sys.stderr)
            
    # Fallback to python heuristic
    print("WARNING: C++ RGD planner not found or failed. Falling back to Python heuristic.", file=sys.stderr)
    return solve_rgd_heuristic(puzzle, time_limit)

def solve_rgd_heuristic(puzzle: PushWorldPuzzle, time_limit=300):
    """
    Greedy Best-First Search with static grid-distance heuristic.
    This acts as a solid Python-based heuristic planner.
    """
    start_time = time.time()
    start_state = puzzle.initial_state
    
    if puzzle.is_goal_state(start_state):
        return {"status": "success", "plan": "", "states_explored": 0, "elapsed_time": 0.0}
        
    grid_dists = get_grid_distances_to_goals(puzzle)
    
    def heuristic(state):
        # Sum of distances of each movable object to its goal
        h_val = 0
        for i in range(len(puzzle.goal_state)):
            obj_pos = state[1 + i] # state[0] is agent, state[1+i] are objects
            dist_map = grid_dists[i]
            h_val += dist_map.get(obj_pos, 9999)
        # Also add a small distance from agent to the objects to encourage agent to stay close
        agent_pos = state[0]
        min_agent_dist = 9999
        for i in range(len(puzzle.goal_state)):
            obj_pos = state[1 + i]
            if obj_pos != puzzle.goal_state[i]:
                dist = abs(agent_pos[0] - obj_pos[0]) + abs(agent_pos[1] - obj_pos[1])
                if dist < min_agent_dist:
                    min_agent_dist = dist
        if min_agent_dist != 9999:
            h_val += 0.1 * min_agent_dist
        return h_val

    # Priority queue: (h_val, state, path)
    counter = 0
    pq = [(heuristic(start_state), counter, start_state, [])]
    visited = {start_state}
    states_explored = 0
    
    while pq:
        elapsed_time = time.time() - start_time
        if elapsed_time > time_limit:
            return {"status": "timeout", "states_explored": states_explored, "elapsed_time": elapsed_time}
            
        h, _, state, path = heapq.heappop(pq)
        states_explored += 1
        
        if puzzle.is_goal_state(state):
            plan_str = "".join(get_action_char(a) for a in path)
            return {
                "status": "success",
                "plan": plan_str,
                "states_explored": states_explored,
                "elapsed_time": elapsed_time
            }
            
        for action in range(4):
            next_state = puzzle.get_next_state(state, action)
            if next_state == state:
                continue
                
            if next_state not in visited:
                visited.add(next_state)
                counter += 1
                heapq.heappush(pq, (heuristic(next_state), counter, next_state, path + [action]))
                
    return {"status": "failure", "reason": "no solution exists", "states_explored": states_explored, "elapsed_time": time.time() - start_time}
