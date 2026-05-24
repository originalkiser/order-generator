import { useState, useRef, useEffect } from "react";
import { useC } from "../context/theme.jsx";

// ── Location multi-select (used in ManualBuildStep) ──────────────────────────
export function LocationMultiSelect({ locations, selected, onChange, placeholder = "Select locations…" }) {
  const C = useC();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [btnWidth, setBtnWidth] = useState(200);
  const ref = useRef();
  const btnRef = useRef();
  const measureCtxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  useEffect(() => {
    if (!btnRef.current) return;
    const ro = new ResizeObserver(entries => setBtnWidth(entries[0].contentRect.width));
    ro.observe(btnRef.current);
    return () => ro.disconnect();
  }, []);
  const getCtx = () => {
    if (!measureCtxRef.current) {
      measureCtxRef.current = document.createElement("canvas").getContext("2d");
      measureCtxRef.current.font = "13px system-ui, sans-serif";
    }
    return measureCtxRef.current;
  };
  const filtered = locations.filter(l => l.toLowerCase().includes(search.toLowerCase()));
  const toggle = (loc) => { const n = new Set(selected); n.has(loc) ? n.delete(loc) : n.add(loc); onChange(n); };
  const getLabel = () => {
    if (selected.size === 0) return placeholder;
    const items = [...selected];
    const ctx = getCtx();
    const available = btnWidth - 44; // subtract arrow + padding
    let best = items[0];
    for (let k = 1; k <= items.length; k++) {
      const candidate = items.slice(0, k).join(", ") + (items.length - k > 0 ? ` +${items.length - k}` : "");
      if (ctx.measureText(candidate).width <= available) best = candidate;
      else break;
    }
    return best;
  };
  const label = getLabel();
  const allSelected = filtered.length > 0 && filtered.every(l => selected.has(l));
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button ref={btnRef} onClick={() => setOpen(x => !x)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.surface, border: `1px solid ${selected.size > 0 ? C.accent : C.border}`, borderRadius: 6, color: selected.size > 0 ? C.accent : C.muted, fontFamily: "inherit", fontSize: 13, padding: "6px 10px", cursor: "pointer", gap: 8 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>{label}</span>
        <span style={{ fontSize: 10, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 200, top: "calc(100% + 4px)", left: 0, minWidth: 220, width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 6px 20px #0006", padding: 8 }}>
          <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search locations…"
            style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontFamily: "inherit", fontSize: 12, padding: "5px 8px", outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
          {/* Select All / Clear All row */}
          <div style={{ display: "flex", gap: 6, marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
            <button
              onClick={() => { const n = new Set(selected); filtered.forEach(l => n.add(l)); onChange(n); }}
              style={{ flex: 1, background: allSelected ? C.accentDim : "transparent", border: `1px solid ${C.border}`, borderRadius: 4, color: C.accent, fontFamily: "inherit", fontSize: 11, fontWeight: 700, padding: "3px 0", cursor: "pointer" }}>
              Select All
            </button>
            <button
              onClick={() => { const n = new Set(selected); filtered.forEach(l => n.delete(l)); onChange(n); }}
              style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontFamily: "inherit", fontSize: 11, fontWeight: 700, padding: "3px 0", cursor: "pointer" }}>
              Clear
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px", cursor: "pointer", borderRadius: 4 }}>
            <input type="checkbox" checked={selected.size === 0} onChange={() => onChange(new Set())} style={{ accentColor: C.muted }} />
            <span style={{ color: C.muted, fontSize: 12, fontStyle: "italic" }}>No specific location</span>
          </label>
          <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 2 }}>
            {filtered.map(loc => (
              <label key={loc} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", cursor: "pointer", borderRadius: 4 }}>
                <input type="checkbox" checked={selected.has(loc)} onChange={() => toggle(loc)} style={{ accentColor: C.accent }} />
                <span style={{ color: C.text, fontSize: 13 }}>{loc}</span>
              </label>
            ))}
            {filtered.length === 0 && <div style={{ color: C.muted, fontSize: 12, padding: "4px 4px" }}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
