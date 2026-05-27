import { useState, useRef, useEffect, Component } from "react";
import { useC } from "../context/theme.jsx";

// Error boundary to surface runtime crashes instead of blank-screening
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: "#e74c3c", fontFamily: "monospace", background: "#1e2335", minHeight: "100vh" }}>
          <h2 style={{ marginBottom: 16 }}>⚠ Render Error (see below — refresh to retry)</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#e8ecf4" }}>
            {this.state.error?.message}{"\n\n"}{this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Input that keeps a local draft value and only commits to parent on blur / Enter.
// Prevents parent re-renders from losing focus while the user is mid-typing.
export function DraftInput({ value, onCommit, style, min = 0, ...rest }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const committed = useRef(String(value ?? ""));
  // Sync when parent value changes externally (e.g. after Update All)
  useEffect(() => {
    const ext = String(value ?? "");
    if (ext !== committed.current) { setDraft(ext); committed.current = ext; }
  }, [value]);
  const commit = () => {
    const v = draft === "" ? "" : Math.max(min, Number(draft));
    committed.current = String(v);
    onCommit(v);
  };
  return (
    <input
      {...rest}
      type="number"
      min={min}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") { commit(); e.target.blur(); } }}
      style={style}
    />
  );
}

export function Badge({ children, color }) {
  const C = useC();
  const c = color ?? C.accent;
  return <span style={{ background: c + "22", color: c, border: `1px solid ${c}44`, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{children}</span>;
}

export const Btn = ({ children, onClick, variant = "primary", disabled, small, style: extra }) => {
  const C = useC();
  const variants = {
    primary: { background: C.accent, color: "#fff", border: "none" },
    ghost: { background: "transparent", color: C.accent, border: `1px solid ${C.accentDim}` },
    danger: { background: C.red + "22", color: C.red, border: `1px solid ${C.red}44` },
    success: { background: C.green + "22", color: C.green, border: `1px solid ${C.green}44` },
    purple: { background: C.purple + "22", color: C.purple, border: `1px solid ${C.purple}44` },
  };
  return (
    <button onClick={disabled ? undefined : onClick}
      style={{ borderRadius: 8, fontFamily: "inherit", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, transition: "all .15s", padding: small ? "6px 14px" : "10px 22px", fontSize: small ? 13 : 14, ...variants[variant], ...extra }}>
      {children}
    </button>
  );
};

export const Input = ({ value, onChange, type = "text", style: extra, ...rest }) => {
  const C = useC();
  return <input type={type} value={value} onChange={onChange}
    style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "6px 10px", outline: "none", ...extra }}
    {...rest} />;
};

export const Select = ({ value, onChange, children, style: extra }) => {
  const C = useC();
  return <select value={value} onChange={onChange}
    style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: value ? C.text : C.muted, fontFamily: "inherit", fontSize: 13, padding: "6px 10px", outline: "none", cursor: "pointer", ...extra }}>
    {children}
  </select>;
};

// ── data preview table ────────────────────────────────────────────────────────
export function DataPreview({ headers, rows, highlightCols = [], maxRows = 15 }) {
  const C = useC();
  const preview = rows.slice(0, maxRows);
  return (
    <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}`, maxHeight: 300, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "inherit", fontSize: 12 }}>
        <thead style={{ position: "sticky", top: 0 }}>
          <tr style={{ background: C.card }}>
            {headers.map((h, i) => {
              const hl = highlightCols.includes(h);
              return (
                <th key={i} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", color: hl ? C.accent : C.muted, background: hl ? C.accentDim + "55" : C.card, transition: "all .2s" }}>
                  {hl && <span style={{ marginRight: 4 }}>●</span>}{h || `Col ${i + 1}`}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {preview.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: `1px solid ${C.border}22`, background: ri % 2 === 0 ? "transparent" : C.surface + "55" }}>
              {headers.map((h, ci) => {
                const hl = highlightCols.includes(h);
                return (
                  <td key={ci} style={{ padding: "6px 12px", color: hl ? C.text : C.muted, background: hl ? C.accentDim + "22" : "transparent", transition: "all .2s", whiteSpace: "nowrap" }}>
                    {String(row[ci] ?? "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: "6px 12px", background: C.card, borderTop: `1px solid ${C.border}`, color: C.muted, fontSize: 11 }}>
        Showing {preview.length} of {rows.length} rows
      </div>
    </div>
  );
}

// Callout card shown in Review step (Most Ordered / Least Ordered).
// Module-level so React never remounts it due to a new function reference.
export function OrderCalloutCard({ title, accentColor, theRows, n, setN, sortedList, label, onSetOrder, onSetGroupOrders }) {
  const C = useC();
  const [bulkVal, setBulkVal] = useState("");
  return (
    <div style={{ flex: 1, minWidth: 220, background: C.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}`, overflow: "auto", minHeight: 120 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6, flexWrap: "wrap" }}>
        <span style={{ color: C.muted, fontSize: 11, fontWeight: 700 }}>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button onClick={() => setN(v => Math.max(1, v-1))} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 3, color: C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 11, width: 18, height: 18, lineHeight: 1, padding: 0 }}>−</button>
          <span style={{ color: C.text, fontSize: 11, fontWeight: 700, minWidth: 14, textAlign: "center" }}>{n}</span>
          <button onClick={() => setN(v => Math.min(sortedList.length || 1, v+1))} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 3, color: C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 11, width: 18, height: 18, lineHeight: 1, padding: 0 }}>+</button>
        </div>
      </div>
      {theRows.length === 0 ? <div style={{ color: C.muted, fontSize: 13 }}>—</div> : (<>
        <div style={{ color: accentColor, fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
          {label}
          <span style={{ color: C.muted, fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{theRows.length} product{theRows.length !== 1 ? "s" : ""}</span>
        </div>
        <div style={{ display: "flex", gap: 5, marginBottom: 8, alignItems: "center" }}>
          <input
            type="number" value={bulkVal} onChange={e => setBulkVal(e.target.value)}
            placeholder="New qty for all"
            style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontFamily: "inherit", fontSize: 11, padding: "4px 8px", outline: "none" }}
          />
          <button
            onClick={() => { if (bulkVal !== "") { onSetGroupOrders(theRows.map(r => r._idx), Number(bulkVal)); setBulkVal(""); } }}
            disabled={bulkVal === ""}
            style={{ background: bulkVal !== "" ? accentColor : C.border, border: "none", borderRadius: 5, color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: 11, padding: "4px 10px", cursor: bulkVal !== "" ? "pointer" : "not-allowed", opacity: bulkVal !== "" ? 1 : 0.4, whiteSpace: "nowrap" }}
          >Update All</button>
        </div>
        <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
          {theRows.map(r => (
            <div key={r._idx} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.text, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                {r.product}{r.location ? <span style={{ color: C.muted, fontWeight: 400 }}> · {r.location}</span> : ""}
              </span>
              <DraftInput
                value={r.order}
                onCommit={v => onSetOrder(r._idx, v)}
                style={{ width: 60, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, color: accentColor, fontFamily: "inherit", fontSize: 11, fontWeight: 700, padding: "2px 6px", outline: "none", textAlign: "right" }}
              />
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}
