import { useState, useEffect } from "react";
import { useC } from "../context/theme.jsx";

const LS_DISMISSED = "ordergen_hints_dismissed";
const LS_ENABLED   = "ordergen_hints_enabled";
const EVT          = "ordergen-hints-change";

export function isHintsEnabled() {
  return localStorage.getItem(LS_ENABLED) !== "false";
}

function isHintDismissed(id) {
  try {
    const d = JSON.parse(localStorage.getItem(LS_DISMISSED) || "[]");
    return d.includes(id);
  } catch { return false; }
}

function dismissHint(id) {
  try {
    const d = JSON.parse(localStorage.getItem(LS_DISMISSED) || "[]");
    if (!d.includes(id)) d.push(id);
    localStorage.setItem(LS_DISMISSED, JSON.stringify(d));
  } catch {}
}

/**
 * HintCard — dismissible inline hint.
 *
 * Props:
 *   id       {string}  Unique key stored in localStorage so "dismissed" persists across sessions.
 *   title    {string}  Optional bold title line.
 *   icon     {string}  Emoji/text shown left of content (default "💡").
 *   children          Hint body — can contain JSX.
 */
export function HintCard({ id, title, children, icon = "💡" }) {
  const C = useC();
  const [hidden, setHidden] = useState(() => isHintDismissed(id) || !isHintsEnabled());

  // React to global enable/disable toggle
  useEffect(() => {
    const handler = () => {
      if (!isHintsEnabled()) {
        setHidden(true);
      } else {
        // Re-show only if this particular hint was not individually dismissed
        if (!isHintDismissed(id)) setHidden(false);
      }
    };
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, [id]);

  if (hidden) return null;

  const dismiss = () => { dismissHint(id); setHidden(true); };
  const disableAll = () => {
    localStorage.setItem(LS_ENABLED, "false");
    window.dispatchEvent(new Event(EVT));
  };

  return (
    <div style={{
      background: C.accentDim,
      border: `1px solid ${C.accent}55`,
      borderRadius: 10,
      padding: "12px 16px",
      marginBottom: 16,
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
    }}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        {title && (
          <div style={{ color: C.accent, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{title}</div>
        )}
        <div style={{ color: C.text, fontSize: 13, lineHeight: 1.55 }}>{children}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        <button
          onClick={dismiss}
          title="Dismiss this hint"
          style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}>
          ✕
        </button>
        <button
          onClick={disableAll}
          style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 10, padding: 0, whiteSpace: "nowrap", textDecoration: "underline", fontFamily: "inherit" }}>
          Disable all hints
        </button>
      </div>
    </div>
  );
}

/**
 * HintsToggle — small header button to globally enable/disable hints.
 * Import and drop it in App.jsx's header alongside the theme toggle.
 */
export function HintsToggle() {
  const C = useC();
  const [enabled, setEnabled] = useState(isHintsEnabled);

  useEffect(() => {
    const handler = () => setEnabled(isHintsEnabled());
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, []);

  const toggle = () => {
    const next = !enabled;
    localStorage.setItem(LS_ENABLED, next ? "true" : "false");
    window.dispatchEvent(new Event(EVT));
    setEnabled(next);
  };

  return (
    <button
      onClick={toggle}
      title={enabled ? "Hints on — click to disable" : "Hints off — click to enable"}
      style={{
        background: enabled ? C.accentDim : "transparent",
        border: `1px solid ${enabled ? C.accent + "88" : C.border}`,
        borderRadius: 8,
        color: enabled ? C.accent : C.muted,
        fontFamily: "inherit",
        fontSize: 15,
        cursor: "pointer",
        padding: "6px 10px",
        lineHeight: 1,
        transition: "all .15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = enabled ? C.accent + "88" : C.border;
        e.currentTarget.style.color = enabled ? C.accent : C.muted;
      }}>
      💡
    </button>
  );
}
