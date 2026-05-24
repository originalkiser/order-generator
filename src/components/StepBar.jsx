import { useRef } from "react";
import { useC } from "../context/theme.jsx";

// ── step bar ──────────────────────────────────────────────────────────────────
export const STEPS_UPLOAD = ["Upload", "Map Columns", "Unit of Measure", "Review Order", "Export"];
export const STEPS_MANUAL = ["Upload", "Build Order", "Review Order", "Export"];
// Map step number → display index for manual mode (steps 0,1,3,4 → 0,1,2,3)
export const manualStepIndex = { 0: 0, 1: 1, 3: 2, 4: 3 };

export const StepBar = ({ current, buildMode, onReviewTripleClick }) => {
  const C = useC();
  const steps = buildMode === "manual" ? STEPS_MANUAL : STEPS_UPLOAD;
  const idx = buildMode === "manual" ? (manualStepIndex[current] ?? 0) : current;
  const clickTimesRef = useRef([]);
  const handleCircleClick = (stepLabel) => {
    if (stepLabel !== "Review Order" || !onReviewTripleClick) return;
    const now = Date.now();
    const times = [...clickTimesRef.current, now].slice(-3);
    clickTimesRef.current = times;
    if (times.length === 3 && (now - times[0]) < 700) {
      clickTimesRef.current = [];
      onReviewTripleClick();
    }
  };
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 36 }}>
      {steps.map((s, i) => {
        const done = i < idx, active = i === idx;
        const isReview = s === "Review Order";
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div
                onClick={() => handleCircleClick(s)}
                style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${done ? C.green : active ? C.accent : C.border}`, background: done ? C.green + "22" : active ? C.accent + "22" : "transparent", color: done ? C.green : active ? C.accent : C.muted, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, transition: "all .3s", cursor: isReview ? "pointer" : "default", userSelect: "none" }}>
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 11, color: active ? C.accent : done ? C.green : C.muted, fontWeight: active ? 700 : 400, whiteSpace: "nowrap" }}>{s}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: done ? C.green + "55" : C.border, margin: "0 8px", marginBottom: 20, transition: "all .3s" }} />}
          </div>
        );
      })}
    </div>
  );
};
