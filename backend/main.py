from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import glob
import sys
import time
from dotenv import load_dotenv

load_dotenv()

# Add backend directory and pushworld path to sys.path
sys.path.append(os.path.dirname(__file__))
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "pushworld", "python3", "src"))

from llm_harness import solve_with_llm
# pyrefly: ignore [missing-import]
from pushworld.puzzle import PushWorldPuzzle
from solvers import solve_bfs, solve_dfs, solve_rgd, solve_rgd_heuristic

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PUZZLES_DIR = os.path.join(os.path.dirname(__file__), "..", "pushworld", "benchmark", "puzzles")

class SolveRequest(BaseModel):
    level: str
    name: str
    algorithm: str # bfs, dfs, rgd

@app.get("/api/puzzles")
def get_puzzles():
    levels = ["level1", "level2", "level3", "level4"]
    result = {}
    for lvl in levels:
        lvl_dir = os.path.join(PUZZLES_DIR, lvl)
        if os.path.exists(lvl_dir):
            files = glob.glob(os.path.join(lvl_dir, "*.pwp"))
            result[lvl] = [os.path.basename(f)[:-4] for f in files]
        else:
            result[lvl] = []
    return result

@app.get("/api/puzzles/{level}/{name}")
def get_puzzle_content(level: str, name: str):
    file_path = os.path.join(PUZZLES_DIR, level, f"{name}.pwp")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Puzzle not found")
    with open(file_path, "r") as f:
        content = f.read()
    return {"content": content}

@app.post("/api/solve")
def solve_puzzle(req: SolveRequest):
    file_path = os.path.join(PUZZLES_DIR, req.level, f"{req.name}.pwp")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Puzzle not found")
        
    try:
        puzzle = PushWorldPuzzle(file_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse puzzle: {str(e)}")
        
    start_time = time.time()
    if req.algorithm.lower() == "bfs":
        res = solve_bfs(puzzle)
    elif req.algorithm.lower() == "dfs":
        res = solve_dfs(puzzle)
    elif req.algorithm.lower() == "rgd":
        res = solve_rgd_heuristic(puzzle)
    else:
        raise HTTPException(status_code=400, detail="Invalid algorithm")
        
    res["algorithm"] = req.algorithm
    res["puzzle"] = req.name
    return res

@app.get("/api/llm/solve")
async def api_llm_solve(level: str, name: str):
    puzzle_path = os.path.join(PUZZLES_DIR, level, f"{name}.pwp")
            
    if not os.path.exists(puzzle_path):
        raise HTTPException(status_code=404, detail=f"Puzzle '{name}' not found")
        
    return StreamingResponse(solve_with_llm(name, puzzle_path), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
