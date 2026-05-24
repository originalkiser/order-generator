import { useState, useRef, useEffect } from "react";
import { C, SNAKE_SIZES } from "../constants.js";

export function SnakeGame({ onClose }) {
  const COLS = 20, ROWS = 20;
  const [cellSize, setCellSize] = useState(16);
  const cellRef = useRef(16); // always fresh in interval callbacks
  useEffect(() => { cellRef.current = cellSize; draw(); }, [cellSize]); // eslint-disable-line
  const canvasRef = useRef();
  // All mutable game state lives in a ref so the interval callback always sees fresh values
  const stateRef = useRef({
    snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
    dir: { x: 1, y: 0 }, nextDir: { x: 1, y: 0 },
    food: { x: 4, y: 4 }, score: 0, gameOver: false, started: false,
  });
  const [display, setDisplay] = useState({ score: 0, gameOver: false, started: false });
  const [leaderboard, setLeaderboard] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ordergen_snake_lb") || "[]"); } catch { return []; }
  });
  const loopRef = useRef(null);

  const randomFood = (snake) => {
    let pos;
    do { pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; }
    while (snake.some(s => s.x === pos.x && s.y === pos.y));
    return pos;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const st = stateRef.current;
    const CS = cellRef.current;
    // Background
    ctx.fillStyle = "#0f1117";
    ctx.fillRect(0, 0, COLS * CS, ROWS * CS);
    // Grid dots
    ctx.fillStyle = "#3a4a6e";
    const dot = Math.floor(CS * 0.4);
    for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) ctx.fillRect(x * CS + dot, y * CS + dot, 2, 2);
    // Food
    ctx.fillStyle = "#e74c3c";
    ctx.beginPath();
    ctx.arc(st.food.x * CS + CS / 2, st.food.y * CS + CS / 2, CS / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    // Snake
    st.snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? "#4f8ef7" : i % 2 === 0 ? "#2a4a8a" : "#1e3570";
      const r = i === 0 ? Math.max(2, CS / 4) : Math.max(1, CS / 6);
      ctx.beginPath();
      ctx.roundRect(seg.x * CS + 1, seg.y * CS + 1, CS - 2, CS - 2, r);
      ctx.fill();
    });
    // Start screen
    if (!st.started) {
      ctx.fillStyle = "#0f1117cc";
      ctx.fillRect(0, 0, COLS * CS, ROWS * CS);
      ctx.fillStyle = "#4f8ef7";
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Press Start", COLS * CS / 2, ROWS * CS / 2 - 6);
      ctx.fillStyle = "#7a85a3";
      ctx.font = "10px monospace";
      ctx.fillText("Arrow keys or WASD", COLS * CS / 2, ROWS * CS / 2 + 10);
    }
  };

  const endGame = () => {
    const st = stateRef.current;
    st.gameOver = true;
    clearInterval(loopRef.current);
    // Leaderboard
    try {
      const lb = JSON.parse(localStorage.getItem("ordergen_snake_lb") || "[]");
      lb.push({ score: st.score, date: new Date().toLocaleDateString() });
      lb.sort((a, b) => b.score - a.score);
      const top = lb.slice(0, 7);
      localStorage.setItem("ordergen_snake_lb", JSON.stringify(top));
      setLeaderboard(top);
    } catch {}
    setDisplay({ score: st.score, gameOver: true, started: true });
    // Draw overlay
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const CS = cellRef.current;
      ctx.fillStyle = "#0f1117bb";
      ctx.fillRect(0, 0, COLS * CS, ROWS * CS);
      ctx.fillStyle = "#e74c3c";
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", COLS * CS / 2, ROWS * CS / 2 - 8);
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "11px monospace";
      ctx.fillText("Score: " + st.score, COLS * CS / 2, ROWS * CS / 2 + 8);
    }
  };

  const tick = () => {
    const st = stateRef.current;
    if (st.gameOver) return;
    st.dir = st.nextDir;
    const head = { x: st.snake[0].x + st.dir.x, y: st.snake[0].y + st.dir.y };
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS || st.snake.some(s => s.x === head.x && s.y === head.y)) {
      endGame(); return;
    }
    const ate = head.x === st.food.x && head.y === st.food.y;
    const newSnake = [head, ...st.snake];
    if (!ate) newSnake.pop();
    else { st.score++; st.food = randomFood(newSnake); }
    st.snake = newSnake;
    draw();
    setDisplay(d => ({ ...d, score: st.score }));
  };

  const startGame = () => {
    const st = stateRef.current;
    st.snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    st.dir = { x: 1, y: 0 }; st.nextDir = { x: 1, y: 0 };
    st.food = randomFood(st.snake);
    st.score = 0; st.gameOver = false; st.started = true;
    setDisplay({ score: 0, gameOver: false, started: true });
    clearInterval(loopRef.current);
    loopRef.current = setInterval(tick, 120);
    draw();
  };

  // Shared steer — called from keyboard, d-pad buttons, and swipe
  const steer = (nd) => {
    const st = stateRef.current;
    if (!st.started || st.gameOver) return;
    if (nd.x !== -st.dir.x || nd.y !== -st.dir.y) st.nextDir = nd;
  };

  useEffect(() => { draw(); return () => clearInterval(loopRef.current); }, []);// eslint-disable-line

  // Keyboard controls
  useEffect(() => {
    const D = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 } };
    const handler = (e) => { const nd = D[e.key]; if (nd) { e.preventDefault(); steer(nd); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);// eslint-disable-line

  // Touch detection (canvas swipe — always on)
  const touchStartRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onStart = (e) => { const t = e.touches[0]; touchStartRef.current = { x: t.clientX, y: t.clientY }; e.preventDefault(); };
    const onMove = (e) => {
      if (!touchStartRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartRef.current.x, dy = t.clientY - touchStartRef.current.y;
      if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
      if (Math.abs(dx) > Math.abs(dy)) steer({ x: dx > 0 ? 1 : -1, y: 0 });
      else steer({ x: 0, y: dy > 0 ? 1 : -1 });
      touchStartRef.current = { x: t.clientX, y: t.clientY };
      e.preventDefault();
    };
    const onEnd = () => { touchStartRef.current = null; };
    canvas.addEventListener("touchstart", onStart, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onEnd, { passive: false });
    return () => { canvas.removeEventListener("touchstart", onStart); canvas.removeEventListener("touchmove", onMove); canvas.removeEventListener("touchend", onEnd); };
  }, []);// eslint-disable-line

  // Control mode: "dpad" | "swipe" | "keyboard"
  const [ctrlMode, setCtrlMode] = useState("dpad");
  const swipeZoneRef = useRef(null);
  useEffect(() => {
    const zone = swipeZoneRef.current;
    if (!zone || ctrlMode !== "swipe") return;
    const onStart = (e) => { const t = e.touches[0]; touchStartRef.current = { x: t.clientX, y: t.clientY }; e.preventDefault(); };
    const onMove = (e) => {
      if (!touchStartRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartRef.current.x, dy = t.clientY - touchStartRef.current.y;
      if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
      if (Math.abs(dx) > Math.abs(dy)) steer({ x: dx > 0 ? 1 : -1, y: 0 });
      else steer({ x: 0, y: dy > 0 ? 1 : -1 });
      touchStartRef.current = { x: t.clientX, y: t.clientY };
      e.preventDefault();
    };
    const onEnd = () => { touchStartRef.current = null; };
    zone.addEventListener("touchstart", onStart, { passive: false });
    zone.addEventListener("touchmove", onMove, { passive: false });
    zone.addEventListener("touchend", onEnd, { passive: false });
    return () => { zone.removeEventListener("touchstart", onStart); zone.removeEventListener("touchmove", onMove); zone.removeEventListener("touchend", onEnd); };
  }, [ctrlMode]);// eslint-disable-line

  const medals = ["🥇", "🥈", "🥉", "4.", "5.", "6.", "7."];

  // Fullscreen
  const containerRef = useRef();
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  const swipeZoneH = Math.round(ROWS * cellSize * 0.65);
  const fsScale = isFullscreen
    ? Math.max(1, Math.min(
        (window.innerWidth * 0.92) / (COLS * cellSize),
        (window.innerHeight * 0.62) / (ROWS * cellSize + swipeZoneH)
      ))
    : 1;

  const dBtn = (lbl, nd) => (
    <button onPointerDown={(e) => { e.preventDefault(); steer(nd); }}
      style={{ width: 48, height: 48, borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation", fontFamily: "inherit" }}>
      {lbl}
    </button>
  );
  const modeBtn = (label, active, onClick) => (
    <button onClick={onClick} style={{ flex: 1, padding: "4px 0", borderRadius: 5, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer", border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accent + "33" : "transparent", color: active ? C.accent : C.muted }}>
      {label}
    </button>
  );
  const iconBtn = (title, label, onClick) => (
    <button onClick={onClick} title={title} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 3px" }}>{label}</button>
  );

  // Shared sub-sections
  const controlsSection = (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", width: COLS * cellSize }}>
        <button onClick={startGame} style={{ background: C.accent, border: "none", borderRadius: 5, color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: 12, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
          {display.started ? "↺ Restart" : "▶ Start"}
        </button>
        {display.gameOver && <span style={{ color: C.red, fontSize: 11, fontWeight: 700 }}>Game over!</span>}
      </div>
      <div style={{ display: "flex", gap: 4, width: COLS * cellSize }}>
        {modeBtn("D-Pad",    ctrlMode === "dpad",     () => setCtrlMode("dpad"))}
        {modeBtn("Swipe",    ctrlMode === "swipe",    () => setCtrlMode("swipe"))}
        {modeBtn("Keyboard", ctrlMode === "keyboard", () => setCtrlMode("keyboard"))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: COLS * cellSize }}>
        <span style={{ color: C.muted, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>Grid size:</span>
        <select value={cellSize} onChange={e => { const v = Number(e.target.value); setCellSize(v); cellRef.current = v; }}
          style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontFamily: "inherit", fontSize: 11, padding: "3px 6px", outline: "none", cursor: "pointer" }}>
          {SNAKE_SIZES.map(s => <option key={s.cell} value={s.cell}>{s.label}</option>)}
        </select>
      </div>
    </>
  );

  const leaderboardSection = leaderboard.length > 0 && (
    <div style={{ width: COLS * cellSize, borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 2 }}>
      <div style={{ color: C.muted, fontWeight: 700, fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>🏆 LEADERBOARD</div>
      <div style={{ display: "flex", justifyContent: "center", gap: 14, marginBottom: leaderboard.length > 3 ? 8 : 0 }}>
        {leaderboard.slice(0, 3).map((entry, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 16 }}>{medals[i]}</span>
            <span style={{ color: i === 0 ? C.accent : i === 1 ? C.text : C.muted, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{entry.score}</span>
            <span style={{ color: C.muted, fontSize: 9 }}>{entry.date}</span>
          </div>
        ))}
      </div>
      {leaderboard.length > 3 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
          {leaderboard.slice(3).map((entry, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: C.muted, fontSize: 10, fontWeight: 700, minWidth: 14 }}>{medals[i + 3]}</span>
              <span style={{ color: C.text, fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{entry.score}</span>
              <span style={{ color: C.muted, fontSize: 9 }}>{entry.date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef} style={{ background: isFullscreen ? C.bg : C.surface, border: isFullscreen ? "none" : `1px solid ${C.border}`, borderRadius: isFullscreen ? 0 : 12, padding: isFullscreen ? 0 : "16px 20px", marginBottom: isFullscreen ? 0 : 24, display: "flex", alignItems: "center", justifyContent: "center", minHeight: isFullscreen ? "100vh" : undefined }}>
      <div style={{ width: "fit-content", margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, transform: isFullscreen ? `scale(${fsScale})` : undefined, transformOrigin: "center center" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: COLS * cellSize }}>
          <span style={{ color: C.accent, fontWeight: 800, fontSize: 13, fontFamily: "monospace" }}>🐍 SNAKE · {display.score}</span>
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {iconBtn(isFullscreen ? "Exit fullscreen" : "Full screen", isFullscreen ? "⊠" : "⛶", toggleFullscreen)}
            {iconBtn("Close", "✕", onClose)}
          </div>
        </div>

        {/* In swipe mode: canvas + swipe zone are one connected block, controls go below */}
        {ctrlMode === "swipe" ? (
          <>
            {/* Canvas flush into swipe zone */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <canvas ref={canvasRef} width={COLS * cellSize} height={ROWS * cellSize}
                style={{ display: "block", borderRadius: "6px 6px 0 0", border: `1px solid ${C.border}`, borderBottom: "none", imageRendering: "pixelated", touchAction: "none" }} />
              <div ref={swipeZoneRef} style={{ width: COLS * cellSize, height: swipeZoneH, background: C.card, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 6px 6px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", touchAction: "none", userSelect: "none", gap: 8, cursor: "default" }}>
                <span style={{ fontSize: 36, lineHeight: 1 }}>👆</span>
                <span style={{ color: C.muted, fontSize: 13 }}>Swipe here to steer</span>
                <span style={{ color: C.border, fontSize: 11 }}>↑ ↓ ← →</span>
              </div>
            </div>
            {/* Controls below the swipe zone */}
            {controlsSection}
          </>
        ) : (
          <>
            {/* Controls above the d-pad / nothing (original layout) */}
            <canvas ref={canvasRef} width={COLS * cellSize} height={ROWS * cellSize}
              style={{ display: "block", borderRadius: 6, border: `1px solid ${C.border}`, imageRendering: "pixelated", touchAction: "none" }} />
            {controlsSection}
            {ctrlMode === "dpad" && (
              <div style={{ display: "grid", gridTemplateColumns: "48px 48px 48px", gridTemplateRows: "48px 48px 48px", gap: 5 }}>
                <div />{dBtn("▲", { x: 0, y: -1 })}<div />
                {dBtn("◄", { x: -1, y: 0 })}<div />{dBtn("►", { x: 1, y: 0 })}
                <div />{dBtn("▼", { x: 0, y: 1 })}<div />
              </div>
            )}
          </>
        )}

        {leaderboardSection}
      </div>
    </div>
  );
}
