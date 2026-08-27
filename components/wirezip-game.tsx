"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";

type Cell = { row: number; col: number };
type Wall = { r1: number; c1: number; r2: number; c2: number };
type Puzzle = {
  size: number;
  numbers: { row: number; col: number; value: number }[];
  walls: Wall[];
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generatePuzzle(seed: number): Puzzle {
  const rng = mulberry32(seed);
  const size = 6;
  const total = size * size;

  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const visited = Array.from({ length: size }, () => Array(size).fill(false));
  const hamPath: Cell[] = [];

  function dfs(r: number, c: number): boolean {
    visited[r][c] = true;
    hamPath.push({ row: r, col: c });
    if (hamPath.length === total) return true;
    const shuffled = [...dirs].sort(() => rng() - 0.5);
    for (const [dr, dc] of shuffled) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && !visited[nr][nc]) {
        if (dfs(nr, nc)) return true;
      }
    }
    visited[r][c] = false;
    hamPath.pop();
    return false;
  }

  const startR = Math.floor(rng() * size);
  const startC = Math.floor(rng() * size);
  dfs(startR, startC);

  const numCount = 5 + Math.floor(rng() * 3);
  const step = Math.floor(total / (numCount + 1));
  const numbers: Puzzle["numbers"] = [];
  for (let i = 0; i < numCount; i++) {
    const idx = step * (i + 1);
    if (idx < total) {
      numbers.push({ row: hamPath[idx].row, col: hamPath[idx].col, value: i + 1 });
    }
  }

  const walls: Wall[] = [];
  const wallCount = 3 + Math.floor(rng() * 5);
  for (let w = 0; w < wallCount; w++) {
    const r = Math.floor(rng() * size);
    const c = Math.floor(rng() * size);
    const horizontal = rng() > 0.5;
    if (horizontal && r < size - 1) {
      walls.push({ r1: r, c1: c, r2: r + 1, c2: c });
    } else if (!horizontal && c < size - 1) {
      walls.push({ r1: r, c1: c, r2: r, c2: c + 1 });
    }
  }

  return { size, numbers, walls };
}

function cellKey(r: number, c: number) {
  return `${r},${c}`;
}

function hasWall(walls: Wall[], r1: number, c1: number, r2: number, c2: number) {
  return walls.some(
    (w) =>
      (w.r1 === r1 && w.c1 === c1 && w.r2 === r2 && w.c2 === c2) ||
      (w.r1 === r2 && w.c1 === c2 && w.r2 === r1 && w.c2 === c1)
  );
}

const INITIAL_SEED = 1;

