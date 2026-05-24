import { useState, useRef } from "react";
import { C } from "../constants.js";

export function ColumnFilter({ colKey, rows, textValue, onTextChange, checkedFilter, onCheckedChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef();

  const allValues = [...new Set(rows.map(r => String(r[colKey] ?? "")))].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
  });

  const mode = checkedFilter?.mode ?? "all";
  const selectedValues = checkedFilter?.values ?? new Set();

  const filteredValues = allValues.filter(v => v.toLowerCase().includes(search.toLowerCase()));
  const hasActiveFilter = textValue || mode === "some";

  const isSelected = (v) => mode === "all" || selectedValues.has(v);
  const allSelected = mode === "all";

  // Close dropdown on outside mousedown
  const closeIfOutside = (e) => {
    if (ref.current && !ref.current.contains(e.target)) setOpen(false);
  };
  // Register/unregister listener when open changes
  const handleOpen = (nextOpen) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setTimeout(() => document.addEventListener("mousedown", closeIfOutside), 0);
    } else {
      document.removeEventListener("mousedown", closeIfOutside);
    }
  };

  const toggleValue = (v) => {
    if (mode === "all") {
      // Start fresh: all selected except this one
      const next = new Set(allValues.filter(x => x !== v));
      onCheckedChange({ mode: "some", values: next });
    } else {
      const next = new Set(selectedValues);
      if (next.has(v)) next.delete(v); else next.add(v);
      // If everything is now checked, revert to "all" mode (no filter)
      const allNowChecked = allValues.every(x => next.has(x));
      onCheckedChange(allNowChecked ? { mode: "all", values: new Set() } : { mode: "some", values: next });
    }
  };

  const toggleAll = () => {
    if (mode === "all") {
      // Uncheck all: mode=some with empty values set = nothing passes
      onCheckedChange({ mode: "some", values: new Set() });
    } else {
      // Check all: back to mode=all
      onCheckedChange({ mode: "all", values: new Set() });
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 0 }}>
        <input
          value={textValue}
          onChange={e => onTextChange(e.target.value)}
          placeholder="Filter…"
          style={{
            flex: 1, minWidth: 0, background: C.card,
            border: `1px solid ${hasActiveFilter ? C.accent : C.border}`,
            borderRight: "none", borderRadius: "4px 0 0 4px",
            color: C.text, fontFamily: "inherit", fontSize: 11,
            padding: "3px 6px", outline: "none", boxSizing: "border-box",
          }}
        />
        <button
          onMouseDown={e => { e.preventDefault(); handleOpen(!open); }}
          style={{
            background: hasActiveFilter ? C.accentDim : C.card,
            border: `1px solid ${hasActiveFilter ? C.accent : C.border}`,
            borderRadius: "0 4px 4px 0",
            color: hasActiveFilter ? C.accent : C.muted,
            cursor: "pointer", padding: "0 6px", fontSize: 10, lineHeight: 1,
          }}
          title="Show unique values"
        >▾</button>
      </div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, zIndex: 9999,
          background: C.card, border: `1px solid ${C.accent}`,
          borderRadius: 8, minWidth: 180, maxWidth: 260, boxShadow: "0 8px 32px #0008",
        }}>
          <div style={{ padding: "8px 8px 4px" }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search values…"
              style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontFamily: "inherit", fontSize: 11, padding: "4px 8px", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          <div
            onMouseDown={e => { e.preventDefault(); toggleAll(); }}
            style={{ padding: "5px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
          >
            <input type="checkbox" checked={allSelected} onChange={() => {}}
              style={{ accentColor: C.accent, width: 13, height: 13, flexShrink: 0, pointerEvents: "none" }} />
            <span style={{ color: C.muted, fontSize: 12, fontWeight: 700 }}>(Select All)</span>
          </div>

          <div style={{ maxHeight: 200, overflowY: "auto", padding: "4px 0" }}>
            {filteredValues.length === 0 ? (
              <div style={{ padding: "8px 12px", color: C.muted, fontSize: 11 }}>No values found</div>
            ) : filteredValues.map(v => {
              const sel = isSelected(v);
              return (
                <div key={v}
                  onMouseDown={e => { e.preventDefault(); toggleValue(v); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", cursor: "pointer", userSelect: "none", background: sel ? C.accentDim + "22" : "transparent" }}
                >
                  <input type="checkbox" checked={sel} onChange={() => {}}
                    style={{ accentColor: C.accent, width: 13, height: 13, flexShrink: 0, pointerEvents: "none" }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: C.text }}>
                    {v === "" ? <em style={{ color: C.muted }}>(blank)</em> : v}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ padding: "6px 8px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button onMouseDown={e => { e.preventDefault(); onCheckedChange({ mode: "all", values: new Set() }); onTextChange(""); setSearch(""); handleOpen(false); }}
              style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontFamily: "inherit", fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>Clear</button>
            <button onMouseDown={e => {
              e.preventDefault();
              // If user searched but left mode=all, apply the visible filtered values as a "some" filter
              if (search.trim() && mode === "all" && filteredValues.length > 0 && filteredValues.length < allValues.length) {
                onCheckedChange({ mode: "some", values: new Set(filteredValues) });
              }
              setSearch("");
              handleOpen(false);
            }}
              style={{ background: C.accent, border: "none", borderRadius: 4, color: "#fff", fontFamily: "inherit", fontSize: 11, padding: "3px 10px", cursor: "pointer", fontWeight: 700 }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
