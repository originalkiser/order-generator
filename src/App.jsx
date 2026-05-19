import { useState, useRef } from "react";
import * as XLSX from "xlsx";

// ── helpers ───────────────────────────────────────────────────────────────────
const fmtNum = (n, decimals = 1) =>
  n === null || n === undefined || n === "" || isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: decimals });

const fmtCurrency = (n) =>
  n === null || n === undefined || n === "" || isNaN(Number(n))
    ? "—"
    : "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function calcOrder(row, targetDays) {
  const usage = parseFloat(row.daily_usage);
  const onHand = parseFloat(row.on_hand);
  const lead = parseFloat(row.leadtime);
  if (isNaN(usage) || isNaN(onHand) || isNaN(lead)) return null;
  return Math.ceil(Math.max(0, usage * (lead + targetDays) - onHand));
}

function calcDaysOnHand(row) {
  const usage = parseFloat(row.daily_usage);
  const onHand = parseFloat(row.on_hand);
  if (isNaN(usage) || isNaN(onHand) || usage === 0) return null;
  return onHand / usage;
}

const REQUIRED_CORE = ["location", "product", "on_hand", "leadtime"];
const MANUAL_ENTRY_FIELDS = ["location", "product", "leadtime"];
const FIELD_LABELS = {
  location: "Location", product: "Product", on_hand: "On Hand",
  leadtime: "Lead Time (days)", daily_usage: "Daily Usage",
  category: "Category", cost: "Cost (per unit)",
};

// ── palette ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#0f1117", surface: "#181c27", card: "#1e2335", border: "#2a3150",
  accent: "#4f8ef7", accentDim: "#2a4a8a", green: "#2ecc71", orange: "#f39c12",
  purple: "#a78bfa", purpleDim: "#4c3a8a", red: "#e74c3c", text: "#e8ecf4", muted: "#7a85a3",
};
// ── helpers ──────────────────────────────────────────────────────────────────
const trimVal = (v) => typeof v === "string" ? v.trim() : v;

// ── localStorage mapping memory ───────────────────────────────────────────────
const LS_KEY = "ordergen_mappings_v1";

function loadSavedMappings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}

function saveMappingToStorage(headers, mapState) {
  try {
    const saved = loadSavedMappings();
    const fingerprint = [...headers].sort().join("|");
    // Remove any existing entry for this exact fingerprint
    const filtered = saved.filter(s => s.fingerprint !== fingerprint);
    filtered.unshift({ fingerprint, headers, mapState, savedAt: Date.now() });
    // Keep last 20
    localStorage.setItem(LS_KEY, JSON.stringify(filtered.slice(0, 20)));
  } catch {}
}

// ── Product order rules localStorage ─────────────────────────────────────────
const LS_RULES_KEY = "ordergen_product_rules_v1";

function loadProductRules() {
  try { return JSON.parse(localStorage.getItem(LS_RULES_KEY) || "[]"); } catch { return []; }
}

function saveProductRules(rules) {
  try { localStorage.setItem(LS_RULES_KEY, JSON.stringify(rules)); } catch {}
}

// Apply product-specific rules to a suggested order quantity
// onHand is needed to evaluate maxOnHandAfter constraint
function applyProductRule(rule, suggestedQty, onHand) {
  let qty = suggestedQty ?? 0;
  // Apply min order qty
  if (rule.minQty != null && qty > 0) qty = Math.max(qty, rule.minQty);
  // Apply max order qty
  if (rule.maxQty != null) qty = Math.min(qty, rule.maxQty);
  // Round up to case size
  if (rule.caseSize != null && rule.caseSize > 1 && qty > 0) {
    qty = Math.ceil(qty / rule.caseSize) * rule.caseSize;
  }
  // Cap order so on-hand + order does not exceed maxOnHandAfter
  if (rule.maxOnHandAfter != null && onHand != null && !isNaN(Number(onHand))) {
    const maxAllowed = Math.max(0, rule.maxOnHandAfter - Number(onHand));
    qty = Math.min(qty, maxAllowed);
    // Re-snap down to case size multiple if needed
    if (rule.caseSize != null && rule.caseSize > 1 && qty > 0) {
      qty = Math.floor(qty / rule.caseSize) * rule.caseSize;
    }
  }
  return Math.max(0, qty);
}

// Score a saved mapping against current headers: count matching column values
function scoreSavedMapping(saved, currentHeaders) {
  const headerSet = new Set(currentHeaders);
  const m = saved.mapState.mapping || {};
  let matches = 0;
  Object.values(m).forEach(v => { if (v && headerSet.has(v)) matches++; });
  if (saved.mapState.usageMode === "calculated" && headerSet.has(saved.mapState.salesCol)) matches++;
  return matches;
}

// Find best matching saved mapping for current headers (needs ≥2 column matches)
function findBestSavedMapping(headers) {
  const saved = loadSavedMappings();
  if (!saved.length) return null;
  const scored = saved.map(s => ({ s, score: scoreSavedMapping(s, headers) }))
                       .filter(x => x.score >= 2)
                       .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].s : null;
}



// ── shared UI ─────────────────────────────────────────────────────────────────
const Badge = ({ children, color = C.accent }) => (
  <span style={{ background: color + "22", color, border: `1px solid ${color}44`, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{children}</span>
);

const Btn = ({ children, onClick, variant = "primary", disabled, small, style: extra }) => {
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

const Input = ({ value, onChange, type = "text", style: extra, ...rest }) => (
  <input type={type} value={value} onChange={onChange}
    style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "6px 10px", outline: "none", ...extra }}
    {...rest} />
);

const Select = ({ value, onChange, children, style: extra }) => (
  <select value={value} onChange={onChange}
    style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: value ? C.text : C.muted, fontFamily: "inherit", fontSize: 13, padding: "6px 10px", outline: "none", cursor: "pointer", ...extra }}>
    {children}
  </select>
);

