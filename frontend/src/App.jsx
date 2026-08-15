import React, { useState, useEffect, useRef } from 'react';
import { convertFileToPushworld, move, isGoalState, drawCanvas } from './pushworld';

const BACKEND_URL = import.meta.env.PROD ? '' : 'http://127.0.0.1:8000';

function App() {
  const [puzzleList, setPuzzleList] = useState({ level1: [], level2: [], level3: [], level4: [] });
  const [selectedLevel, setSelectedLevel] = useState('level1');
  const [selectedPuzzleName, setSelectedPuzzleName] = useState(null);
  const [puzzleSpec, setPuzzleSpec] = useState(null);
  const [puzzleText, setPuzzleText] = useState('');
  const [currentState, setCurrentState] = useState([]);
  const [stateHistory, setStateHistory] = useState([]);
  const [moveHistory, setMoveHistory] = useState('');
  
  // Solver State
  const [selectedAlgorithm, setSelectedAlgorithm] = useState('bfs');
  const [solverRunning, setSolverRunning] = useState(false);
  const [solverResult, setSolverResult] = useState(null);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [playbackPlan, setPlaybackPlan] = useState('');
  const [viewTextMode, setViewTextMode] = useState(false);
  
  // LLM State
  const [llmMode, setLlmMode] = useState(false);
  const [llmEvents, setLlmEvents] = useState([]);
  const [llmRunning, setLlmRunning] = useState(false);

  const canvasRef = useRef(null);

  // Load puzzle list on mount
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/puzzles`)
      .then(res => res.json())
      .then(data => {
        setPuzzleList(data);
        if (data.level1 && data.level1.length > 0) {
          loadPuzzle('level1', data.level1[0]);
        }
      })
      .catch(err => console.error("Error loading puzzles:", err));
  }, []);

  // Load a specific puzzle
  const loadPuzzle = (level, name) => {
    setSelectedPuzzleName(name);
    setSolverResult(null);
    setPlaybackIndex(-1);
    setPlaybackPlan('');
    fetch(`${BACKEND_URL}/api/puzzles/${level}/${name}`)
      .then(res => res.json())
      .then(data => {
        const spec = convertFileToPushworld(name, data.content);
        setPuzzleSpec(spec);
        setPuzzleText(data.content);
        setCurrentState(spec.initial_state);
        setStateHistory([spec.initial_state]);
        setMoveHistory('');
        setViewTextMode(false);
      })
      .catch(err => console.error("Error loading puzzle content:", err));
  };

  // Keyboard navigation for manual play
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!puzzleSpec || solverRunning || playbackIndex !== -1) return;
      if (isGoalState(puzzleSpec, currentState)) return;

      const displacements = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const actionLabels = {
        ArrowUp: 'U',
        ArrowDown: 'D',
        ArrowLeft: 'L',
        ArrowRight: 'R',
      };

      if (e.key in displacements) {
        e.preventDefault();
        const [nextState, transitiveStopping] = move(
          puzzleSpec,
          currentState,
          displacements[e.key]
        );

        if (!transitiveStopping) {
          setCurrentState(nextState);
          setStateHistory(prev => [...prev, nextState]);
          setMoveHistory(prev => prev + actionLabels[e.key]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [puzzleSpec, currentState, solverRunning, playbackIndex]);

  // Redraw canvas whenever puzzle spec or state changes
  useEffect(() => {
    if (canvasRef.current && puzzleSpec && currentState.length > 0) {
      const ctx = canvasRef.current.getContext('2d');
      drawCanvas(ctx, puzzleSpec, currentState, true);
    }
  }, [puzzleSpec, currentState]);

  // Undo manual move
  const handleUndo = () => {
    if (stateHistory.length > 1) {
      const newHistory = stateHistory.slice(0, -1);
      setStateHistory(newHistory);
      setCurrentState(newHistory[newHistory.length - 1]);
      setMoveHistory(prev => prev.slice(0, -1));
    }
  };

  // Reset puzzle
  const handleReset = () => {
    if (puzzleSpec) {
      setCurrentState(puzzleSpec.initial_state);
      setStateHistory([puzzleSpec.initial_state]);
      setMoveHistory('');
      setPlaybackIndex(-1);
    }
  };

  // Trigger Backend Solver
  const handleSolve = () => {
    if (!selectedPuzzleName || !selectedLevel) return;
    setSolverRunning(true);
    setSolverResult(null);
    setPlaybackIndex(-1);

    fetch(`${BACKEND_URL}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: selectedLevel,
        name: selectedPuzzleName,
        algorithm: selectedAlgorithm
      })
    })
      .then(res => res.json())
      .then(data => {
        setSolverRunning(false);
        setSolverResult(data);
        if (data.status === 'success' && data.plan) {
          setPlaybackPlan(data.plan);
        }
      })
      .catch(err => {
        setSolverRunning(false);
        console.error("Solver error:", err);
      });
  };

  // LLM Solver SSE
  const handleSolveLLM = () => {
    if (!selectedPuzzleName || !selectedLevel) return;
    setLlmRunning(true);
    setLlmEvents([]);
    setPlaybackIndex(-1);
    setPlaybackPlan('');
    setSolverResult(null);

    const eventSource = new EventSource(`${BACKEND_URL}/api/llm/solve?level=${selectedLevel}&name=${selectedPuzzleName}`);
    
    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setLlmEvents(prev => [...prev, data]);
      
      if (data.status === 'success') {
        eventSource.close();
        setLlmRunning(false);
        setSolverResult({
          status: 'success',
          algorithm: 'LLM Agent',
          puzzle: selectedPuzzleName,
          plan: data.plan
        });
        setPlaybackPlan(data.plan);
      } else if (data.status === 'max_iterations' || data.status === 'error') {
        eventSource.close();
        setLlmRunning(false);
      }
    };
    
    eventSource.onerror = (e) => {
      console.error("EventSource failed", e);
      eventSource.close();
      setLlmRunning(false);
    };
  };

  // Playback logic for Solver solution
  useEffect(() => {
    if (playbackIndex === -1 || !playbackPlan || !puzzleSpec) return;

    const displacements = { 'U': [-1, 0], 'D': [1, 0], 'L': [0, -1], 'R': [0, 1] };
    const char = playbackPlan[playbackIndex];

    const timer = setTimeout(() => {
      const [nextState] = move(puzzleSpec, currentState, displacements[char]);
      setCurrentState(nextState);

      if (playbackIndex < playbackPlan.length - 1) {
        setPlaybackIndex(prev => prev + 1);
      } else {
        setPlaybackIndex(-1);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [playbackIndex, playbackPlan, puzzleSpec]);

  const startPlayback = () => {
    if (!playbackPlan) return;
    // Reset to start state first
    setCurrentState(puzzleSpec.initial_state);
    setPlaybackIndex(0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', padding: '24px', boxSizing: 'border-box' }}>
      {/* Header */}
      <header className="glass-panel" style={{ padding: '20px 30px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '800', background: 'linear-gradient(135deg, #a78bfa 0%, #6366f1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            PushWorld Explorer
          </h1>
          <p style={{ margin: '4px 0 0 0', color: '#9ca3af', fontSize: '14px' }}>
            A premium interface for Google DeepMind's manipulation planning benchmark
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {['level1', 'level2', 'level3', 'level4'].map(lvl => (
            <button
              key={lvl}
              onClick={() => { setSelectedLevel(lvl); loadPuzzle(lvl, puzzleList[lvl][0]); }}
              className={`glass-btn ${selectedLevel === lvl ? 'primary' : ''}`}
            >
              {lvl.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 380px', gap: '24px', flex: 1 }}>
        {/* Left: Puzzle list browser */}
        <section className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 190px)', overflowY: 'auto' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 16px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
            Select Puzzle
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {puzzleList[selectedLevel]?.map(name => (
              <button
                key={name}
                onClick={() => loadPuzzle(selectedLevel, name)}
                className="glass-btn"
                style={{
                  justifyContent: 'flex-start',
                  width: '100%',
                  borderColor: selectedPuzzleName === name ? '#6366f1' : 'transparent',
                  background: selectedPuzzleName === name ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.02)'
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </section>

        {/* Center: Play Area */}
        <section className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: '700' }}>
            {selectedPuzzleName || 'No Puzzle Selected'}
          </h2>
          
          <div style={{ position: 'relative', width: '100%', maxWidth: '500px', display: 'flex', justifyContent: 'center' }}>
            {viewTextMode ? (
              <pre style={{
                width: '100%',
                background: '#070b19',
                color: '#a78bfa',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                overflowX: 'auto',
                fontSize: '13px',
                lineHeight: '1.4',
                maxHeight: '400px',
                overflowY: 'auto'
              }}>
                {puzzleText}
              </pre>
            ) : (
              <canvas
                ref={canvasRef}
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  background: '#070b19'
                }}
              />
            )}
            {!viewTextMode && puzzleSpec && isGoalState(puzzleSpec, currentState) && (
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(3, 7, 18, 0.85)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                borderRadius: '12px',
                animation: 'fadeIn 0.5s ease'
              }}>
                <h2 style={{ color: '#10b981', fontSize: '32px', margin: '0 0 8px 0', fontWeight: '800' }}>PUZZLE SOLVED!</h2>
                <p style={{ color: '#9ca3af', margin: '0 0 16px 0' }}>{playbackPlan ? `Solved by ${selectedAlgorithm.toUpperCase()}` : 'Solved manually!'}</p>
                <button className="glass-btn primary" onClick={handleReset}>Play Again</button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '20px' }}>
            <button className="glass-btn" onClick={() => setViewTextMode(!viewTextMode)}>
              {viewTextMode ? 'View Grid' : 'View Text'}
            </button>
            <button className="glass-btn" onClick={handleUndo} disabled={stateHistory.length <= 1 || viewTextMode}>
              Undo
            </button>
            <button className="glass-btn danger" onClick={handleReset} disabled={viewTextMode}>
              Reset
            </button>
          </div>
        </section>

        {/* Right: Solvers & Stats */}
        <section className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Solver Controls */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Solvers</h2>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: '#a78bfa' }}>
                <input type="checkbox" checked={llmMode} onChange={e => setLlmMode(e.target.checked)} />
                LLM Agent Mode
              </label>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {!llmMode && (
                <div>
                  <label style={{ fontSize: '14px', color: '#9ca3af', display: 'block', marginBottom: '6px' }}>Select Algorithm</label>
                  <select
                    value={selectedAlgorithm}
                    onChange={(e) => setSelectedAlgorithm(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: '8px',
                      background: '#111827',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: '#f3f4f6',
                      outline: 'none'
                    }}
                  >
                    <option value="bfs">Breadth-First Search (BFS)</option>
                    <option value="dfs">Depth-First Search (DFS)</option>
                    <option value="rgd">Recursive Graph Distance (RGD)</option>
                  </select>
                </div>
              )}

              <button
                className="glass-btn primary glow-active"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={llmMode ? handleSolveLLM : handleSolve}
                disabled={solverRunning || llmRunning}
              >
                {solverRunning || llmRunning ? 'Solving...' : (llmMode ? 'Generate Code & Solve' : `Solve with ${selectedAlgorithm.toUpperCase()}`)}
              </button>
            </div>
          </div>

          {/* LLM Status Panel */}
          {llmMode && llmEvents.length > 0 && (
            <div className="glass-panel" style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', maxHeight: '300px', overflowY: 'auto' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#a78bfa' }}>LLM Progress</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {llmEvents.map((evt, idx) => (
                  <div key={idx} style={{ paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '13px', color: evt.status === 'success' ? '#10b981' : evt.status.startsWith('fail') || evt.status === 'error' ? '#ef4444' : '#60a5fa' }}>
                        [{evt.status.toUpperCase()}] Iteration {evt.iteration}
                      </strong>
                    </div>
                    <p style={{ fontSize: '13px', margin: '0 0 6px 0', color: '#e5e7eb' }}>{evt.message}</p>
                    {evt.code && (
                      <pre style={{ fontSize: '11px', background: '#090d16', padding: '8px', borderRadius: '4px', overflowX: 'auto', margin: '4px 0', color: '#a78bfa' }}>
                        {evt.code}
                      </pre>
                    )}
                    {evt.details && (
                      <pre style={{ fontSize: '11px', background: '#2a1215', color: '#fca5a5', padding: '8px', borderRadius: '4px', overflowX: 'auto', margin: '4px 0' }}>
                        {evt.details}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Solver Results / Stats */}
          {solverResult && (
            <div className="glass-panel" style={{ padding: '16px', background: 'rgba(255,255,255,0.02)' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#a78bfa' }}>Search Statistics</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
                <div>
                  <span style={{ color: '#9ca3af', display: 'block' }}>Status</span>
                  <strong style={{ color: solverResult.status === 'success' ? '#10b981' : '#ef4444' }}>
                    {solverResult.status.toUpperCase()}
                  </strong>
                </div>
                <div>
                  <span style={{ color: '#9ca3af', display: 'block' }}>Elapsed Time</span>
                  <strong>{solverResult.elapsed_time?.toFixed(3)}s</strong>
                </div>
                <div>
                  <span style={{ color: '#9ca3af', display: 'block' }}>States Visited</span>
                  <strong>{solverResult.states_explored}</strong>
                </div>
                <div>
                  <span style={{ color: '#9ca3af', display: 'block' }}>Solution Steps</span>
                  <strong>{solverResult.plan ? solverResult.plan.length : 0}</strong>
                </div>
              </div>

              {solverResult.status === 'success' && solverResult.plan && (
                <button
                  className="glass-btn primary"
                  style={{ width: '100%', marginTop: '16px', justifyContent: 'center' }}
                  onClick={startPlayback}
                >
                  Animate Solution
                </button>
              )}
            </div>
          )}

          {/* Manual Play Info */}
          <div className="glass-panel" style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', marginTop: 'auto' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '15px' }}>Manual Movement</h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
              Use arrow keys (↑, ↓, ←, →) on your keyboard to navigate the green agent.
            </p>
            {moveHistory && (
              <div style={{ marginTop: '12px' }}>
                <span style={{ fontSize: '12px', color: '#9ca3af', display: 'block' }}>Path History</span>
                <code style={{ wordBreak: 'break-all', display: 'block', background: '#090d16', padding: '6px', borderRadius: '4px', marginTop: '4px', fontSize: '12px' }}>
                  {moveHistory}
                </code>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
