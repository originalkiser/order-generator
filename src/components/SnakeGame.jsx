import { useState, useRef, useEffect } from "react";
import { SNAKE_SIZES } from "../constants.js";
import { useC } from "../context/theme.jsx";

export function SnakeGame({ onClose }) {
  const C = useC();
  const COLS = 20, ROWS = 20;

  const [cellSize, setCellSize] = useState(16);
  const cellRef = useRef(16);
  const [lightMode, setLightMode] = useState(false);
  const lightModeRef = useRef(false);

  useEffect(() => { cellRef.current = cellSize; draw(); }, [cellSize]); // eslint-disable-line
  useEffect(() => { lightModeRef.current = lightMode; draw(); }, [lightMode]); // eslint-disable-line

  const canvasRef = useRef();
  const stateRef = useRef({
    snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
    dir: { x: 1, y: 0 }, nextDir: { x: 1, y: 0 },
    food: { x: 4, y: 4 }, score: 0, gameOver: false, started: false,
  });
  const [display, setDisplay] = useState({ score: 0, gameOver: false, started: false });
  const [demoMode, setDemoMode] = useState(false);
  const demoModeRef = useRef(false);
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

  // Simple greedy AI for demo mode
  const getAiDir = () => {
    const st = stateRef.current;
    const head = st.snake[0];
    const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
    // Filter out reversals
    const possible = dirs.filter(d => d.x !== -st.dir.x || d.y !== -st.dir.y);
    // Filter collisions with walls and self (leave tail out — it will move)
    const safe = possible.filter(d => {
      const nx = head.x + d.x, ny = head.y + d.y;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return false;
      if (st.snake.slice(0, -1).some(s => s.x === nx && s.y === ny)) return false;
      return true;
    });
    if (!safe.length) return st.dir;
    // Score by Manhattan distance to food; small random factor prevents loops
    const scored = safe.map(d => ({
      dir: d,
      dist: Math.abs(head.x + d.x - st.food.x) + Math.abs(head.y + d.y - st.food.y) + Math.random() * 0.4,
    }));
    scored.sort((a, b) => a.dist - b.dist);
    return scored[0].dir;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const st = stateRef.current;
    const CS = cellRef.current;
    const light = lightModeRef.current;

    ctx.fillStyle = light ? "#f0f4f8" : "#0f1117";
    ctx.fillRect(0, 0, COLS * CS, ROWS * CS);

    ctx.fillStyle = light ? "#b8c4d8" : "#3a4a6e";
    const dot = Math.floor(CS * 0.4);
    for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++)
      ctx.fillRect(x * CS + dot, y * CS + dot, 2, 2);

    ctx.fillStyle = "#e74c3c";
    ctx.beginPath();
    ctx.arc(st.food.x * CS + CS / 2, st.food.y * CS + CS / 2, CS / 2 - 1, 0, Math.PI * 2);
    ctx.fill();

    st.snake.forEach((seg, i) => {
      ctx.fillStyle = light
        ? (i === 0 ? "#1a56d6" : i % 2 === 0 ? "#3470c8" : "#2258a8")
        : (i === 0 ? "#4f8ef7" : i % 2 === 0 ? "#2a4a8a" : "#1e3570");
      const r = i === 0 ? Math.max(2, CS / 4) : Math.max(1, CS / 6);
      ctx.beginPath();
      ctx.roundRect(seg.x * CS + 1, seg.y * CS + 1, CS - 2, CS - 2, r);
      ctx.fill();
    });
  };

  const endGame = (isDemo) => {
    const st = stateRef.current;
    st.gameOver = true;
    clearInterval(loopRef.current);

    if (isDemo) {
      // Auto-restart demo after a pause
      draw();
      setTimeout(() => { if (demoModeRef.current) startDemo(); }, 1800);
      return;
    }

    try {
      const lb = JSON.parse(localStorage.getItem("ordergen_snake_lb") || "[]");
      lb.push({ score: st.score, date: new Date().toLocaleDateString() });
      lb.sort((a, b) => b.score - a.score);
      const top = lb.slice(0, 7);
      localStorage.setItem("ordergen_snake_lb", JSON.stringify(top));
      setLeaderboard(top);
    } catch {}
    setDisplay({ score: st.score, gameOver: true, started: true });
    // Draw semi-transparent overlay — HTML handles the button/text
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const CS = cellRef.current;
      const light = lightModeRef.current;
      ctx.fillStyle = light ? "rgba(240,244,248,0.80)" : "rgba(15,17,23,0.75)";
      ctx.fillRect(0, 0, COLS * CS, ROWS * CS);
    }
  };

  const tick = () => {
    const st = stateRef.current;
    if (st.gameOver) return;
    const isDemo = demoModeRef.current;
    if (isDemo) {
      const aiDir = getAiDir();
      if (aiDir.x !== -st.dir.x || aiDir.y !== -st.dir.y) st.nextDir = aiDir;
    }
    st.dir = st.nextDir;
    const head = { x: st.snake[0].x + st.dir.x, y: st.snake[0].y + st.dir.y };
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS || st.snake.some(s => s.x === head.x && s.y === head.y)) {
      endGame(isDemo); return;
    }
    const ate = head.x === st.food.x && head.y === st.food.y;
    const newSnake = [head, ...st.snake];
    if (!ate) newSnake.pop();
    else { st.score++; st.food = randomFood(newSnake); }
    st.snake = newSnake;
    draw();
    setDisplay(d => ({ ...d, score: st.score }));
  };

  const startDemo = () => {
    demoModeRef.current = true;
    setDemoMode(true);
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

  const startGame = () => {
    demoModeRef.current = false;
    setDemoMode(false);
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

  const steer = (nd) => {
    const st = stateRef.current;
    if (!st.started || st.gameOver) return;
    if (demoModeRef.current) { startGame(); return; } // any steer in demo → take over
    if (nd.x !== -st.dir.x || nd.y !== -st.dir.y) st.nextDir = nd;
  };

  // Mount: draw idle state, then kick off demo after a short delay
  useEffect(() => {
    draw();
    const t = setTimeout(startDemo, 1400);
    return () => { clearTimeout(t); clearInterval(loopRef.current); };
  }, []); // eslint-disable-line

  useEffect(() => {
    const D = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 } };
    const handler = (e) => { const nd = D[e.key]; if (nd) { e.preventDefault(); steer(nd); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // eslint-disable-line

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
  }, []); // eslint-disable-line

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
  }, [ctrlMode]); // eslint-disable-line

  const medals = ["🥇", "🥈", "🥉", "4.", "5.", "6.", "7."];

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

  const swipeZoneH = ROWS * cellSize;

  const fsScale = isFullscreen
    ? Math.min(
        (window.innerWidth * 0.96) / (COLS * cellSize),
        (window.innerHeight - 64) / (ROWS * cellSize + (ctrlMode === "swipe" ? swipeZoneH : 140))
      )
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

  // ── Canvas overlay (non-swipe modes) ──────────────────────────────────────
  // In swipe mode this is replaced by content rendered inside the swipe zone.
  const canvasOverlayNonSwipe = ctrlMode !== "swipe" && (
    demoMode ? (
      // Demo running: small "Take over" prompt at bottom of canvas
      <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", zIndex: 10, pointerEvents: "auto" }}>
        <button onClick={startGame} style={{ background: "rgba(79,142,247,0.88)", border: "none", borderRadius: 7, color: "#fff", fontFamily: "inherit", fontWeight: 800, fontSize: 11, padding: "6px 16px", cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>
          ▶ Play
        </button>
      </div>
    ) : (!display.started || display.gameOver) ? (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "auto", zIndex: 10 }}>
        {display.gameOver && (
          <span style={{ color: "#e74c3c", fontWeight: 800, fontSize: 13, fontFamily: "monospace", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>GAME OVER</span>
        )}
        <button onClick={startGame} style={{ background: display.gameOver ? "#e74c3c" : C.accent, border: "none", borderRadius: 8, color: "#fff", fontFamily: "inherit", fontWeight: 800, fontSize: 13, padding: "9px 24px", cursor: "pointer", boxShadow: "0 2px 16px rgba(0,0,0,0.35)", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
          {display.gameOver ? "↺ Restart" : "▶ Start"}
        </button>
      </div>
    ) : null
  );

  // ── Swipe zone content — changes by game state ─────────────────────────────
  const swipeZoneContent = demoMode ? (
    // Demo playing: prompt user to take over by tapping the swipe zone
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, pointerEvents: "auto" }}>
      <span style={{ color: C.muted, fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>DEMO MODE</span>
      <button onClick={startGame} style={{ background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontFamily: "inherit", fontWeight: 800, fontSize: 13, padding: "9px 24px", cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,0.25)" }}>
        ▶ Play
      </button>
      <span style={{ color: C.border, fontSize: 11 }}>or swipe above to take control</span>
    </div>
  ) : display.gameOver ? (
    // Game over in swipe mode — show score + restart, no overlap with canvas
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, pointerEvents: "auto" }}>
      <span style={{ color: "#e74c3c", fontWeight: 800, fontSize: 15, fontFamily: "monospace" }}>GAME OVER</span>
      <span style={{ color: C.text, fontWeight: 700, fontSize: 14, fontFamily: "monospace" }}>Score: {display.score}</span>
      <button onClick={startGame} style={{ background: "#e74c3c", border: "none", borderRadius: 8, color: "#fff", fontFamily: "inherit", fontWeight: 800, fontSize: 13, padding: "9px 24px", cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
        ↺ Restart
      </button>
    </div>
  ) : !display.started ? (
    // Not yet started
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, pointerEvents: "auto" }}>
      <button onClick={startGame} style={{ background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontFamily: "inherit", fontWeight: 800, fontSize: 13, padding: "9px 24px", cursor: "pointer", boxShadow: "0 2px 12px rgba(0,0,0,0.25)" }}>
        ▶ Start
      </button>
      <span style={{ color: C.muted, fontSize: 12 }}>or swipe above to begin</span>
    </div>
  ) : (
    // Playing — normal swipe prompt
    <>
      <span style={{ fontSize: 36, lineHeight: 1 }}>👆</span>
      <span style={{ color: C.muted, fontSize: 13 }}>Swipe here to steer</span>
      <span style={{ color: C.border, fontSize: 11 }}>↑ ↓ ← →</span>
    </>
  );

  const controlsSection = (
    <>
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
    <div ref={containerRef} style={{
      background: isFullscreen ? (lightMode ? "#f0f4f8" : C.bg) : C.surface,
      border: isFullscreen ? "none" : `1px solid ${C.border}`,
      borderRadius: isFullscreen ? 0 : 12,
      padding: isFullscreen ? "12px 0 0" : "16px 20px",
      marginBottom: isFullscreen ? 0 : 24,
      display: "flex",
      alignItems: isFullscreen ? "flex-start" : "center",
      justifyContent: "center",
      minHeight: isFullscreen ? "100vh" : undefined,
    }}>
      <div style={{
        width: "fit-content",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        transform: isFullscreen ? `scale(${fsScale})` : undefined,
        transformOrigin: isFullscreen ? "top center" : undefined,
      }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: COLS * cellSize }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.accent, fontWeight: 800, fontSize: 13, fontFamily: "monospace" }}>🐍 SNAKE · {display.score}</span>
            {demoMode && <span style={{ color: C.muted, fontSize: 9, fontWeight: 700, letterSpacing: 1, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px" }}>DEMO</span>}
          </div>
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {iconBtn(lightMode ? "Dark theme" : "Light theme", lightMode ? "🌙" : "☀️", () => setLightMode(v => !v))}
            {iconBtn(isFullscreen ? "Exit fullscreen" : "Full screen", isFullscreen ? "⊠" : "⛶", toggleFullscreen)}
            {iconBtn("Close", "✕", onClose)}
          </div>
        </div>

        {ctrlMode === "swipe" ? (
          <>
            {/* Canvas has no HTML overlay — swipe zone handles all state prompts */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <canvas ref={canvasRef} width={COLS * cellSize} height={ROWS * cellSize}
                style={{ display: "block", borderRadius: "6px 6px 0 0", border: `1px solid ${C.border}`, borderBottom: "none", imageRendering: "pixelated", touchAction: "none" }} />
              <div ref={swipeZoneRef} style={{ width: COLS * cellSize, height: swipeZoneH, background: lightMode ? "#dce6f0" : C.card, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 6px 6px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", touchAction: "none", userSelect: "none", gap: 8, cursor: "default" }}>
                {swipeZoneContent}
              </div>
            </div>
            {controlsSection}
          </>
        ) : (
          <>
            <div style={{ position: "relative" }}>
              <canvas ref={canvasRef} width={COLS * cellSize} height={ROWS * cellSize}
                style={{ display: "block", borderRadius: 6, border: `1px solid ${C.border}`, imageRendering: "pixelated", touchAction: "none" }} />
              {canvasOverlayNonSwipe}
            </div>
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