// ── step bar ──────────────────────────────────────────────────────────────────
const STEPS = ["Upload", "Map Columns", "Review Order", "Export"];
const StepBar = ({ current }) => (
  <div style={{ display: "flex", gap: 0, marginBottom: 36 }}>
    {STEPS.map((s, i) => {
      const done = i < current, active = i === current;
      return (
        <div key={s} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "none" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${done ? C.green : active ? C.accent : C.border}`, background: done ? C.green + "22" : active ? C.accent + "22" : "transparent", color: done ? C.green : active ? C.accent : C.muted, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, transition: "all .3s" }}>
              {done ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: 11, color: active ? C.accent : done ? C.green : C.muted, fontWeight: active ? 700 : 400, whiteSpace: "nowrap" }}>{s}</span>
          </div>
          {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: done ? C.green + "55" : C.border, margin: "0 8px", marginBottom: 20, transition: "all .3s" }} />}
        </div>
      );
    })}
  </div>
);

// ── data preview table ────────────────────────────────────────────────────────
function DataPreview({ headers, rows, highlightCols = [], maxRows = 15 }) {
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


// ── ColumnFilter — text input + Excel-style checkbox dropdown ─────────────────
// checkedFilter shape: { mode: "all" | "some", values: Set<string> }
//   mode="all"  → no restriction, show everything (values ignored)
//   mode="some" → only show rows whose cell value is in `values`
function ColumnFilter({ colKey, rows, textValue, onTextChange, checkedFilter, onCheckedChange }) {
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
            <button onMouseDown={e => { e.preventDefault(); handleOpen(false); }}
              style={{ background: C.accent, border: "none", borderRadius: 4, color: "#fff", fontFamily: "inherit", fontSize: 11, padding: "3px 10px", cursor: "pointer", fontWeight: 700 }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── STEP 1: Upload ────────────────────────────────────────────────────────────
function UploadStep({ onData }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const inputRef = useRef();

  const handleFile = (file) => {
    setError("");
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (json.length < 2) { setError("File appears empty."); return; }
        const scanRows = json.slice(0, 20);
        const headerRowIdx = scanRows.reduce((bestIdx, row, i) => {
          const filled = row.filter(c => c !== "" && c !== null && c !== undefined).length;
          const bestFilled = scanRows[bestIdx].filter(c => c !== "" && c !== null && c !== undefined).length;
          return filled > bestFilled ? i : bestIdx;
        }, 0);
        const headers = json[headerRowIdx].map(String);
        const rows = json.slice(headerRowIdx + 1).filter(r => r.some(c => c !== ""));
        setPreview({ headers, rows, fileName: file.name, skippedRows: headerRowIdx });
      } catch {
        setError("Could not parse file. Please upload a valid .xlsx or .csv.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ color: C.text, fontSize: 26, fontWeight: 800, margin: 0 }}>Upload Your Inventory File</h2>
        <p style={{ color: C.muted, marginTop: 8 }}>Accepts .xlsx, .xls, or .csv — we'll read the first sheet</p>
      </div>
      {!preview ? (
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => inputRef.current.click()}
          style={{ maxWidth: 520, margin: "0 auto", width: "100%", border: `2px dashed ${dragging ? C.accent : C.border}`, borderRadius: 16, padding: "56px 32px", textAlign: "center", cursor: "pointer", background: dragging ? C.accent + "0a" : C.card, transition: "all .2s" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
          <p style={{ color: C.text, fontWeight: 700, margin: 0 }}>Drag & drop your spreadsheet here</p>
          <p style={{ color: C.muted, marginTop: 8, marginBottom: 20 }}>or click to browse</p>
          <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); inputRef.current.click(); }}>Browse Files</Btn>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>📄</span>
              <div>
                <div style={{ color: C.text, fontWeight: 700 }}>{preview.fileName}</div>
                <div style={{ color: C.muted, fontSize: 12 }}>
                  {preview.headers.length} columns · {preview.rows.length} rows
                  {preview.skippedRows > 0 && <span style={{ color: C.orange, marginLeft: 8 }}>↷ {preview.skippedRows} header row{preview.skippedRows > 1 ? "s" : ""} skipped</span>}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn small variant="ghost" onClick={() => { setPreview(null); inputRef.current.value = ""; }}>Change File</Btn>
              <Btn small onClick={() => onData(preview)}>Map Columns →</Btn>
            </div>
          </div>
          <div>
            <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              FILE PREVIEW — FIRST {Math.min(15, preview.rows.length)} ROWS{preview.skippedRows > 0 ? ` (auto-detected headers on row ${preview.skippedRows + 1})` : ""}
            </p>
            <DataPreview headers={preview.headers} rows={preview.rows} />
          </div>
        </div>
      )}
      {error && <p style={{ color: C.red, fontWeight: 600, textAlign: "center" }}>{error}</p>}
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
    </div>
  );
}

// ── STEP 2: Map Columns ───────────────────────────────────────────────────────
function MapStep({ headers, rows, fileName, onConfirm, initialState, suggestion }) {
  // initialState  = full saved state when user pressed Back (session memory)
  // suggestion    = best matching saved mapping from localStorage (cross-session)
  const init = initialState || suggestion?.mapState || {};
  const [mapping, setMapping] = useState(init.mapping || {});
  const [fieldMode, setFieldMode] = useState(init.fieldMode || { location: "column", product: "column", leadtime: "column" });
  const [manualValues, setManualValues] = useState(init.manualValues || { location: "", product: "", leadtime: "" });
  const [targetDays, setTargetDays] = useState(init.targetDays ?? 14);
  const [usageMode, setUsageMode] = useState(init.usageMode || "direct");
  const [salesCol, setSalesCol] = useState(init.salesCol || "");
  const [salesDays, setSalesDays] = useState(init.salesDays ?? 30);
  const [showPreview, setShowPreview] = useState(true);
  // optional fields
  const [orderMin, setOrderMin] = useState(init.orderMin ?? "");
  const [orderMax, setOrderMax] = useState(init.orderMax ?? "");
  const [orderLimitType, setOrderLimitType] = useState(init.orderLimitType || "units");
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const showSuggestionBanner = suggestion && !initialState && !suggestionDismissed;

  const set = (field, col) => setMapping(m => ({ ...m, [field]: col }));
  const setMode = (field, mode) => {
    setFieldMode(m => ({ ...m, [field]: mode }));
    if (mode === "manual") setMapping(m => ({ ...m, [field]: undefined }));
    else setManualValues(m => ({ ...m, [field]: "" }));
  };

  const fieldSatisfied = (field) => {
    if (!MANUAL_ENTRY_FIELDS.includes(field)) return !!mapping[field];
    return fieldMode[field] === "manual" ? !!manualValues[field] : !!mapping[field];
  };

  const usageMapped = usageMode === "direct" ? !!mapping.daily_usage : (!!salesCol && salesDays > 0);
  const coreMapped = REQUIRED_CORE.every(f => fieldSatisfied(f));
  const allReady = coreMapped && usageMapped;

  const highlighted = [
    fieldMode.location === "column" ? mapping.location : null,
    fieldMode.product === "column" ? mapping.product : null,
    mapping.on_hand,
    fieldMode.leadtime === "column" ? mapping.leadtime : null,
    usageMode === "direct" ? mapping.daily_usage : salesCol,
    mapping.category, mapping.cost,
  ].filter(Boolean);

  const currentMapState = () => ({
    mapping, fieldMode, manualValues, targetDays,
    usageMode, salesCol, salesDays,
    orderMin, orderMax, orderLimitType,
  });

  const handleConfirm = () => {
    const ms = currentMapState();
    saveMappingToStorage(headers, ms);
    onConfirm(
      mapping, targetDays,
      { mode: usageMode, salesCol, salesDays },
      { fieldMode, manualValues },
      { orderMin: orderMin !== "" ? Number(orderMin) : null, orderMax: orderMax !== "" ? Number(orderMax) : null, limitType: orderLimitType },
      ms  // pass full mapState back up for session memory
    );
  };

  const ModeToggle = ({ field }) => (
    <div style={{ display: "flex", gap: 4 }}>
      {["column", "manual"].map(m => (
        <button key={m} onClick={() => setMode(field, m)} style={{
          padding: "3px 9px", borderRadius: 5, border: `1px solid ${fieldMode[field] === m ? C.accent : C.border}`,
          background: fieldMode[field] === m ? C.accentDim : "transparent",
          color: fieldMode[field] === m ? C.accent : C.muted,
          fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
        }}>{m === "column" ? "Column" : "Manual"}</button>
      ))}
    </div>
  );

  const OptionalFieldCard = ({ field, label }) => (
    <div style={{ background: C.card, borderRadius: 12, padding: "14px 18px", border: `1px solid ${mapping[field] ? C.accentDim : C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{label}</span>
          <span style={{ color: C.muted, fontSize: 11, marginLeft: 6 }}>optional</span>
        </div>
        {mapping[field] && <Badge color={C.green}>✓</Badge>}
      </div>
      <Select value={mapping[field] || ""} onChange={(e) => set(field, e.target.value)} style={{ width: "100%" }}>
        <option value="">— Not mapped —</option>
        {headers.map((h, i) => <option key={i} value={h}>{h || `Column ${i + 1}`}</option>)}
      </Select>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ color: C.text, fontSize: 22, fontWeight: 800, margin: 0 }}>Map Your Columns</h2>
          <p style={{ color: C.muted, marginTop: 6 }}>File: <span style={{ color: C.accent }}>{fileName}</span></p>
        </div>
        <Btn small variant="ghost" onClick={() => setShowPreview(v => !v)}>{showPreview ? "Hide" : "Show"} Preview</Btn>
      </div>

      {/* suggestion banner */}
      {showSuggestionBanner && (
        <div style={{ background: C.green + "12", border: `1px solid ${C.green}44`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>💡</span>
            <div>
              <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>Column mapping suggested</span>
              <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>
                Based on a previous file with {Object.values(suggestion.mapState.mapping || {}).filter(v => new Set(headers).has(v)).length} matching columns
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn small variant="success" onClick={() => setSuggestionDismissed(true)}>Keep Suggestions</Btn>
            <Btn small variant="ghost" onClick={() => {
              setMapping({}); setFieldMode({ location: "column", product: "column", leadtime: "column" });
              setManualValues({ location: "", product: "", leadtime: "" });
              setUsageMode("direct"); setSalesCol(""); setSalesDays(30);
              setSuggestionDismissed(true);
            }}>Start Fresh</Btn>
          </div>
        </div>
      )}

      {showPreview && (
        <div>
          <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>DATA PREVIEW — mapped columns highlighted ●</p>
          <DataPreview headers={headers} rows={rows} highlightCols={highlighted} />
        </div>
      )}

      {/* required core fields */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {REQUIRED_CORE.map(field => {
          const canManual = MANUAL_ENTRY_FIELDS.includes(field);
          const isManual = canManual && fieldMode[field] === "manual";
          const satisfied = fieldSatisfied(field);
          return (
            <div key={field} style={{ background: C.card, borderRadius: 12, padding: "14px 18px", border: `1px solid ${satisfied ? C.accentDim : C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{FIELD_LABELS[field]}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {canManual && <ModeToggle field={field} />}
                  {satisfied && <Badge color={C.green}>✓</Badge>}
                </div>
              </div>
              {isManual ? (
                <div>
                  <Input type={field === "leadtime" ? "number" : "text"} value={manualValues[field]}
                    onChange={e => setManualValues(m => ({ ...m, [field]: e.target.value }))}
                    placeholder={field === "location" ? "e.g. Warehouse A" : field === "product" ? "e.g. Widget XL" : "e.g. 7"}
                    style={{ width: "100%" }} />
                  <p style={{ color: C.muted, fontSize: 11, margin: "5px 0 0" }}>Applied to every row in the order.</p>
                </div>
              ) : (
                <Select value={mapping[field] || ""} onChange={(e) => set(field, e.target.value)} style={{ width: "100%" }}>
                  <option value="">— Select column —</option>
                  {headers.map((h, i) => <option key={i} value={h}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              )}
            </div>
          );
        })}
      </div>

      {/* daily usage */}
      <div style={{ background: C.card, borderRadius: 12, padding: "18px 20px", border: `1px solid ${usageMapped ? C.accentDim : C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div>
            <span style={{ color: C.text, fontWeight: 700 }}>Daily Usage</span>
            <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>units moved per day</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {["direct", "calculated"].map(m => (
              <button key={m} onClick={() => setUsageMode(m)} style={{
                padding: "5px 12px", borderRadius: 6,
                border: `1px solid ${usageMode === m ? (m === "direct" ? C.accent : C.purple) : C.border}`,
                background: usageMode === m ? (m === "direct" ? C.accentDim : C.purpleDim) : "transparent",
                color: usageMode === m ? (m === "direct" ? C.accent : C.purple) : C.muted,
                fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer",
              }}>{m === "direct" ? "Direct column" : "Calculate from sales"}</button>
            ))}
          </div>
        </div>
        {usageMode === "direct" ? (
          <Select value={mapping.daily_usage || ""} onChange={(e) => set("daily_usage", e.target.value)} style={{ width: "100%" }}>
            <option value="">— Select daily usage column —</option>
            {headers.map((h, i) => <option key={i} value={h}>{h || `Column ${i + 1}`}</option>)}
          </Select>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: C.purple + "11", border: `1px solid ${C.purple}33`, borderRadius: 8, padding: "10px 14px", color: C.purple, fontSize: 12 }}>
              <strong>Calculated daily usage</strong> = Total Units Sold ÷ Number of Days<br />
              <span style={{ color: C.muted }}>e.g. 300 units sold over 30 days → 10 units / day</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 5 }}>TOTAL UNITS SOLD COLUMN</label>
                <Select value={salesCol} onChange={(e) => setSalesCol(e.target.value)} style={{ width: "100%" }}>
                  <option value="">— Select column —</option>
                  {headers.map((h, i) => <option key={i} value={h}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </div>
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 5 }}>OVER HOW MANY DAYS?</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Input type="number" value={salesDays} min={1} onChange={(e) => setSalesDays(Number(e.target.value))} style={{ width: 80 }} />
                  <span style={{ color: C.muted, fontSize: 13 }}>days</span>
                </div>
              </div>
            </div>
            {salesCol && salesDays > 0 && (
              <div style={{ color: C.muted, fontSize: 12 }}>Formula: <span style={{ color: C.purple, fontWeight: 700 }}>[{salesCol}] ÷ {salesDays}</span> = daily usage per row</div>
            )}
          </div>
        )}
      </div>

      {/* optional fields: category + cost */}
      <div>
        <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>OPTIONAL FIELDS</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <OptionalFieldCard field="category" label="Category" />
          <OptionalFieldCard field="cost" label="Cost (per unit)" />
        </div>
      </div>

      {/* order min/max */}
      <div style={{ background: C.card, borderRadius: 12, padding: "18px 20px", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div>
            <span style={{ color: C.text, fontWeight: 700 }}>Order Limits</span>
            <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>optional — flags orders outside range in review</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[["units", "Total Units"], ["dollars", "Total $ Value"]].map(([val, label]) => (
              <button key={val} onClick={() => setOrderLimitType(val)} style={{
                padding: "4px 12px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer",
                border: `1px solid ${orderLimitType === val ? C.accent : C.border}`,
                background: orderLimitType === val ? C.accentDim : "transparent",
                color: orderLimitType === val ? C.accent : C.muted,
              }}>{label}</button>
            ))}
          </div>
        </div>
        {orderLimitType === "dollars" && !mapping.cost && (
          <div style={{ background: C.orange + "18", border: `1px solid ${C.orange}44`, borderRadius: 8, padding: "8px 12px", color: C.orange, fontSize: 12, marginBottom: 12 }}>
            ⚠ Map a Cost column above to enable dollar-based limits.
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 5 }}>
              {orderLimitType === "dollars" ? "MINIMUM ORDER VALUE ($)" : "MINIMUM ORDER UNITS"}
            </label>
            <Input type="number" value={orderMin} onChange={e => setOrderMin(e.target.value)}
              placeholder={orderLimitType === "dollars" ? "e.g. 500" : "e.g. 12"} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 5 }}>
              {orderLimitType === "dollars" ? "MAXIMUM ORDER VALUE ($)" : "MAXIMUM ORDER UNITS"}
            </label>
            <Input type="number" value={orderMax} onChange={e => setOrderMax(e.target.value)}
              placeholder={orderLimitType === "dollars" ? "e.g. 5000" : "e.g. 144"} style={{ width: "100%" }} />
          </div>
        </div>
      </div>

      {/* target days */}
      <div style={{ background: C.card, borderRadius: 12, padding: "18px 22px", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <span style={{ color: C.text, fontWeight: 700 }}>Target Days of Supply at Delivery</span>
            <p style={{ color: C.muted, fontSize: 12, margin: "4px 0 0" }}>Days of stock you want on hand after the order arrives</p>
          </div>
          <div style={{ background: C.accentDim, color: C.accent, borderRadius: 8, padding: "6px 16px", fontWeight: 800, fontSize: 20 }}>{targetDays}d</div>
        </div>
        <input type="range" min={1} max={90} value={targetDays} onChange={(e) => setTargetDays(Number(e.target.value))} style={{ width: "100%", accentColor: C.accent }} />
        <div style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 11, marginTop: 4 }}>
          <span>1d</span><span>30d</span><span>60d</span><span>90d</span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn onClick={handleConfirm} disabled={!allReady}>Generate Order →</Btn>
      </div>
    </div>
  );
}

// ── STEP 3: Review Order ──────────────────────────────────────────────────────
function ReviewStep({ rawRows, headers, mapping, targetDays, usageConfig, manualEntry, orderLimits, onConfirm, onBack }) {
  const hasCost = !!mapping.cost;
  const hasCategory = !!mapping.category;
  const limitType = orderLimits?.limitType || "units"; // "units" | "dollars"

  // Product rules — loaded from localStorage, editable inline
  const [productRules, setProductRules] = useState(() => loadProductRules());
  const saveRules = (rules) => { setProductRules(rules); saveProductRules(rules); };
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  const [newRuleId, setNewRuleId] = useState("");
  const [newRuleCaseSize, setNewRuleCaseSize] = useState("");
  const [newRuleMin, setNewRuleMin] = useState("");
  const [newRuleMax, setNewRuleMax] = useState("");
  const [newRuleMaxOnHand, setNewRuleMaxOnHand] = useState("");
  const [rulesTab, setRulesTab] = useState("manual"); // "manual" | "upload"
  const [rulesUploadPreview, setRulesUploadPreview] = useState(null); // parsed rows from file
  const [rulesDragging, setRulesDragging] = useState(false);
  const [rulesUploadError, setRulesUploadError] = useState("");
  const rulesFileRef = useRef();

  const buildRows = (productRules) =>
    rawRows.map((r, i) => {
      const get = (field) => {
        if (manualEntry?.fieldMode?.[field] === "manual") return trimVal(manualEntry.manualValues?.[field] ?? "");
        const idx = headers.indexOf(mapping[field]);
        return idx >= 0 ? trimVal(r[idx]) : "";
      };
      let daily_usage;
      if (usageConfig.mode === "direct") {
        daily_usage = get("daily_usage");
      } else {
        const salesIdx = headers.indexOf(usageConfig.salesCol);
        const raw = salesIdx >= 0 ? parseFloat(r[salesIdx]) : NaN;
        daily_usage = isNaN(raw) ? "" : raw / usageConfig.salesDays;
      }
      const row = {
        _idx: i,
        location: get("location"), product: get("product"),
        daily_usage, on_hand: get("on_hand"), leadtime: get("leadtime"),
        category: hasCategory ? get("category") : "",
        cost: hasCost ? get("cost") : "",
      };
      const suggested = calcOrder(row, targetDays);
      const days_on_hand = calcDaysOnHand(row);
      // Apply product-specific rule if one exists
      const productId = String(row.product ?? "").trim();
      const rule = (productRules || []).find(ru => String(ru.productId).trim() === productId);
      const onHandNum = parseFloat(row.on_hand);
      const finalOrder = rule ? applyProductRule(rule, suggested ?? 0, isNaN(onHandNum) ? null : onHandNum) : (suggested ?? 0);
      const est_on_hand_after = !isNaN(onHandNum) ? onHandNum + finalOrder : null;
      return { ...row, suggested, order: finalOrder, days_on_hand, est_on_hand_after, appliedRule: rule || null };
    });

  const [rows, setRows] = useState(() => buildRows(productRules));
  const [targetLocal, setTargetLocal] = useState(targetDays);
  // colTextFilters: { [colKey]: string }  — type-in text filter
  // colCheckedFilters: { [colKey]: Set<string> }  — empty Set = show all; non-empty = show only checked
  const [colTextFilters, setColTextFilters] = useState({});
  const [colCheckedFilters, setColCheckedFilters] = useState({});
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(1);
  const [hideZero, setHideZero] = useState(false);

  const recalc = (td, rulesOverride) => {
    const rules = rulesOverride ?? productRules;
    setRows(prev => prev.map(r => {
      const s = calcOrder(r, td);
      const rule = rules.find(ru => String(ru.productId).trim() === String(r.product ?? "").trim());
      const onHandNum = parseFloat(r.on_hand);
      const finalOrder = rule ? applyProductRule(rule, s ?? 0, isNaN(onHandNum) ? null : onHandNum) : (s ?? 0);
      const est_on_hand_after = !isNaN(onHandNum) ? onHandNum + finalOrder : null;
      return { ...r, suggested: s, order: finalOrder, appliedRule: rule || null, est_on_hand_after };
    }));
    setTargetLocal(td);
  };

  const applyRulesToRows = (rules) => {
    setRows(prev => prev.map(r => {
      const rule = rules.find(ru => String(ru.productId).trim() === String(r.product ?? "").trim());
      const onHandNum = parseFloat(r.on_hand);
      const finalOrder = rule ? applyProductRule(rule, r.suggested ?? 0, isNaN(onHandNum) ? null : onHandNum) : (r.suggested ?? 0);
      const est_on_hand_after = !isNaN(onHandNum) ? onHandNum + finalOrder : null;
      return { ...r, order: finalOrder, appliedRule: rule || null, est_on_hand_after };
    }));
  };
  const setOrder = (idx, val) => setRows(prev => prev.map(r => {
    if (r._idx !== idx) return r;
    const newOrder = val === "" ? "" : Number(val);
    const onHandNum = parseFloat(r.on_hand);
    const est_on_hand_after = !isNaN(onHandNum) && newOrder !== "" ? onHandNum + Number(newOrder) : null;
    return { ...r, order: newOrder, est_on_hand_after };
  }));
  const resetOne = (idx) => setRows(prev => prev.map(r => r._idx === idx ? { ...r, order: r.suggested ?? 0 } : r));
  const resetAll = () => setRows(prev => prev.map(r => ({ ...r, order: r.suggested ?? 0 })));
  const sort = (key) => { if (sortKey === key) setSortDir(d => -d); else { setSortKey(key); setSortDir(1); } };
  const setTextFilter = (key, val) => setColTextFilters(f => ({ ...f, [key]: val }));
  const setCheckedFilter = (key, set) => setColCheckedFilters(f => ({ ...f, [key]: set }));
  const clearFilters = () => { setColTextFilters({}); setColCheckedFilters({}); };

  const COLS = [
    { key: "location", label: "Location" },
    { key: "product", label: "Product" },
    ...(hasCategory ? [{ key: "category", label: "Category" }] : []),
    { key: "daily_usage", label: usageConfig.mode === "calculated" ? `Daily Usage (÷${usageConfig.salesDays}d)` : "Daily Usage" },
    { key: "on_hand", label: "On Hand" },
    { key: "days_on_hand", label: "Days On Hand" },
    { key: "leadtime", label: "Lead Time" },
    { key: "suggested", label: "Suggested" },
    { key: "est_on_hand_after", label: "Est. On Hand After" },
  ];

  const activeFilterCount = COLS.filter(c => {
    const txt = colTextFilters[c.key] || "";
    const chk = colCheckedFilters[c.key];
    return txt || (chk && chk.mode === "some");
  }).length;

  const displayed = rows
    .filter(r => {
      if (hideZero && (Number(r.order) || 0) === 0) return false;
      return COLS.every(c => {
        const cellVal = String(r[c.key] ?? "");
        // text filter
        const txt = (colTextFilters[c.key] || "").toLowerCase();
        if (txt && !cellVal.toLowerCase().includes(txt)) return false;
        // checkbox filter: mode="all" means no restriction; mode="some" means must be in values
        const chk = colCheckedFilters[c.key];
        if (chk && chk.mode === "some") {
          if (!chk.values.has(cellVal)) return false;
        }
        return true;
      });
    })
    .sort((a, b) => {
      if (!sortKey) return 0;
      const av = a[sortKey], bv = b[sortKey];
      return (isNaN(Number(av)) ? String(av ?? "").localeCompare(String(bv ?? "")) : Number(av) - Number(bv)) * sortDir;
    });

  const totalOrder = rows.reduce((s, r) => s + (Number(r.order) || 0), 0);
  const totalCost = hasCost ? rows.reduce((s, r) => {
    const c = parseFloat(r.cost), o = Number(r.order) || 0;
    return s + (isNaN(c) ? 0 : c * o);
  }, 0) : 0;
  const editedCount = rows.filter(r => r.order !== r.suggested).length;

  // progress bar for cost vs limits
  const hasMin = orderLimits?.orderMin != null;
  const hasMax = orderLimits?.orderMax != null;

  const ProgressBar = ({ value, min, max, label }) => {
    const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
    const minPct = min && max > 0 ? Math.min(100, (min / max) * 100) : null;
    const overMax = value > max;
    const underMin = min != null && value < min;
    const barColor = overMax ? C.red : underMin ? C.orange : C.green;
    return (
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, color: C.text }}>{label}</span>
          <span style={{ color: overMax ? C.red : underMin ? C.orange : C.green, fontWeight: 700 }}>{fmtCurrency(value)}</span>
        </div>
        <div style={{ position: "relative", height: 8, background: C.border, borderRadius: 4, overflow: "visible" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 4, transition: "width .3s" }} />
          {minPct != null && (
            <div style={{ position: "absolute", top: -3, left: `${minPct}%`, width: 2, height: 14, background: C.orange, borderRadius: 1 }} title={`Min: ${fmtCurrency(min)}`} />
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginTop: 3 }}>
          {min != null && <span>Min: {fmtCurrency(min)}</span>}
          <span style={{ marginLeft: "auto" }}>Max: {fmtCurrency(max)}</span>
        </div>
      </div>
    );
  };

  const SortBtn = ({ k, label, align = "right" }) => (
    <button onClick={() => sort(k)} style={{ background: "none", border: "none", color: sortKey === k ? C.accent : C.muted, cursor: "pointer", fontWeight: 700, fontSize: 12, padding: 0, fontFamily: "inherit", whiteSpace: "nowrap", textAlign: align, width: "100%" }}>
      {label} {sortKey === k ? (sortDir > 0 ? "↑" : "↓") : "⇅"}
    </button>
  );

  const addRule = () => {
    if (!newRuleId.trim()) return;
    const rule = {
      productId: newRuleId.trim(),
      caseSize: newRuleCaseSize !== "" ? Number(newRuleCaseSize) : null,
      minQty: newRuleMin !== "" ? Number(newRuleMin) : null,
      maxQty: newRuleMax !== "" ? Number(newRuleMax) : null,
      maxOnHandAfter: newRuleMaxOnHand !== "" ? Number(newRuleMaxOnHand) : null,
    };
    const next = [...productRules.filter(r => r.productId !== rule.productId), rule];
    saveRules(next);
    applyRulesToRows(next);
    setNewRuleId(""); setNewRuleCaseSize(""); setNewRuleMin(""); setNewRuleMax(""); setNewRuleMaxOnHand("");
  };

  const removeRule = (productId) => {
    const next = productRules.filter(r => r.productId !== productId);
    saveRules(next);
    applyRulesToRows(next);
  };

  const parseRulesFile = (file) => {
    setRulesUploadError("");
    setRulesUploadPreview(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (json.length < 2) { setRulesUploadError("File appears empty."); return; }
        // Find header row
        const scanRows = json.slice(0, 10);
        const hdrIdx = scanRows.reduce((best, row, i) => {
          const filled = row.filter(c => c !== "").length;
          return filled > scanRows[best].filter(c => c !== "").length ? i : best;
        }, 0);
        const hdrs = json[hdrIdx].map(h => String(h).trim().toLowerCase());
        const dataRows = json.slice(hdrIdx + 1).filter(r => r.some(c => c !== ""));

        // Try to auto-detect columns by common names
        const findCol = (...names) => {
          for (const n of names) {
            const idx = hdrs.findIndex(h => h.includes(n));
            if (idx >= 0) return idx;
          }
          return -1;
        };
        const idCol = findCol("product", "item", "sku", "id", "part");
        const caseCol = findCol("case", "pack");
        const minCol = findCol("min qty", "min order", "minimum");
        const maxCol = findCol("max qty", "max order", "maximum");
        const maxOhCol = findCol("max on hand", "max oh", "on hand after", "max after");

        if (idCol < 0) { setRulesUploadError("Could not find a product ID column. Expected a column with 'product', 'item', 'sku', 'id', or 'part' in the name."); return; }

        const parsed = dataRows.map(r => ({
          productId: String(r[idCol] ?? "").trim(),
          caseSize: caseCol >= 0 && r[caseCol] !== "" ? Number(r[caseCol]) : null,
          minQty: minCol >= 0 && r[minCol] !== "" ? Number(r[minCol]) : null,
          maxQty: maxCol >= 0 && r[maxCol] !== "" ? Number(r[maxCol]) : null,
          maxOnHandAfter: maxOhCol >= 0 && r[maxOhCol] !== "" ? Number(r[maxOhCol]) : null,
          _detectedCols: { idCol, caseCol, minCol, maxCol, maxOhCol, hdrs },
        })).filter(r => r.productId !== "");

        if (parsed.length === 0) { setRulesUploadError("No valid product IDs found."); return; }
        setRulesUploadPreview({ rows: parsed, fileName: file.name, hdrs, idCol, caseCol, minCol, maxCol, maxOhCol });
      } catch {
        setRulesUploadError("Could not parse file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const mergeUploadedRules = (mode) => {
    // mode: "merge" = keep existing, add/update from file | "replace" = overwrite all
    const incoming = rulesUploadPreview.rows;
    let next;
    if (mode === "replace") {
      next = incoming;
    } else {
      // merge: existing rules take lower priority; file rules win for same product ID
      const existingById = Object.fromEntries(productRules.map(r => [r.productId, r]));
      incoming.forEach(r => { existingById[r.productId] = r; });
      next = Object.values(existingById);
    }
    saveRules(next);
    applyRulesToRows(next);
    setRulesUploadPreview(null);
    setRulesTab("manual");
  };

  const ActionBar = () => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <Btn variant="ghost" onClick={onBack}>← Back</Btn>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => setShowRulesPanel(v => !v)} style={{
          background: productRules.length > 0 ? C.purple + "22" : "transparent",
          border: `1px solid ${productRules.length > 0 ? C.purple : C.accentDim}`,
          borderRadius: 8, color: productRules.length > 0 ? C.purple : C.accent,
          fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "8px 16px",
          display: "flex", alignItems: "center", gap: 7,
        }}>
          ⚙ Product Rules
          {productRules.length > 0 && <span style={{ background: C.purple, color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 800, padding: "1px 7px" }}>{productRules.length}</span>}
        </button>
        <Btn onClick={() => onConfirm(rows)}>Confirm & Configure Export →</Btn>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* top action bar */}
      <ActionBar />

      {/* product rules panel */}
      {showRulesPanel && (
        <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.purple}55`, padding: "20px 24px" }}>
          {/* panel header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <span style={{ color: C.purple, fontWeight: 800, fontSize: 15 }}>⚙ Product Order Rules</span>
              <span style={{ color: C.muted, fontSize: 12, marginLeft: 10 }}>Saved across uploads · applied to suggested order qty</span>
            </div>
            <button onClick={() => setShowRulesPanel(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
          </div>

          {/* tab switcher */}
          <div style={{ display: "flex", gap: 0, marginBottom: 14, background: C.surface, borderRadius: 8, padding: 3, width: "fit-content" }}>
            {[["manual", "✏ Manual Entry"], ["upload", "📂 Upload File"]].map(([tab, label]) => (
              <button key={tab} onClick={() => { setRulesTab(tab); setRulesUploadPreview(null); setRulesUploadError(""); }}
                style={{ padding: "6px 16px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer", border: "none",
                  background: rulesTab === tab ? C.purple : "transparent",
                  color: rulesTab === tab ? "#fff" : C.muted, transition: "all .15s" }}>
                {label}
              </button>
            ))}
          </div>

          {/* ── MANUAL ENTRY TAB ── */}
          {rulesTab === "manual" && (
            <div style={{ background: C.surface, borderRadius: 10, padding: "14px 16px", marginBottom: 14, border: `1px solid ${C.border}` }}>
              <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 10px" }}>ADD / UPDATE RULE</p>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                <div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>PRODUCT ID</label>
                  <Input value={newRuleId} onChange={e => setNewRuleId(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && newRuleId.trim() && addRule()}
                    placeholder="e.g. A1746" style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>CASE SIZE</label>
                  <Input type="number" value={newRuleCaseSize} onChange={e => setNewRuleCaseSize(e.target.value)} placeholder="e.g. 12" style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>MIN QTY</label>
                  <Input type="number" value={newRuleMin} onChange={e => setNewRuleMin(e.target.value)} placeholder="e.g. 6" style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>MAX QTY</label>
                  <Input type="number" value={newRuleMax} onChange={e => setNewRuleMax(e.target.value)} placeholder="e.g. 144" style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>MAX ON HAND AFTER</label>
                  <Input type="number" value={newRuleMaxOnHand} onChange={e => setNewRuleMaxOnHand(e.target.value)} placeholder="e.g. 200" style={{ width: "100%" }} />
                </div>
                <Btn small onClick={addRule} disabled={!newRuleId.trim()}>Add</Btn>
              </div>
              <p style={{ color: C.muted, fontSize: 11, margin: "8px 0 0" }}>
                Case size rounds up to the next multiple (e.g. 14 → 24 with case 12). Min/max clamp after rounding. Press Enter after Product ID to save quickly.
              </p>
            </div>
          )}

          {/* ── UPLOAD FILE TAB ── */}
          {rulesTab === "upload" && (
            <div style={{ marginBottom: 14 }}>
              {!rulesUploadPreview ? (
                <div
                  onDragOver={e => { e.preventDefault(); setRulesDragging(true); }}
                  onDragLeave={() => setRulesDragging(false)}
                  onDrop={e => { e.preventDefault(); setRulesDragging(false); const f = e.dataTransfer.files[0]; if (f) parseRulesFile(f); }}
                  onClick={() => rulesFileRef.current?.click()}
                  style={{ border: `2px dashed ${rulesDragging ? C.purple : C.border}`, borderRadius: 10, padding: "28px 20px",
                    textAlign: "center", cursor: "pointer", background: rulesDragging ? C.purple + "0a" : C.surface, transition: "all .2s" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                  <p style={{ color: C.text, fontWeight: 700, margin: 0 }}>Drop a .xlsx, .xls, or .csv file here</p>
                  <p style={{ color: C.muted, fontSize: 12, marginTop: 6, marginBottom: 12 }}>
                    Needs a <strong>Product ID</strong> column. Optional: <strong>Case Size</strong>, <strong>Min</strong>, <strong>Max</strong> columns.
                  </p>
                  <Btn small variant="ghost" onClick={e => { e.stopPropagation(); rulesFileRef.current?.click(); }}>Browse</Btn>
                  <input ref={rulesFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                    onChange={e => { if (e.target.files[0]) parseRulesFile(e.target.files[0]); e.target.value = ""; }} />
                </div>
              ) : (
                <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${C.purple}44`, overflow: "hidden" }}>
                  {/* preview header */}
                  <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>📄 {rulesUploadPreview.fileName}</span>
                      <span style={{ color: C.muted, fontSize: 12, marginLeft: 10 }}>{rulesUploadPreview.rows.length} rules detected</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ color: C.muted, fontSize: 11 }}>Detected columns:</span>
                      {[["ID", rulesUploadPreview.hdrs[rulesUploadPreview.idCol]], rulesUploadPreview.caseCol >= 0 && ["Case", rulesUploadPreview.hdrs[rulesUploadPreview.caseCol]], rulesUploadPreview.minCol >= 0 && ["Min", rulesUploadPreview.hdrs[rulesUploadPreview.minCol]], rulesUploadPreview.maxCol >= 0 && ["Max", rulesUploadPreview.hdrs[rulesUploadPreview.maxCol]]].filter(Boolean).map(([label, col]) => (
                        <span key={label} style={{ background: C.purple + "22", color: C.purple, border: `1px solid ${C.purple}44`, borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{label}: {col}</span>
                      ))}
                    </div>
                  </div>
                  {/* scrollable preview rows */}
                  <div style={{ maxHeight: 180, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "inherit", fontSize: 12 }}>
                      <thead style={{ position: "sticky", top: 0, background: C.card }}>
                        <tr>
                          {["Product ID", "Case Size", "Min Qty", "Max Qty", "Max On Hand After"].map((h, i) => (
                            <th key={i} style={{ padding: "6px 12px", textAlign: i > 0 ? "right" : "left", color: C.muted, fontSize: 10, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rulesUploadPreview.rows.map((r, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${C.border}22` }}>
                            <td style={{ padding: "5px 12px", color: C.text, fontWeight: 600 }}>{r.productId}</td>
                            <td style={{ padding: "5px 12px", color: C.muted, textAlign: "right" }}>{r.caseSize ?? "—"}</td>
                            <td style={{ padding: "5px 12px", color: C.muted, textAlign: "right" }}>{r.minQty ?? "—"}</td>
                            <td style={{ padding: "5px 12px", color: C.muted, textAlign: "right" }}>{r.maxQty ?? "—"}</td>
                            <td style={{ padding: "5px 12px", color: C.muted, textAlign: "right" }}>{r.maxOnHandAfter ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* merge actions */}
                  <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ color: C.muted, fontSize: 12 }}>
                      {productRules.length > 0 ? (
                        <span>You have <strong style={{ color: C.text }}>{productRules.length}</strong> existing rule{productRules.length !== 1 ? "s" : ""}. How should this file be applied?</span>
                      ) : "No existing rules — file will be imported directly."}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => { setRulesUploadPreview(null); setRulesUploadError(""); }}
                        style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "6px 14px", cursor: "pointer" }}>Cancel</button>
                      {productRules.length > 0 && (
                        <button onClick={() => mergeUploadedRules("merge")}
                          style={{ background: C.accentDim, border: `1px solid ${C.accent}`, borderRadius: 6, color: C.accent, fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "6px 14px", cursor: "pointer" }}>
                          Merge (keep existing)
                        </button>
                      )}
                      <button onClick={() => mergeUploadedRules("replace")}
                        style={{ background: C.purple, border: "none", borderRadius: 6, color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "6px 14px", cursor: "pointer" }}>
                        {productRules.length > 0 ? "Replace All" : "Import"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {rulesUploadError && <p style={{ color: C.red, fontSize: 12, fontWeight: 600, marginTop: 8 }}>{rulesUploadError}</p>}
            </div>
          )}

          {/* existing rules table — always visible below both tabs */}
          <div style={{ marginTop: 6 }}>
            <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 8px" }}>
              SAVED RULES ({productRules.length})
              {productRules.length > 0 && (
                <button onClick={() => { saveRules([]); applyRulesToRows([]); }}
                  style={{ marginLeft: 10, background: "none", border: "none", color: C.red, fontSize: 11, cursor: "pointer", fontWeight: 700 }}>Clear all</button>
              )}
            </p>
            {productRules.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "12px 0" }}>No rules defined yet.</p>
            ) : (
              <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 220, borderRadius: 8, border: `1px solid ${C.border}` }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "inherit", fontSize: 13 }}>
                  <thead style={{ position: "sticky", top: 0 }}>
                    <tr style={{ background: C.surface }}>
                      {["Product ID", "Case Size", "Min Qty", "Max Qty", "Max On Hand After", ""].map((h, i) => (
                        <th key={i} style={{ padding: "8px 12px", textAlign: i > 0 ? "right" : "left", color: C.muted, fontSize: 11, fontWeight: 700, borderBottom: `1px solid ${C.border}`, background: C.surface }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {productRules.map(rule => {
                      const matchedRow = rows.find(r => String(r.product ?? "").trim() === rule.productId);
                      return (
                        <tr key={rule.productId} style={{ borderBottom: `1px solid ${C.border}33` }}>
                          <td style={{ padding: "8px 12px", color: C.text, fontWeight: 600 }}>
                            {rule.productId}
                            {!matchedRow && <span style={{ color: C.orange, fontSize: 11, marginLeft: 8 }}>⚠ not in file</span>}
                          </td>
                          <td style={{ padding: "8px 12px", color: C.muted, textAlign: "right" }}>{rule.caseSize ?? "—"}</td>
                          <td style={{ padding: "8px 12px", color: C.muted, textAlign: "right" }}>{rule.minQty ?? "—"}</td>
                          <td style={{ padding: "8px 12px", color: C.muted, textAlign: "right" }}>{rule.maxQty ?? "—"}</td>
                          <td style={{ padding: "8px 12px", color: rule.maxOnHandAfter != null ? C.purple : C.muted, textAlign: "right", fontWeight: rule.maxOnHandAfter != null ? 700 : 400 }}>{rule.maxOnHandAfter ?? "—"}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right" }}>
                            <Btn small variant="danger" onClick={() => removeRule(rule.productId)}>Remove</Btn>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* header + stats */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: C.text, fontSize: 22, fontWeight: 800, margin: 0 }}>Review & Edit Order</h2>
          <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: C.muted, fontSize: 13 }}>{displayed.length}{hideZero || activeFilterCount > 0 ? ` of ${rows.length}` : ""} items</span>
            <span style={{ color: C.accent, fontWeight: 700, fontSize: 13 }}>Total qty: {fmtNum(totalOrder, 0)}</span>
            {hasCost && <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>Total cost: {fmtCurrency(totalCost)}</span>}
            {editedCount > 0 && <Badge color={C.orange}>{editedCount} edited</Badge>}
            {usageConfig.mode === "calculated" && <Badge color={C.purple}>Calc. usage</Badge>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: C.muted, fontSize: 13 }}>Target:</span>
          <input type="range" min={1} max={90} value={targetLocal} onChange={(e) => recalc(Number(e.target.value))} style={{ width: 100, accentColor: C.accent }} />
          <span style={{ color: C.accent, fontWeight: 700, minWidth: 32 }}>{targetLocal}d</span>
          <Btn small variant="ghost" onClick={resetAll}>Reset All</Btn>
        </div>
      </div>

      {/* progress bars — units or dollars */}
      {(hasMin || hasMax) && (limitType === "units" || hasCost) && (() => {
        const trackVal = limitType === "dollars" ? totalCost : totalOrder;
        const fmt2 = limitType === "dollars" ? fmtCurrency : (v) => fmtNum(v, 0) + " units";
        const minV = hasMin ? orderLimits.orderMin : null;
        const maxV = hasMax ? orderLimits.orderMax : null;
        const overMax = maxV != null && trackVal > maxV;
        const underMin = minV != null && trackVal < minV;
        const barColor = overMax ? C.red : underMin ? C.orange : C.green;
        const label = limitType === "dollars" ? "Total Order Value" : "Total Order Units";
        return (
          <div style={{ background: C.card, borderRadius: 12, padding: "16px 20px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: C.text }}>{label}</span>
              <div style={{ display: "flex", gap: 12 }}>
                {minV != null && <span>Min: <span style={{ color: C.orange, fontWeight: 700 }}>{fmt2(minV)}</span></span>}
                {maxV != null && <span>Max: <span style={{ color: C.accent, fontWeight: 700 }}>{fmt2(maxV)}</span></span>}
                <span style={{ color: barColor, fontWeight: 700 }}>Current: {fmt2(trackVal)}</span>
              </div>
            </div>
            {/* if both min and max, show two-segment bar */}
            {minV != null && maxV != null ? (
              <div style={{ position: "relative", height: 10, background: C.border, borderRadius: 5, overflow: "visible" }}>
                <div style={{ width: `${Math.min(100, (trackVal / maxV) * 100)}%`, height: "100%", background: barColor, borderRadius: 5, transition: "width .3s" }} />
                {/* min marker */}
                <div style={{ position: "absolute", top: -4, left: `${Math.min(100, (minV / maxV) * 100)}%`, width: 2, height: 18, background: C.orange, borderRadius: 1 }} title={`Min: ${fmt2(minV)}`} />
              </div>
            ) : minV != null ? (
              <div style={{ height: 10, background: C.border, borderRadius: 5 }}>
                <div style={{ width: `${Math.min(100, (trackVal / minV) * 100)}%`, height: "100%", background: barColor, borderRadius: 5, transition: "width .3s" }} />
              </div>
            ) : (
              <div style={{ height: 10, background: C.border, borderRadius: 5 }}>
                <div style={{ width: `${Math.min(100, (trackVal / maxV) * 100)}%`, height: "100%", background: barColor, borderRadius: 5, transition: "width .3s" }} />
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginTop: 4 }}>
              <span>0</span>
              {minV != null && maxV == null && <span style={{ marginLeft: "auto" }}>Min: {fmt2(minV)}</span>}
              {maxV != null && <span style={{ marginLeft: "auto" }}>Max: {fmt2(maxV)}</span>}
            </div>
            {overMax && <p style={{ color: C.red, fontSize: 12, fontWeight: 700, margin: "6px 0 0" }}>⚠ Order exceeds maximum by {fmt2(trackVal - maxV)}</p>}
            {!overMax && underMin && <p style={{ color: C.orange, fontSize: 12, fontWeight: 700, margin: "6px 0 0" }}>⚠ Order is {fmt2(minV - trackVal)} below minimum</p>}
            {!overMax && !underMin && (minV != null || maxV != null) && <p style={{ color: C.green, fontSize: 12, fontWeight: 700, margin: "6px 0 0" }}>✓ Order is within limits</p>}
          </div>
        );
      })()}

      {/* filters + controls row */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: C.muted, fontSize: 13 }}>
          <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} style={{ accentColor: C.accent, width: 15, height: 15 }} />
          Hide zero-order items
        </label>
        {activeFilterCount > 0 && (
          <Btn small variant="ghost" onClick={clearFilters}>Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}</Btn>
        )}
      </div>

      {/* table */}
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "60vh", borderRadius: 12, border: `1px solid ${C.border}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "inherit" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            {/* sort headers */}
            <tr style={{ background: C.card, borderBottom: `1px solid ${C.border}` }}>
              {COLS.map((c) => {
                const isLoc = c.key === "location";
                const isProd = c.key === "product";
                const frozenStyle = isLoc
                  ? { position: "sticky", top: 0, left: 0, zIndex: 20, background: C.card, boxShadow: `inset 0 -1px 0 ${C.border}, inset -1px 0 0 ${C.border}`, minWidth: 120, maxWidth: 120 }
                  : isProd
                  ? { position: "sticky", top: 0, left: 120, zIndex: 20, background: C.card, boxShadow: `inset 0 -1px 0 ${C.border}, inset -2px 0 0 ${C.accentDim}`, minWidth: 160, maxWidth: 160 }
                  : { position: "sticky", top: 0, background: C.card, boxShadow: "inset 0 -1px 0 " + C.border };
                return (
                  <th key={c.key} style={{ padding: "10px 12px", textAlign: "left", ...frozenStyle }}>
                    <SortBtn k={c.key} label={c.label} align="left" />
                  </th>
                );
              })}
              <th style={{ padding: "10px 12px", textAlign: "right", color: C.muted, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", position: "sticky", top: 0, background: C.card, boxShadow: "inset 0 -1px 0 " + C.border }}>ORDER QTY</th>
              {hasCost && <th style={{ padding: "10px 12px", textAlign: "right", color: C.muted, fontSize: 12, fontWeight: 700, position: "sticky", top: 0, background: C.card, boxShadow: "inset 0 -1px 0 " + C.border }}>EXT. COST</th>}
              <th style={{ padding: "10px 12px", width: 50, position: "sticky", top: 0, background: C.card, boxShadow: "inset 0 -1px 0 " + C.border }} />
            </tr>
            {/* filter row — also sticky, sits just below the header row */}
            <tr style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
              {COLS.map((c) => {
                const isLoc = c.key === "location";
                const isProd = c.key === "product";
                const frozenStyle = isLoc
                  ? { position: "sticky", top: 41, left: 0, zIndex: 20, background: C.surface, boxShadow: `inset 0 -1px 0 ${C.border}, inset -1px 0 0 ${C.border}`, minWidth: 120, maxWidth: 120 }
                  : isProd
                  ? { position: "sticky", top: 41, left: 120, zIndex: 20, background: C.surface, boxShadow: `inset 0 -1px 0 ${C.border}, inset -2px 0 0 ${C.accentDim}`, minWidth: 160, maxWidth: 160 }
                  : { position: "sticky", top: 41, background: C.surface, boxShadow: "inset 0 -1px 0 " + C.border };
                return (
                  <th key={c.key} style={{ padding: "4px 8px", ...frozenStyle }}>
                    <ColumnFilter
                      colKey={c.key}
                      rows={rows}
                      textValue={colTextFilters[c.key] || ""}
                      onTextChange={val => setTextFilter(c.key, val)}
                      checkedFilter={colCheckedFilters[c.key] || { mode: "all", values: new Set() }}
                      onCheckedChange={cf => setCheckedFilter(c.key, cf)}
                    />
                  </th>
                );
              })}
              <th style={{ padding: "4px 8px", position: "sticky", top: 41, background: C.surface, boxShadow: "inset 0 -1px 0 " + C.border }} />
              {hasCost && <th style={{ padding: "4px 8px", position: "sticky", top: 41, background: C.surface, boxShadow: "inset 0 -1px 0 " + C.border }} />}
              <th style={{ position: "sticky", top: 41, background: C.surface, boxShadow: "inset 0 -1px 0 " + C.border }} />
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr><td colSpan={COLS.length + (hasCost ? 3 : 2)} style={{ padding: "24px", textAlign: "center", color: C.muted }}>No rows match the current filters.</td></tr>
            ) : displayed.map(r => {
              const edited = r.order !== r.suggested;
              const orderNum = Number(r.order) || 0;
              // Per-row flags only apply in units mode (dollar mode is an order-total check)
              const underMin = limitType === "units" && hasMin && orderNum > 0 && orderNum < orderLimits.orderMin;
              const overMax = limitType === "units" && hasMax && orderNum > orderLimits.orderMax;
              const limitFlag = overMax ? C.red : underMin ? C.orange : null;
              const extCost = hasCost && !isNaN(parseFloat(r.cost)) ? parseFloat(r.cost) * orderNum : null;
              const doh = r.days_on_hand;
              const dohColor = doh === null ? C.muted : doh < 3 ? C.red : doh < 7 ? C.orange : C.green;
              return (
                <tr key={r._idx} style={{ borderBottom: `1px solid ${C.border}`, background: edited ? C.orange + "08" : "transparent" }}>
                  <td style={{ padding: "9px 12px", color: C.text, fontSize: 13, position: "sticky", left: 0, zIndex: 5, background: edited ? "#2a2210" : C.bg, minWidth: 120, maxWidth: 120, boxShadow: `inset -1px 0 0 ${C.border}` }}>{r.location}</td>
                  <td style={{ padding: "9px 12px", color: C.text, fontWeight: 600, fontSize: 13, position: "sticky", left: 120, zIndex: 5, background: edited ? "#2a2210" : C.bg, minWidth: 160, maxWidth: 160, boxShadow: `inset -2px 0 0 ${C.accentDim}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      {r.product}
                      {r.appliedRule && <span title={`Rule: case=${r.appliedRule.caseSize ?? "—"} min=${r.appliedRule.minQty ?? "—"} max=${r.appliedRule.maxQty ?? "—"}`} style={{ color: C.purple, fontSize: 11, cursor: "help" }}>⚙</span>}
                    </span>
                  </td>
                  {hasCategory && <td style={{ padding: "9px 12px", color: C.muted, fontSize: 12 }}>{r.category}</td>}
                  <td style={{ padding: "9px 12px", color: usageConfig.mode === "calculated" ? C.purple : C.muted, fontSize: 13, textAlign: "right" }}>{fmtNum(r.daily_usage)}</td>
                  <td style={{ padding: "9px 12px", color: C.muted, fontSize: 13, textAlign: "right" }}>{fmtNum(r.on_hand)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right" }}>
                    <span style={{ color: dohColor, fontWeight: doh !== null && doh < 7 ? 700 : 400, fontSize: 13 }}>
                      {doh === null ? "—" : fmtNum(doh) + "d"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", color: C.muted, fontSize: 13, textAlign: "right" }}>{fmtNum(r.leadtime)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right" }}>
                    {r.suggested === null ? <span style={{ color: C.red, fontSize: 12 }}>N/A</span>
                      : <span style={{ color: r.suggested === 0 ? C.green : C.accent, fontWeight: 700 }}>{fmtNum(r.suggested, 0)}</span>}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right" }}>
                    {(() => {
                      const eoh = r.est_on_hand_after;
                      if (eoh === null || eoh === undefined) return <span style={{ color: C.muted }}>—</span>;
                      // Color: compare against maxOnHandAfter rule if present
                      const rule = r.appliedRule;
                      const overMax = rule?.maxOnHandAfter != null && eoh > rule.maxOnHandAfter;
                      const color = overMax ? C.red : eoh === 0 ? C.orange : C.green;
                      return (
                        <span style={{ color, fontWeight: 700, fontSize: 13 }} title={overMax ? `Exceeds max on hand after (${rule.maxOnHandAfter})` : undefined}>
                          {fmtNum(eoh, 0)}{overMax ? " ⚠" : ""}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Input type="number" value={r.order} onChange={(e) => setOrder(r._idx, e.target.value)}
                        style={{ width: 80, textAlign: "right", borderColor: limitFlag || (edited ? C.orange : C.border) }} />
                      {limitFlag && <span style={{ color: limitFlag, fontSize: 16, lineHeight: 1 }} title={overMax ? `Over max (${fmtNum(orderLimits.orderMax, 0)} units)` : `Under min (${fmtNum(orderLimits.orderMin, 0)} units)`}>⚠</span>}
                    </div>
                  </td>
                  {hasCost && <td style={{ padding: "9px 12px", color: C.muted, fontSize: 12, textAlign: "right" }}>{extCost !== null ? fmtCurrency(extCost) : "—"}</td>}
                  <td style={{ padding: "9px 6px" }}>
                    {edited && <Btn small variant="ghost" onClick={() => resetOne(r._idx)}>↩</Btn>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* bottom action bar */}
      <ActionBar />
    </div>
  );
}

// ── STEP 4: Export ────────────────────────────────────────────────────────────
const STOCK_COLS = [
  { key: "location", label: "Location" },
  { key: "product", label: "Product" },
  { key: "category", label: "Category" },
  { key: "daily_usage", label: "Daily Usage" },
  { key: "on_hand", label: "On Hand" },
  { key: "days_on_hand", label: "Days On Hand" },
  { key: "leadtime", label: "Lead Time" },
  { key: "cost", label: "Cost (per unit)" },
  { key: "suggested", label: "Suggested Qty" },
  { key: "est_on_hand_after", label: "Est. On Hand After" },
  { key: "order", label: "Order Qty" },
];

function ExportStep({ rows, onBack }) {
  const [cols, setCols] = useState([
    { id: 1, type: "data", key: "location", header: "Location" },
    { id: 2, type: "data", key: "product", header: "Product" },
    { id: 3, type: "data", key: "order", header: "Order Qty" },
  ]);
  const [nextId, setNextId] = useState(10);
  const [sheetName, setSheetName] = useState("Order");
  const [fileName, setFileName] = useState("order_export");
  const [colFilters, setColFilters] = useState({});
  const [previewSortKey, setPreviewSortKey] = useState(null);
  const [previewSortDir, setPreviewSortDir] = useState(1);
  const [excludeZeros, setExcludeZeros] = useState(false);
  const [exportFormat, setExportFormat] = useState("xlsx"); // "xlsx" | "csv" | "txt"

  // Editable local rows — must be declared before any derived values that use it
  const [localRows, setLocalRows] = useState(() => rows.map(r => ({ ...r })));
  const updateLocalOrder = (idx, val) => setLocalRows(prev => prev.map(r => r._idx === idx ? { ...r, order: val === "" ? "" : Number(val) } : r));
  const updateAllInGroup = (idxList, val) => setLocalRows(prev => prev.map(r => idxList.includes(r._idx) ? { ...r, order: Number(val) } : r));

  const setColFilter = (id, val) => setColFilters(f => ({ ...f, [id]: val }));
  const clearFilters = () => setColFilters({});
  const activeFilterCount = Object.values(colFilters).filter(v => v).length;

  const toggleSort = (id) => {
    if (previewSortKey === id) setPreviewSortDir(d => -d);
    else { setPreviewSortKey(id); setPreviewSortDir(1); }
  };

  // Rows that will actually be exported (respects excludeZeros)
  const exportRows = excludeZeros ? localRows.filter(r => (Number(r.order) || 0) > 0) : localRows;

  const filteredRows = exportRows.filter(r =>
    cols.every(c => {
      if (c.type === "blank") return true;
      const fv = (colFilters[c.id] || "").toLowerCase();
      return !fv || String(r[c.key] ?? "").toLowerCase().includes(fv);
    })
  ).sort((a, b) => {
    if (!previewSortKey) return 0;
    const col = cols.find(c => c.id === previewSortKey);
    if (!col || col.type === "blank") return 0;
    const av = a[col.key], bv = b[col.key];
    return (isNaN(Number(av)) ? String(av ?? "").localeCompare(String(bv ?? "")) : Number(av) - Number(bv)) * previewSortDir;
  });

  const addData = () => { setCols(c => [...c, { id: nextId, type: "data", key: "order", header: "Order Qty" }]); setNextId(n => n + 1); };
  const addBlank = () => { setCols(c => [...c, { id: nextId, type: "blank", header: "Notes" }]); setNextId(n => n + 1); };
  const remove = (id) => setCols(c => c.filter(col => col.id !== id));
  const update = (id, patch) => setCols(c => c.map(col => col.id === id ? { ...col, ...patch } : col));
  const move = (id, dir) => {
    const idx = cols.findIndex(c => c.id === id);
    const next = idx + dir;
    if (next < 0 || next >= cols.length) return;
    const arr = [...cols];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    setCols(arr);
  };

  const doExport = () => {
    const hdrs = cols.map(c => c.header || "");
    const data = exportRows.map(r => cols.map(c => c.type === "blank" ? "" : (r[c.key] ?? "")));
    const baseName = fileName || "order";

    if (exportFormat === "xlsx") {
      const ws = XLSX.utils.aoa_to_sheet([hdrs, ...data]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName || "Order");
      XLSX.writeFile(wb, `${baseName}.xlsx`);
    } else if (exportFormat === "csv") {
      const escape = (v) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csvContent = [hdrs, ...data].map(row => row.map(escape).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${baseName}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else if (exportFormat === "txt") {
      // Fixed-width tab-delimited text
      const txtContent = [hdrs, ...data].map(row => row.join("\t")).join("\n");
      const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${baseName}.txt`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  // summary stats (derived from localRows)
  const orderedRows = localRows.filter(r => (Number(r.order) || 0) > 0);
  const locations = [...new Set(orderedRows.map(r => r.location))].filter(Boolean);
  const totalQty = orderedRows.reduce((s, r) => s + (Number(r.order) || 0), 0);

  // Total cost — available if rows have a cost field populated
  const hasCostData = localRows.some(r => r.cost !== "" && r.cost != null && !isNaN(parseFloat(r.cost)));
  const totalCostExport = hasCostData
    ? orderedRows.reduce((s, r) => {
        const c = parseFloat(r.cost), o = Number(r.order) || 0;
        return s + (isNaN(c) ? 0 : c * o);
      }, 0)
    : null;

  // Callout configuration state
  const [mostMode, setMostMode] = useState("unit");
  const [leastMode, setLeastMode] = useState("unit");
  const [mostN, setMostN] = useState(1);
  const [leastN, setLeastN] = useState(1);
  const [mostBulkVal, setMostBulkVal] = useState("");
  const [leastBulkVal, setLeastBulkVal] = useState("");

  const sortedDesc = [...new Set(orderedRows.map(r => Number(r.order) || 0))].sort((a, b) => b - a);
  const sortedAsc  = [...sortedDesc].reverse();

  const mostQtys = mostMode === "unit"
    ? sortedDesc.filter(q => q >= sortedDesc[0] - (mostN - 1)).slice(0, mostN)
    : sortedDesc.slice(0, mostN);
  const leastQtys = leastMode === "unit"
    ? sortedAsc.filter(q => q <= sortedAsc[0] + (leastN - 1)).slice(0, leastN)
    : sortedAsc.slice(0, leastN);

  const maxRows = orderedRows.filter(r => mostQtys.includes(Number(r.order) || 0));
  const minRows = orderedRows.filter(r => leastQtys.includes(Number(r.order) || 0));
  const maxQty = sortedDesc[0] ?? null;
  const minQty = sortedAsc[0] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ color: C.text, fontSize: 22, fontWeight: 800, margin: 0 }}>Configure Export</h2>
        <p style={{ color: C.muted, marginTop: 4 }}>Build your custom column layout, then download your order file</p>
      </div>

      {/* order summary */}
      <div style={{ background: C.card, borderRadius: 12, padding: "18px 22px", border: `1px solid ${C.accentDim}` }}>
        <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, margin: "0 0 14px" }}>ORDER SUMMARY</p>

        {/* Top row: stats + two resizable callout panels side by side */}
        <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>

          {/* stat pills */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 130, flex: "0 0 auto" }}>
            {totalCostExport !== null && (
              <div style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.green}44` }}>
                <div style={{ color: C.muted, fontSize: 10, fontWeight: 700 }}>TOTAL ORDER $</div>
                <div style={{ color: C.green, fontWeight: 800, fontSize: 20, marginTop: 2 }}>{fmtCurrency(totalCostExport)}</div>
              </div>
            )}
            <div style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.border}` }}>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700 }}>PRODUCTS ORDERED</div>
              <div style={{ color: C.text, fontWeight: 800, fontSize: 22, marginTop: 2 }}>{orderedRows.length}</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.border}` }}>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700 }}>LOCATIONS</div>
              <div style={{ color: C.text, fontWeight: 800, fontSize: 22, marginTop: 2 }}>{locations.length || "—"}</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.border}` }}>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700 }}>TOTAL UNITS</div>
              <div style={{ color: C.accent, fontWeight: 800, fontSize: 22, marginTop: 2 }}>{fmtNum(totalQty, 0)}</div>
            </div>
          </div>

          {/* MOST ORDERED — resizable via resize: horizontal */}
          {(() => {
            const CalloutCard = ({ title, accentColor, theRows, mode, setMode, n, setN, bulkVal, setBulkVal, sortedList, label }) => (
              <div style={{ flex: 1, minWidth: 220, background: C.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}`, resize: "horizontal", overflow: "auto", minHeight: 180 }}>
                {/* header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6, flexWrap: "wrap" }}>
                  <span style={{ color: C.muted, fontSize: 11, fontWeight: 700 }}>{title}</span>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 3 }}>
                      {[["unit","by qty"],["group","by rank"]].map(([m,l]) => (
                        <button key={m} onClick={() => setMode(m)} style={{ padding: "2px 7px", borderRadius: 4, fontFamily: "inherit", fontWeight: 700, fontSize: 10, cursor: "pointer", border: `1px solid ${mode===m ? accentColor : C.border}`, background: mode===m ? accentColor+"33" : "transparent", color: mode===m ? accentColor : C.muted }}>{l}</button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <button onClick={() => setN(v => Math.max(1, v-1))} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 3, color: C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 11, width: 18, height: 18, lineHeight: 1, padding: 0 }}>−</button>
                      <span style={{ color: C.text, fontSize: 11, fontWeight: 700, minWidth: 14, textAlign: "center" }}>{n}</span>
                      <button onClick={() => setN(v => Math.min(sortedList.length || 1, v+1))} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 3, color: C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 11, width: 18, height: 18, lineHeight: 1, padding: 0 }}>+</button>
                    </div>
                  </div>
                </div>

                {theRows.length === 0 ? <div style={{ color: C.muted, fontSize: 13 }}>—</div> : (<>
                  {/* summary line */}
                  <div style={{ color: accentColor, fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
                    {label}
                    <span style={{ color: C.muted, fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{theRows.length} product{theRows.length !== 1 ? "s" : ""}</span>
                  </div>

                  {/* bulk update bar */}
                  <div style={{ display: "flex", gap: 5, marginBottom: 8, alignItems: "center" }}>
                    <input
                      type="number" value={bulkVal} onChange={e => setBulkVal(e.target.value)}
                      placeholder="New qty for all"
                      style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontFamily: "inherit", fontSize: 11, padding: "4px 8px", outline: "none" }}
                    />
                    <button
                      onClick={() => { if (bulkVal !== "") { updateAllInGroup(theRows.map(r => r._idx), bulkVal); setBulkVal(""); } }}
                      disabled={bulkVal === ""}
                      style={{ background: bulkVal !== "" ? accentColor : C.border, border: "none", borderRadius: 5, color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: 11, padding: "4px 10px", cursor: bulkVal !== "" ? "pointer" : "not-allowed", opacity: bulkVal !== "" ? 1 : 0.4, whiteSpace: "nowrap" }}
                    >Update All</button>
                  </div>

                  {/* scrollable product list */}
                  <div style={{ maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                    {theRows.map((r) => (
                      <div key={r._idx} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: C.text, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{r.product}</span>
                        <input
                          type="number"
                          value={r.order}
                          onChange={e => updateLocalOrder(r._idx, e.target.value)}
                          style={{ width: 60, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, color: accentColor, fontFamily: "inherit", fontSize: 11, fontWeight: 700, padding: "2px 6px", outline: "none", textAlign: "right" }}
                        />
                      </div>
                    ))}
                  </div>
                </>)}
              </div>
            );

            return (<>
              <CalloutCard
                title="MOST ORDERED" accentColor={C.accent}
                theRows={maxRows} mode={mostMode} setMode={setMostMode}
                n={mostN} setN={setMostN} sortedList={sortedDesc}
                bulkVal={mostBulkVal} setBulkVal={setMostBulkVal}
                label={mostMode === "unit" && mostN === 1 ? `${fmtNum(maxQty, 0)} units` : `Top ${mostN} ${mostMode === "group" ? "rank" : "qty"}${mostN > 1 ? "s" : ""}`}
              />
              <CalloutCard
                title="LEAST ORDERED" accentColor={C.orange}
                theRows={minRows.filter(() => minQty !== maxQty)} mode={leastMode} setMode={setLeastMode}
                n={leastN} setN={setLeastN} sortedList={sortedAsc}
                bulkVal={leastBulkVal} setBulkVal={setLeastBulkVal}
                label={leastMode === "unit" && leastN === 1 ? `${fmtNum(minQty, 0)} units` : `Bottom ${leastN} ${leastMode === "group" ? "rank" : "qty"}${leastN > 1 ? "s" : ""}`}
              />
            </>);
          })()}
        </div>
      </div>

      {/* file settings */}
      <div style={{ background: C.card, borderRadius: 12, padding: "18px 20px", border: `1px solid ${C.border}` }}>
        <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, margin: "0 0 14px" }}>EXPORT SETTINGS</p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          {/* file name */}
          <div style={{ flex: 2, minWidth: 160 }}>
            <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 5 }}>FILE NAME</label>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Input value={fileName} onChange={(e) => setFileName(e.target.value)} style={{ flex: 1 }} />
              <span style={{ color: C.muted, fontSize: 13, whiteSpace: "nowrap" }}>.{exportFormat}</span>
            </div>
          </div>
          {/* sheet name (xlsx only) */}
          {exportFormat === "xlsx" && (
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 5 }}>SHEET NAME</label>
              <Input value={sheetName} onChange={(e) => setSheetName(e.target.value)} style={{ width: "100%" }} />
            </div>
          )}
          {/* format picker */}
          <div style={{ minWidth: 200 }}>
            <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 5 }}>FORMAT</label>
            <div style={{ display: "flex", gap: 5 }}>
              {[["xlsx", "Excel (.xlsx)"], ["csv", "CSV (.csv)"], ["txt", "Text (.txt)"]].map(([fmt, label]) => (
                <button key={fmt} onClick={() => setExportFormat(fmt)} style={{
                  flex: 1, padding: "6px 8px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                  border: `1px solid ${exportFormat === fmt ? C.accent : C.border}`,
                  background: exportFormat === fmt ? C.accentDim : "transparent",
                  color: exportFormat === fmt ? C.accent : C.muted,
                  whiteSpace: "nowrap",
                }}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        {/* exclude zeros toggle */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: C.text, fontSize: 13 }}>
            <input type="checkbox" checked={excludeZeros} onChange={e => setExcludeZeros(e.target.checked)}
              style={{ accentColor: C.accent, width: 15, height: 15 }} />
            <span>Exclude zero-quantity rows from export</span>
          </label>
          {excludeZeros && (
            <span style={{ color: C.muted, fontSize: 12 }}>
              {localRows.filter(r => (Number(r.order) || 0) === 0).length} rows excluded ·{" "}
              <span style={{ color: C.accent, fontWeight: 700 }}>{exportRows.length} rows will be exported</span>
            </span>
          )}
        </div>
      </div>

      {/* column builder */}
      <div style={{ background: C.card, borderRadius: 12, padding: "20px 24px", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ color: C.text, fontWeight: 700 }}>Column Layout</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn small variant="ghost" onClick={addData}>+ Data Column</Btn>
            <Btn small variant="ghost" onClick={addBlank}>+ Blank Column</Btn>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cols.map((col, i) => (
            <div key={col.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 8, padding: "10px 14px", border: `1px solid ${col.type === "blank" ? C.border : C.accentDim}` }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button onClick={() => move(col.id, -1)} disabled={i === 0} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 10, padding: 0 }}>▲</button>
                <button onClick={() => move(col.id, 1)} disabled={i === cols.length - 1} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 10, padding: 0 }}>▼</button>
              </div>
              <Badge color={col.type === "blank" ? C.muted : C.accent}>{col.type === "blank" ? "blank" : "data"}</Badge>
              <div style={{ flex: 1, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ color: C.muted, fontSize: 10, display: "block", marginBottom: 3 }}>COLUMN HEADER</label>
                  <Input value={col.header} onChange={(e) => update(col.id, { header: e.target.value })} style={{ width: "100%" }} />
                </div>
                {col.type === "data" && (
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={{ color: C.muted, fontSize: 10, display: "block", marginBottom: 3 }}>DATA SOURCE</label>
                    <Select value={col.key} onChange={(e) => update(col.id, { key: e.target.value })} style={{ width: "100%" }}>
                      {STOCK_COLS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </Select>
                  </div>
                )}
              </div>
              <Btn small variant="danger" onClick={() => remove(col.id)}>✕</Btn>
            </div>
          ))}
          {cols.length === 0 && <p style={{ color: C.muted, textAlign: "center", padding: "20px 0" }}>No columns yet. Add some above.</p>}
        </div>
      </div>

      {/* filterable preview */}
      {cols.length > 0 && rows.length > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, margin: 0 }}>EXPORT PREVIEW</p>
              <span style={{ color: C.muted, fontSize: 12 }}>
                {filteredRows.length} of {rows.length} rows
                {activeFilterCount > 0 && <span style={{ color: C.accent, marginLeft: 6 }}>({activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active)</span>}
              </span>
            </div>
            {activeFilterCount > 0 && <Btn small variant="ghost" onClick={clearFilters}>Clear Filters</Btn>}
          </div>
          <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${C.border}`, maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "inherit", fontSize: 13 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: C.card }}>
                  {cols.map(c => (
                    <th key={c.id} style={{ padding: "8px 12px", textAlign: "left", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", background: C.card }}>
                      <button onClick={() => c.type !== "blank" && toggleSort(c.id)}
                        style={{ background: "none", border: "none", color: C.accent, cursor: c.type === "blank" ? "default" : "pointer", fontWeight: 700, fontSize: 13, padding: 0, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
                        {c.header || <em style={{ color: C.muted }}>untitled</em>}
                        {c.type !== "blank" && <span style={{ color: previewSortKey === c.id ? C.accent : C.border, fontSize: 10 }}>{previewSortKey === c.id ? (previewSortDir > 0 ? "▲" : "▼") : "⇅"}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
                <tr style={{ background: C.surface }}>
                  {cols.map(c => (
                    <th key={c.id} style={{ padding: "4px 8px", borderBottom: `1px solid ${C.border}`, background: C.surface }}>
                      {c.type === "blank" ? <div style={{ height: 28 }} /> : (
                        <input value={colFilters[c.id] || ""} onChange={e => setColFilter(c.id, e.target.value)} placeholder="Filter…"
                          style={{ width: "100%", background: C.card, border: `1px solid ${colFilters[c.id] ? C.accent : C.border}`, borderRadius: 4, color: C.text, fontFamily: "inherit", fontSize: 11, padding: "3px 7px", outline: "none", boxSizing: "border-box" }} />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={cols.length} style={{ padding: "24px", textAlign: "center", color: C.muted }}>No rows match the current filters.</td></tr>
                ) : filteredRows.map((r, ri) => (
                  <tr key={ri} style={{ borderBottom: `1px solid ${C.border}33`, background: ri % 2 === 0 ? "transparent" : C.surface + "44" }}>
                    {cols.map(c => (
                      <td key={c.id} style={{ padding: "7px 12px", color: c.type === "blank" ? C.muted : C.text, whiteSpace: "nowrap" }}>
                        {c.type === "blank" ? <em style={{ color: C.border }}>—</em> : String(r[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn variant="ghost" onClick={onBack}>← Back</Btn>
        <Btn variant="success" onClick={doExport} disabled={cols.length === 0}>⬇ Download {fileName || "order"}.{exportFormat}</Btn>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);
  const [fileData, setFileData] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [targetDays, setTargetDays] = useState(14);
  const [usageConfig, setUsageConfig] = useState(null);
  const [manualEntry, setManualEntry] = useState(null);
  const [orderLimits, setOrderLimits] = useState(null);
  const [finalRows, setFinalRows] = useState(null);
  // Session memory: full MapStep state so Back doesn't reset the form
  const [savedMapState, setSavedMapState] = useState(null);

  // When a new file is uploaded, find the best matching saved mapping from localStorage
  const [suggestion, setSuggestion] = useState(null);

  const handleFileUploaded = (d) => {
    setFileData(d);
    setSavedMapState(null); // fresh file = clear session memory
    setSuggestion(findBestSavedMapping(d.headers));
    setStep(1);
  };

  const handleMapConfirm = (m, td, uc, me, ol, ms) => {
    setMapping(m); setTargetDays(td); setUsageConfig(uc);
    setManualEntry(me); setOrderLimits(ol);
    setSavedMapState(ms); // store full state for if user goes Back
    setStep(2);
  };

  // When user goes Back from Review → Map, restore their previous MapStep state
  const handleReviewBack = () => {
    setStep(1);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", color: C.text, paddingBottom: 60 }}>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "18px 32px", display: "flex", alignItems: "center", gap: 14, marginBottom: 40 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, #7b5bf7)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📦</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>OrderGen</div>
          <div style={{ color: C.muted, fontSize: 12 }}>Inventory-driven order planning</div>
        </div>
      </div>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 24px" }}>
        <StepBar current={step} />
        {step === 0 && <UploadStep onData={handleFileUploaded} />}
        {step === 1 && fileData && (
          <MapStep
            headers={fileData.headers} rows={fileData.rows} fileName={fileData.fileName}
            initialState={savedMapState}
            suggestion={!savedMapState ? suggestion : null}
            onConfirm={handleMapConfirm}
          />
        )}
        {step === 2 && fileData && mapping && usageConfig && (
          <ReviewStep rawRows={fileData.rows} headers={fileData.headers} mapping={mapping} targetDays={targetDays}
            usageConfig={usageConfig} manualEntry={manualEntry} orderLimits={orderLimits}
            onConfirm={(rows) => { setFinalRows(rows); setStep(3); }} onBack={handleReviewBack} />
        )}
        {step === 3 && finalRows && <ExportStep rows={finalRows} onBack={() => setStep(2)} />}
      </div>
    </div>
  );
}