export default function WireZipGame() {
  const [puzzleSeed, setPuzzleSeed] = useState(INITIAL_SEED);
  const puzzle = useMemo(() => generatePuzzle(puzzleSeed), [puzzleSeed]);
  const { size, numbers, walls } = puzzle;

  const numberMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of numbers) {
      map.set(cellKey(n.row, n.col), n.value);
    }
    return map;
  }, [numbers]);

  const maxNumber = useMemo(() => Math.max(...numbers.map((n) => n.value)), [numbers]);

  const [path, setPath] = useState<Cell[]>([]);
  const [won, setWon] = useState(false);
  const [moves, setMoves] = useState(0);

  const drawingRef = useRef(false);
  const pathRef = useRef<Cell[]>([]);
  useEffect(() => { pathRef.current = path; }, [path]);

  const pathSet = useMemo(() => new Set(path.map((c) => cellKey(c.row, c.col))), [path]);

  const checkWin = useCallback((p: Cell[]) => {
    if (p.length !== size * size) return false;
    let prevNum = 0;
    for (const cell of p) {
      const n = numberMap.get(cellKey(cell.row, cell.col));
      if (n !== undefined) {
        if (n !== prevNum + 1) return false;
        prevNum = n;
      }
    }
    return prevNum === maxNumber;
  }, [size, numberMap, maxNumber]);

  const tryAddCell = useCallback(
    (row: number, col: number) => {
      const p = pathRef.current;
      const key = cellKey(row, col);
      const existingIdx = p.findIndex((c) => cellKey(c.row, c.col) === key);
      if (existingIdx >= 0) {
        if (existingIdx === p.length - 1) return;
        const trimmed = p.slice(0, existingIdx + 1);
        pathRef.current = trimmed;
        setPath(trimmed);
        return;
      }
      if (p.length === 0) {
        pathRef.current = [{ row, col }];
        setPath([{ row, col }]);
        setMoves(1);
        return;
      }
      const last = p[p.length - 1];
      if (Math.abs(last.row - row) + Math.abs(last.col - col) !== 1) return;
      if (hasWall(walls, last.row, last.col, row, col)) return;
      const newPath = [...p, { row, col }];
      pathRef.current = newPath;
      setPath(newPath);
      setMoves((m) => m + 1);
      if (checkWin(newPath)) setWon(true);
    },
    [walls, checkWin]
  );

  const handlePointerDown = useCallback(
    (row: number, col: number) => {
      if (won) return;
      drawingRef.current = true;
      const p = pathRef.current;
      const key = cellKey(row, col);
      const idx = p.findIndex((c) => cellKey(c.row, c.col) === key);
      if (idx >= 0 && idx < p.length - 1) {
        const trimmed = p.slice(0, idx + 1);
        pathRef.current = trimmed;
        setPath(trimmed);
        return;
      }
      if (p.length === 0) tryAddCell(row, col);
    },
    [won, tryAddCell]
  );

  const handlePointerEnter = useCallback(
    (row: number, col: number) => {
      if (!drawingRef.current || won) return;
      tryAddCell(row, col);
    },
    [won, tryAddCell]
  );

  const handlePointerUp = useCallback(() => {
    drawingRef.current = false;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!drawingRef.current || won) return;
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el instanceof HTMLElement) {
        const r = parseInt(el.dataset.row ?? "-1");
        const c = parseInt(el.dataset.col ?? "-1");
        if (r >= 0 && c >= 0) tryAddCell(r, c);
      }
    },
    [won, tryAddCell]
  );

  const clearPath = useCallback(() => {
    pathRef.current = [];
    drawingRef.current = false;
    setPath([]);
    setWon(false);
    setMoves(0);
  }, []);

  const undo = useCallback(() => {
    setPath((prev) => {
      const next = prev.slice(0, -1);
      pathRef.current = next;
      return next;
    });
  }, []);

  const hint = useCallback(() => {
    const p = pathRef.current;
    if (p.length === 0) return;
    let lastNumIdx = -1;
    for (let i = p.length - 1; i >= 0; i--) {
      if (numberMap.has(cellKey(p[i].row, p[i].col))) {
        lastNumIdx = i;
        break;
      }
    }
    if (lastNumIdx >= 0) {
      const trimmed = p.slice(0, lastNumIdx + 1);
      pathRef.current = trimmed;
      setPath(trimmed);
    } else {
      pathRef.current = [];
      setPath([]);
    }
  }, [numberMap]);

  const newPuzzle = useCallback(() => {
    setPuzzleSeed((prev) => prev + 1);
    clearPath();
  }, [clearPath]);

  return (
    <div className="wirezip">
      <div className="wirezip-header">
        <div className="wirezip-title-row">
          <svg className="wirezip-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#049fd9" strokeWidth="2">
            <path d="M12 2v6m0 8v6M2 12h6m8 0h6" strokeLinecap="round" />
            <circle cx="12" cy="12" r="3" fill="#049fd9" stroke="none" />
          </svg>
          <span className="wirezip-title">Wire Zip</span>
        </div>
        <div className="wirezip-stats-row">
          <span className="wirezip-stat">
            <span className="wirezip-stat-label">Moves</span>
            <span className="wirezip-stat-value">{moves}</span>
          </span>
          <span className="wirezip-stat">
            <span className="wirezip-stat-label">Filled</span>
            <span className="wirezip-stat-value">{pathSet.size}/{size * size}</span>
          </span>
        </div>
      </div>

      <div className="wirezip-grid-wrap">
        <div
          className="wirezip-grid"
          style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onTouchMove={handleTouchMove}
        >
          {Array.from({ length: size }, (_, r) =>
            Array.from({ length: size }, (_, c) => {
              const key = cellKey(r, c);
              const num = numberMap.get(key);
              const inPath = pathSet.has(key);
              const pathIdx = path.findIndex((p) => p.row === r && p.col === c);
              const isFirst = pathIdx === 0;
              const isLast = pathIdx === path.length - 1 && pathIdx >= 0;

              const wallTop = r > 0 && hasWall(walls, r, c, r - 1, c);
              const wallBottom = r < size - 1 && hasWall(walls, r, c, r + 1, c);
              const wallLeft = c > 0 && hasWall(walls, r, c, r, c - 1);
              const wallRight = c < size - 1 && hasWall(walls, r, c, r, c + 1);

              return (
                <div
                  key={key}
                  data-row={r}
                  data-col={c}
                  className={[
                    "wz-cell",
                    inPath ? "wz-active" : "",
                    num !== undefined ? "wz-node" : "",
                    isFirst ? "wz-start" : "",
                    isLast && !won ? "wz-end" : "",
                    won ? "wz-won" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    borderTop: wallTop ? "3px solid #049fd9" : undefined,
                    borderBottom: wallBottom ? "3px solid #049fd9" : undefined,
                    borderLeft: wallLeft ? "3px solid #049fd9" : undefined,
                    borderRight: wallRight ? "3px solid #049fd9" : undefined,
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handlePointerDown(r, c);
                  }}
                  onPointerEnter={() => handlePointerEnter(r, c)}
                >
                  {num !== undefined && <span className="wz-num">{num}</span>}
                </div>
              );
            })
          )}
        </div>
      </div>

      {won && (
        <div className="wirezip-win-banner">
          <span className="wirezip-win-icon">⚡</span>
          <span className="wirezip-win-text">Circuit Complete!</span>
          <span className="wirezip-win-sub">{moves} moves</span>
        </div>
      )}

      <div className="wirezip-controls">
        <button type="button" className="wz-btn" onClick={undo} disabled={path.length === 0 || won}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H8" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 6l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Undo
        </button>
        <button type="button" className="wz-btn" onClick={hint} disabled={path.length === 0 || won}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01" strokeLinecap="round"/></svg>
          Hint
        </button>
        <button type="button" className="wz-btn wz-btn-danger" onClick={clearPath} disabled={path.length === 0}>
          Clear
        </button>
        {won && (
          <button type="button" className="wz-btn wz-btn-accent" onClick={newPuzzle}>
            New Puzzle
          </button>
        )}
      </div>
    </div>
  );
}
