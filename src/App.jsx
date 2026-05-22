import { useState, useRef, useEffect, Component } from "react";
import * as XLSX from "xlsx";

const VERSION = "v1.0";

// Error boundary to surface runtime crashes instead of blank-screening
class ErrorBoundary extends Component {
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

// ── helpers ───────────────────────────────────────────────────────────────────
const fmtNum = (n, decimals = 1) =>
  n === null || n === undefined || n === "" || isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: decimals });

// For usage: show up to 6 decimal places for sub-1 values, 1 decimal otherwise
const fmtUsage = (n) => {
  if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—";
  const num = Number(n);
  if (num === 0) return "0";
  const abs = Math.abs(num);
  if (abs < 1 && abs > 0) {
    // Find the first significant digit and show up to 6 decimal places
    return num.toLocaleString(undefined, { maximumFractionDigits: 6, minimumSignificantDigits: 1 });
  }
  return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
};

const fmtCurrency = (n) =>
  n === null || n === undefined || n === "" || isNaN(Number(n))
    ? "—"
    : "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Shared sub-components ─────────────────────────────────────────────────────

// Input that keeps a local draft value and only commits to parent on blur / Enter.
// Prevents parent re-renders from losing focus while the user is mid-typing.
function DraftInput({ value, onCommit, style, min = 0, ...rest }) {
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

// Callout card shown in Review step (Most Ordered / Least Ordered).
// Module-level so React never remounts it due to a new function reference.
function OrderCalloutCard({ title, accentColor, theRows, mode, setMode, n, setN, sortedList, label, onSetOrder, onSetGroupOrders }) {
  const [bulkVal, setBulkVal] = useState("");
  return (
    <div style={{ flex: 1, minWidth: 220, background: C.surface, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}`, overflow: "auto", minHeight: 120 }}>
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

// ── Location multi-select (used in ManualBuildStep) ──────────────────────────
function LocationMultiSelect({ locations, selected, onChange, placeholder = "Select locations…" }) {
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

// ── Manual Order Build step ───────────────────────────────────────────────────
function ManualBuildStep({ onConfirm, onBack }) {
  const [locations, setLocations] = useState([]);
  const [newLocInput, setNewLocInput] = useState("");
  const [orderEntries, setOrderEntries] = useState([]); // { id, product, location, qty }
  const [newProduct, setNewProduct] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newLocs, setNewLocs] = useState(new Set());

  const addLocation = () => {
    const loc = newLocInput.trim();
    if (!loc || locations.includes(loc)) { setNewLocInput(""); return; }
    setLocations(prev => [...prev, loc]);
    setNewLocInput("");
  };
  const removeLocation = (loc) => {
    setLocations(prev => prev.filter(l => l !== loc));
    setNewLocs(prev => { const n = new Set(prev); n.delete(loc); return n; });
  };

  const addProduct = () => {
    const prod = newProduct.trim();
    if (!prod) return;
    const qty = newQty === "" ? 0 : Math.max(0, Number(newQty));
    const targetLocs = newLocs.size > 0 ? [...newLocs] : [""];
    setOrderEntries(prev => [...prev, ...targetLocs.map(loc => ({ id: `${Date.now()}-${Math.random()}`, product: prod, location: loc, qty }))]);
    setNewProduct(""); setNewQty(""); setNewLocs(new Set());
  };

  const handleConfirm = () => {
    const rows = orderEntries.map((e, i) => ({
      _idx: i, product: e.product, location: e.location, order: e.qty,
      daily_usage: "", on_hand: "", leadtime: "", category: "", cost: "", uom: "",
      min_on_hand: "", max_on_hand: "", suggested: e.qty,
      days_on_hand: null, est_on_hand_after: null, appliedRule: null,
      uomConv: { onHandToOrderFactor: 1, orderToOnHandFactor: 1, isPack: false, packSize: 1, hasConversion: false },
      _isTotal: false, _rawUsage: "", _minConstrained: false, _maxConstrained: false,
      on_hand_uom: "", order_uom: "", units_ordered: null, _manuallyBuilt: true,
    }));
    onConfirm(rows, locations);
  };

  const existingProducts = [...new Set(orderEntries.map(e => e.product))].sort();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: C.text, fontSize: 22, fontWeight: 800, margin: 0 }}>Build Order Manually</h2>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>Add locations (stores/warehouses), then enter products and quantities</p>
        </div>
        <Btn variant="ghost" onClick={onBack}>← Back</Btn>
      </div>

      {/* 1 — Locations */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px 20px" }}>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📍 Step 1 — Locations</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <Input value={newLocInput} onChange={e => setNewLocInput(e.target.value)} placeholder="e.g. Store 23, Warehouse A"
            onKeyDown={e => { if (e.key === "Enter") addLocation(); }} style={{ flex: 1 }} />
          <Btn small onClick={addLocation} disabled={!newLocInput.trim()}>Add</Btn>
        </div>
        {locations.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {locations.map(loc => (
              <span key={loc} style={{ display: "flex", alignItems: "center", gap: 5, background: C.accent + "22", border: `1px solid ${C.accent}44`, borderRadius: 20, padding: "4px 10px", fontSize: 13, color: C.accent }}>
                {loc}
                <button onClick={() => removeLocation(loc)} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
              </span>
            ))}
          </div>
        ) : (
          <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>No locations added — products will be entered as general order items (no location split)</p>
        )}
      </div>

      {/* 2 — Add Products */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px 20px" }}>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 14 }}>📦 Step 2 — Add Products</div>
        <datalist id="mbs-prod-list">{existingProducts.map(p => <option key={p} value={p} />)}</datalist>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 2, minWidth: 150 }}>
            <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>PRODUCT ID</div>
            <Input value={newProduct} onChange={e => setNewProduct(e.target.value)} placeholder="Product / Item #"
              list="mbs-prod-list" onKeyDown={e => { if (e.key === "Enter") addProduct(); }} style={{ width: "100%" }} />
          </div>
          {locations.length > 0 && (
            <div style={{ flex: 2, minWidth: 160 }}>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>LOCATION(S)</div>
              <LocationMultiSelect locations={locations} selected={newLocs} onChange={setNewLocs} />
            </div>
          )}
          <div>
            <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>QTY</div>
            <Input type="number" min={0} value={newQty} onChange={e => setNewQty(e.target.value)}
              placeholder="0" style={{ width: 80 }} onKeyDown={e => { if (e.key === "Enter") addProduct(); }} />
          </div>
          <Btn onClick={addProduct} disabled={!newProduct.trim()}>+ Add</Btn>
        </div>
        {locations.length > 0 && newLocs.size === 0 && (
          <p style={{ color: C.muted, fontSize: 11, marginTop: 8, margin: "8px 0 0" }}>No location selected — will add as a general item (no specific location)</p>
        )}
        {newLocs.size > 1 && (
          <p style={{ color: C.accent, fontSize: 11, marginTop: 8, margin: "8px 0 0" }}>Will create {newLocs.size} rows (one per location) with quantity {newQty || 0} each</p>
        )}
      </div>

      {/* 3 — Order list */}
      {orderEntries.length > 0 && (
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Order Items <span style={{ color: C.muted, fontSize: 12, fontWeight: 400 }}>({orderEntries.length} row{orderEntries.length !== 1 ? "s" : ""})</span></span>
            <Btn small variant="danger" onClick={() => setOrderEntries([])}>Clear All</Btn>
          </div>
          <div style={{ overflowY: "auto", maxHeight: 400, display: "flex", justifyContent: "center" }}>
            <table style={{ borderCollapse: "collapse", fontFamily: "inherit", width: "auto", minWidth: 400 }}>
              <thead style={{ position: "sticky", top: 0, background: C.card }}>
                <tr>
                  {["PRODUCT", "LOCATION", "QTY", ""].map((h, i) => (
                    <th key={i} style={{ padding: "8px 20px", textAlign: "center", color: C.muted, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orderEntries.map(e => (
                  <tr key={e.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 20px", color: C.text, fontSize: 13, textAlign: "center" }}>{e.product}</td>
                    <td style={{ padding: "6px 20px", color: C.muted, fontSize: 12, textAlign: "center" }}>{e.location || <span style={{ fontStyle: "italic" }}>—</span>}</td>
                    <td style={{ padding: "6px 20px", textAlign: "center" }}>
                      <DraftInput value={e.qty} onCommit={v => setOrderEntries(prev => prev.map(x => x.id === e.id ? { ...x, qty: Number(v) } : x))}
                        style={{ width: 70, textAlign: "center", background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, color: C.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "2px 6px", outline: "none" }} />
                    </td>
                    <td style={{ padding: "6px 12px", textAlign: "center" }}>
                      <button onClick={() => setOrderEntries(prev => prev.filter(x => x.id !== e.id))} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm */}
      {orderEntries.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn onClick={handleConfirm}>Review Order →</Btn>
        </div>
      )}
    </div>
  );
}

function calcOrder(row, targetDays, onHandToOrderFactor = 1, onHandOverride = null) {
  const usage = parseFloat(row.daily_usage);
  const onHand = onHandOverride ?? parseFloat(row.on_hand);
  const lead = parseFloat(row.leadtime);
  if (isNaN(usage) || isNaN(onHand) || isNaN(lead)) return null;
  return Math.ceil(Math.max(0, (usage * (lead + targetDays) - onHand) * onHandToOrderFactor));
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

const LS_UOM_KEY = "ordergen_uom_v1";
const LS_CATEGORY_UOM_KEY = "ordergen_category_uom_v1";
function loadUomMappings() {
  try { return JSON.parse(localStorage.getItem(LS_UOM_KEY) || "[]"); } catch { return []; }
}
function saveUomMappings(m) {
  try { localStorage.setItem(LS_UOM_KEY, JSON.stringify(m)); } catch {}
}
function loadCategoryUom() {
  try { return JSON.parse(localStorage.getItem(LS_CATEGORY_UOM_KEY) || "{}"); } catch { return {}; }
}
function saveCategoryUom(s) {
  try { localStorage.setItem(LS_CATEGORY_UOM_KEY, JSON.stringify(s)); } catch {}
}

const LS_PS_KEY = "ordergen_prefix_suffix_v1";
function loadPrefixSuffixRules() {
  try { return JSON.parse(localStorage.getItem(LS_PS_KEY) || "[]"); } catch { return []; }
}
function savePrefixSuffixRules(r) {
  try { localStorage.setItem(LS_PS_KEY, JSON.stringify(r)); } catch {}
}

const LS_CONNECTIONS_KEY = "ordergen_connections_v1";
function loadConnections() {
  try { return JSON.parse(localStorage.getItem(LS_CONNECTIONS_KEY) || "[]"); } catch { return []; }
}
function saveConnections(conns) {
  try { localStorage.setItem(LS_CONNECTIONS_KEY, JSON.stringify(conns)); } catch {}
}

const LS_IGNORE_MAX_KEY = "ordergen_ignore_max_v1";
function loadIgnoreMax() {
  try { return JSON.parse(localStorage.getItem(LS_IGNORE_MAX_KEY) || "null") || { categories: [], products: [] }; } catch { return { categories: [], products: [] }; }
}
function saveIgnoreMax(v) {
  try { localStorage.setItem(LS_IGNORE_MAX_KEY, JSON.stringify(v)); } catch {}
}

const LS_USAGE_ADJ_KEY = "ordergen_usage_adj_v1";
function loadUsageAdjustments() {
  try { return JSON.parse(localStorage.getItem(LS_USAGE_ADJ_KEY) || "null") || { global: null, categories: {}, products: {} }; } catch { return { global: null, categories: {}, products: {} }; }
}
function saveUsageAdjustments(a) {
  try { localStorage.setItem(LS_USAGE_ADJ_KEY, JSON.stringify(a)); } catch {}
}

const LS_TABLE_PREFS_KEY = "ordergen_table_prefs_v1";
function loadTablePrefs() {
  try { return JSON.parse(localStorage.getItem(LS_TABLE_PREFS_KEY) || "{}"); } catch { return {}; }
}
function saveTablePrefs(p) {
  try { localStorage.setItem(LS_TABLE_PREFS_KEY, JSON.stringify(p)); } catch {}
}

function isTotalRow(row) {
  const val = String(row.product ?? "").trim().toLowerCase().replace(/[:\s*.-]+$/, "").trim();
  if (!val) return false;
  return /^(grand\s+)?(sub[-\s]?)?totals?(\s+(items?|products?|rows?|units?|qty|quantity|amount|value|cost|price))?$/.test(val)
    || val === "order total" || val === "order totals";
}

function buildPendingIndex(po) {
  if (!po.rawRows || !po.colMap.product || !po.colMap.qty) return new Map();
  const locI = po.headers.indexOf(po.colMap.location);
  const prodI = po.headers.indexOf(po.colMap.product);
  const qtyI = po.headers.indexOf(po.colMap.qty);
  if (prodI < 0 || qtyI < 0) return new Map();
  return po.rawRows.reduce((m, row) => {
    const loc = locI >= 0 ? String(row[locI] ?? "").trim() : "";
    const prod = String(row[prodI] ?? "").trim();
    if (!prod) return m;
    const key = `${loc}|${prod}`.toLowerCase();
    const qty = parseFloat(String(row[qtyI] ?? "")) || 0;
    m.set(key, (m.get(key) || 0) + qty);
    return m;
  }, new Map());
}

function autoPendingColMap(headers) {
  const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, "");
  const loc = headers.find(h => ["location","loc","store","site","warehouse"].includes(norm(h))) || "";
  const prod = headers.find(h => ["product","productid","item","itemid","sku","productname","prodid","itemno"].includes(norm(h))) || "";
  const qty = headers.find(h => ["quantity","qty","qtyordered","orderqty","units","ordered","qtyorder"].includes(norm(h))) || "";
  return { location: loc, product: prod, qty };
}

function detectPrefixSuffixPatterns(productIds, ignoredKeys = new Set()) {
  if (productIds.length < 2) return [];
  const total = productIds.length;
  const minCount = Math.max(2, Math.ceil(total * 0.03));
  const prefixCounts = new Map();
  const suffixCounts = new Map();
  productIds.forEach(id => {
    const up = String(id).trim().toUpperCase();
    if (!up) return;
    for (let len = 1; len <= 3; len++) {
      if (up.length > len + 1) {
        const pre = up.slice(0, len);
        if (/^[A-Z]+$/.test(pre)) prefixCounts.set(pre, (prefixCounts.get(pre) || 0) + 1);
        const suf = up.slice(-len);
        if (/^[A-Z]+$/.test(suf)) suffixCounts.set(suf, (suffixCounts.get(suf) || 0) + 1);
      }
    }
  });
  const results = [];
  const validPrefixes = [], validSuffixes = [];
  prefixCounts.forEach((count, pre) => {
    if (count >= minCount && count < total * 0.9 && !ignoredKeys.has(`prefix:${pre}`)) {
      validPrefixes.push(pre);
      const examples = productIds.filter(id => String(id).toUpperCase().startsWith(pre)).slice(0, 3);
      results.push({ type: "prefix", text: pre, count, examples, key: `prefix:${pre}` });
    }
  });
  suffixCounts.forEach((count, suf) => {
    if (count >= minCount && count < total * 0.9 && !ignoredKeys.has(`suffix:${suf}`)) {
      validSuffixes.push(suf);
      const examples = productIds.filter(id => String(id).toUpperCase().endsWith(suf)).slice(0, 3);
      results.push({ type: "suffix", text: suf, count, examples, key: `suffix:${suf}` });
    }
  });
  validPrefixes.forEach(pre => {
    validSuffixes.forEach(suf => {
      if (pre === suf) return;
      const key = `both:${pre}:${suf}`;
      if (ignoredKeys.has(key)) return;
      const matching = productIds.filter(id => {
        const up = String(id).toUpperCase();
        return up.startsWith(pre) && up.endsWith(suf) && up.length > pre.length + suf.length;
      });
      if (matching.length >= minCount) {
        results.push({ type: "both", prefix: pre, suffix: suf, text: `${pre}…${suf}`, count: matching.length, examples: matching.slice(0, 3), key });
      }
    });
  });
  return results.sort((a, b) => b.count - a.count);
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

// Compute suggested order qty based on order mode (days_supply vs min_max) and zero-usage fill setting
function computeSuggested(row, effectiveOnHand, targetDays, uomConv, orderMode, zeroUsageFill) {
  if (row._isTotal) return null;
  const ohFactor = uomConv.orderToOnHandFactor ?? 1;
  const minOH = row.min_on_hand !== "" ? parseFloat(row.min_on_hand) : NaN;
  const maxOH = row.max_on_hand !== "" ? parseFloat(row.max_on_hand) : NaN;
  const usageNum = parseFloat(row.daily_usage);
  const hasUsage = !isNaN(usageNum) && usageNum > 0;

  if (!hasUsage) {
    const fill = zeroUsageFill || "none";
    if (fill === "max" && !isNaN(maxOH) && effectiveOnHand !== null)
      return Math.max(0, Math.ceil((maxOH - effectiveOnHand) / ohFactor));
    if (fill === "min" && !isNaN(minOH) && effectiveOnHand !== null)
      return Math.max(0, Math.ceil((minOH - effectiveOnHand) / ohFactor));
    return 0;
  }

  if (orderMode === "min_max") {
    if (!isNaN(minOH) && effectiveOnHand !== null) {
      const leadNum = parseFloat(row.leadtime) || 0;
      const projectedAtDelivery = effectiveOnHand - usageNum * leadNum;
      if (effectiveOnHand <= minOH || projectedAtDelivery < minOH) {
        if (!isNaN(maxOH))
          return Math.max(0, Math.ceil((maxOH - effectiveOnHand) / ohFactor));
        return calcOrder(row, targetDays, uomConv.onHandToOrderFactor, effectiveOnHand);
      }
      return 0;
    }
    return calcOrder(row, targetDays, uomConv.onHandToOrderFactor, effectiveOnHand);
  }

  return calcOrder(row, targetDays, uomConv.onHandToOrderFactor, effectiveOnHand);
}

// Apply per-row min/max on-hand-after constraints; returns updated order + constraint flags
function applyOnHandConstraints(order, row, effectiveOnHand, uomConv, ignoreMax) {
  if (row._isTotal || effectiveOnHand === null) return { order, minC: false, maxC: false };
  const ohFactor = uomConv.orderToOnHandFactor ?? 1;
  const minOH = row.min_on_hand !== "" ? parseFloat(row.min_on_hand) : NaN;
  const maxOH = row.max_on_hand !== "" ? parseFloat(row.max_on_hand) : NaN;
  const pid = String(row.product ?? "").trim();
  const skipMax = ignoreMax && (
    (row.category && ignoreMax.categories?.includes(row.category)) ||
    ignoreMax.products?.includes(pid)
  );
  let minC = false, maxC = false;
  if (!isNaN(minOH)) {
    const mo = Math.ceil(Math.max(0, (minOH - effectiveOnHand) / ohFactor));
    if (mo > order) { order = mo; minC = true; }
  }
  if (!isNaN(maxOH) && !skipMax) {
    const mo = Math.floor(Math.max(0, (maxOH - effectiveOnHand) / ohFactor));
    if (mo < order) { order = mo; maxC = true; }
  }
  return { order, minC, maxC };
}

function getUomConversion(row, productRules, categoryUomSettings, uomMappings, prefixSuffixRules = []) {
  const productId = String(row.product ?? "").trim();
  const rule = (productRules || []).find(r => String(r.productId).trim() === productId);
  const onHandUom = (rule?.onHandUom || "").trim() || (row.uom && String(row.uom).trim()) || (row.category && categoryUomSettings?.[row.category]?.onHandUom) || "";
  const orderUom = (rule?.orderUom || "").trim() || (row.category && categoryUomSettings?.[row.category]?.orderUom) || "";

  // Named UoM conversion path (product rule / column / category)
  if (onHandUom && orderUom && onHandUom !== orderUom) {
    const m = (uomMappings || []).find(u => u.fromUnit === onHandUom && u.toUnit === orderUom);
    if (m && m.factor > 0) return { onHandUom, orderUom, onHandToOrderFactor: m.factor, orderToOnHandFactor: 1 / m.factor, hasConversion: true };
    const rev = (uomMappings || []).find(u => u.fromUnit === orderUom && u.toUnit === onHandUom);
    if (rev && rev.factor > 0) return { onHandUom, orderUom, onHandToOrderFactor: 1 / rev.factor, orderToOnHandFactor: rev.factor, hasConversion: true };
    return { onHandUom, orderUom, onHandToOrderFactor: 1, orderToOnHandFactor: 1, hasConversion: false, conversionMissing: true };
  }

  // Prefix/suffix pack-size path (fallback when no named UoM applies)
  if (!rule?.onHandUom && !rule?.orderUom) {
    const ps = (prefixSuffixRules || []).find(r => {
      const t = (r.text || "").trim();
      if (!t || !r.purchaseSize) return false;
      // Check exclusions
      const excl = r.exclusions || { products: [], categories: [] };
      if (excl.products?.includes(productId)) return false;
      if (row.category && excl.categories?.includes(row.category)) return false;
      return r.matchType === "prefix" ? productId.startsWith(t) : productId.endsWith(t);
    });
    if (ps) {
      const packSize = Number(ps.purchaseSize);
      if (ps.orderMode === "pack") {
        // Order in packs: 1 pack = packSize on-hand units
        return { onHandUom: "unit", orderUom: ps.text, onHandToOrderFactor: 1 / packSize, orderToOnHandFactor: packSize, hasConversion: true, isPack: true, packSize };
      } else {
        // Order in individual on-hand units but round to pack multiples
        return { onHandUom: "unit", orderUom: "unit", onHandToOrderFactor: 1, orderToOnHandFactor: 1, hasConversion: false, isPack: true, packSize };
      }
    }
  }

  return { onHandUom, orderUom, onHandToOrderFactor: 1, orderToOnHandFactor: 1, hasConversion: false };
}

function getUsageMultiplier(productId, category, adjustments) {
  if (!adjustments) return 1;
  if (adjustments.products?.[productId] != null) return 1 + (adjustments.products[productId] / 100);
  if (category && adjustments.categories?.[category] != null) return 1 + (adjustments.categories[category] / 100);
  if (adjustments.global != null) return 1 + (adjustments.global / 100);
  return 1;
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



// ── Data Source utilities ─────────────────────────────────────────────────────
async function fetchDataSource(conn) {
  const reqHeaders = {};
  if (conn.authType === "bearer" && conn.authValue)
    reqHeaders["Authorization"] = `Bearer ${conn.authValue}`;
  if (conn.authType === "apikey" && conn.authValue)
    reqHeaders[conn.authHeader || "X-API-Key"] = conn.authValue;

  const res = await fetch(buildFetchUrl(conn), { headers: reqHeaders, mode: "cors" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const fmt = conn.dataFormat || "auto";
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const isJson = fmt === "json" || (fmt === "auto" && ct.includes("json"));
  const isXlsx = fmt === "xlsx" || (fmt === "auto" && (ct.includes("spreadsheet") || ct.includes("excel") || /\.xlsx?$/i.test(conn.url)));

  if (isJson) {
    const json = await res.json();
    let arr = json;
    if (conn.jsonPath) {
      for (const key of conn.jsonPath.split(".")) {
        arr = arr?.[key];
        if (arr === undefined) throw new Error(`JSON path "${conn.jsonPath}" not found`);
      }
    }
    if (!Array.isArray(arr)) throw new Error("Resolved JSON value is not an array");
    if (arr.length === 0) return { headers: [], rows: [] };
    const hdrs = Object.keys(arr[0]);
    return { headers: hdrs, rows: arr.map(obj => hdrs.map(h => String(obj[h] ?? ""))) };
  }

  if (isXlsx) {
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (raw.length < 2) throw new Error("Spreadsheet appears empty");
    return { headers: raw[0].map(String), rows: raw.slice(1).filter(r => r.some(c => c !== "")) };
  }

  // CSV / plain text default
  const text = await res.text();
  const wb2 = XLSX.read(text, { type: "string" });
  const ws2 = wb2.Sheets[wb2.SheetNames[0]];
  const raw2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: "" });
  if (raw2.length < 2) throw new Error("CSV appears empty");
  return { headers: raw2[0].map(String), rows: raw2.slice(1).filter(r => r.some(c => c !== "")) };
}

function applyConnectionFilters(data, filters) {
  if (!filters || filters.length === 0) return data;
  const active = filters.filter(f => f.values && f.values.length > 0);
  if (active.length === 0) return data;
  const colIdxs = active.map(f => ({ idx: data.headers.indexOf(f.column), vals: new Set(f.values) }));
  return { ...data, rows: data.rows.filter(row => colIdxs.every(({ idx, vals }) => idx < 0 || vals.has(String(row[idx] ?? "")))) };
}

function buildFetchUrl(conn) {
  const params = (conn.queryParams || []).filter(p => p.key.trim());
  if (!params.length) return conn.url;
  const base = conn.url.includes("?") ? conn.url : conn.url;
  const sep = conn.url.includes("?") ? "&" : "?";
  return base + sep + params.map(p => `${encodeURIComponent(p.key.trim())}=${encodeURIComponent(p.value)}`).join("&");
}

function newConnection() {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: "", url: "", queryParams: [], authType: "none", authHeader: "X-API-Key", authValue: "", dataFormat: "auto", jsonPath: "", refreshPolicy: "manual", lastFetched: null, lastFetchOk: false, filters: [] };
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

// ── Snake game easter egg ─────────────────────────────────────────────────────
const SNAKE_SIZES = [
  { label: "Tiny  — 200×200",  cell: 10 },
  { label: "Small  — 240×240", cell: 12 },
  { label: "Medium — 320×320", cell: 16 },
  { label: "Large  — 400×400", cell: 20 },
  { label: "XL     — 480×480", cell: 24 },
];
function SnakeGame({ onClose }) {
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
    ctx.fillStyle = "#1e2335";
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
    const onEnd = (e) => {
      if (!touchStartRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStartRef.current.x, dy = t.clientY - touchStartRef.current.y;
      touchStartRef.current = null;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy)) steer({ x: dx > 0 ? 1 : -1, y: 0 });
      else steer({ x: 0, y: dy > 0 ? 1 : -1 });
      e.preventDefault();
    };
    canvas.addEventListener("touchstart", onStart, { passive: false });
    canvas.addEventListener("touchend", onEnd, { passive: false });
    return () => { canvas.removeEventListener("touchstart", onStart); canvas.removeEventListener("touchend", onEnd); };
  }, []);// eslint-disable-line

  // Control mode: "dpad" | "swipe" | "keyboard"
  const [ctrlMode, setCtrlMode] = useState("dpad");
  const swipeZoneRef = useRef(null);
  useEffect(() => {
    const zone = swipeZoneRef.current;
    if (!zone || ctrlMode !== "swipe") return;
    const onStart = (e) => { const t = e.touches[0]; touchStartRef.current = { x: t.clientX, y: t.clientY }; e.preventDefault(); };
    const onEnd = (e) => {
      if (!touchStartRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStartRef.current.x, dy = t.clientY - touchStartRef.current.y;
      touchStartRef.current = null;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy)) steer({ x: dx > 0 ? 1 : -1, y: 0 });
      else steer({ x: 0, y: dy > 0 ? 1 : -1 });
      e.preventDefault();
    };
    zone.addEventListener("touchstart", onStart, { passive: false });
    zone.addEventListener("touchend", onEnd, { passive: false });
    return () => { zone.removeEventListener("touchstart", onStart); zone.removeEventListener("touchend", onEnd); };
  }, [ctrlMode]);// eslint-disable-line

  const medals = ["🥇", "🥈", "🥉", "4.", "5.", "6.", "7."];
  const dBtn = (lbl, nd) => (
    <button
      onPointerDown={(e) => { e.preventDefault(); steer(nd); }}
      style={{ width: 48, height: 48, borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation", fontFamily: "inherit" }}>
      {lbl}
    </button>
  );
  const modeBtn = (label, active, onClick) => (
    <button onClick={onClick} style={{ flex: 1, padding: "4px 0", borderRadius: 5, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer", border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accent + "33" : "transparent", color: active ? C.accent : C.muted }}>
      {label}
    </button>
  );

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px", marginBottom: 24 }}>
      {/* Centered column */}
      <div style={{ width: "fit-content", margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: COLS * cellSize }}>
          <span style={{ color: C.accent, fontWeight: 800, fontSize: 13, fontFamily: "monospace" }}>🐍 SNAKE · {display.score}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>✕</button>
        </div>

        {/* Canvas */}
        <canvas ref={canvasRef} width={COLS * cellSize} height={ROWS * cellSize}
          style={{ display: "block", borderRadius: 6, border: `1px solid ${C.border}`, imageRendering: "pixelated", touchAction: "none" }} />

        {/* Start button */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", width: COLS * cellSize }}>
          <button onClick={startGame} style={{ background: C.accent, border: "none", borderRadius: 5, color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: 12, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
            {display.started ? "↺ Restart" : "▶ Start"}
          </button>
          {display.gameOver && <span style={{ color: C.red, fontSize: 11, fontWeight: 700 }}>Game over!</span>}
        </div>
        {/* Control mode toggle */}
        <div style={{ display: "flex", gap: 4, width: COLS * cellSize }}>
          {modeBtn("D-Pad",    ctrlMode === "dpad",     () => setCtrlMode("dpad"))}
          {modeBtn("Swipe",    ctrlMode === "swipe",    () => setCtrlMode("swipe"))}
          {modeBtn("Keyboard", ctrlMode === "keyboard", () => setCtrlMode("keyboard"))}
        </div>
        {/* Size selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: COLS * cellSize }}>
          <span style={{ color: C.muted, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>Grid size:</span>
          <select
            value={cellSize}
            onChange={e => { const v = Number(e.target.value); setCellSize(v); cellRef.current = v; }}
            style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontFamily: "inherit", fontSize: 11, padding: "3px 6px", outline: "none", cursor: "pointer" }}>
            {SNAKE_SIZES.map(s => <option key={s.cell} value={s.cell}>{s.label}</option>)}
          </select>
        </div>

        {/* Control area */}
        {ctrlMode === "dpad" && (
          <div style={{ display: "grid", gridTemplateColumns: "48px 48px 48px", gridTemplateRows: "48px 48px 48px", gap: 5 }}>
            <div />{dBtn("▲", { x: 0, y: -1 })}<div />
            {dBtn("◄", { x: -1, y: 0 })}<div />{dBtn("►", { x: 1, y: 0 })}
            <div />{dBtn("▼", { x: 0, y: 1 })}<div />
          </div>
        )}
        {ctrlMode === "swipe" && (
          <div ref={swipeZoneRef} style={{ width: COLS * cellSize, height: 154, background: C.card, border: `2px dashed ${C.border}`, borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", touchAction: "none", userSelect: "none", gap: 6, cursor: "default" }}>
            <span style={{ fontSize: 28, lineHeight: 1 }}>👆</span>
            <span style={{ color: C.muted, fontSize: 12 }}>Swipe here to steer</span>
            <span style={{ color: C.border, fontSize: 10 }}>↑ ↓ ← →</span>
          </div>
        )}

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <div style={{ width: COLS * cellSize, borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 2 }}>
            <div style={{ color: C.muted, fontWeight: 700, fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>🏆 LEADERBOARD</div>
            {/* Top 3 — centered row */}
            <div style={{ display: "flex", justifyContent: "center", gap: 14, marginBottom: leaderboard.length > 3 ? 8 : 0 }}>
              {leaderboard.slice(0, 3).map((entry, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 16 }}>{medals[i]}</span>
                  <span style={{ color: i === 0 ? C.accent : i === 1 ? C.text : C.muted, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{entry.score}</span>
                  <span style={{ color: C.muted, fontSize: 9 }}>{entry.date}</span>
                </div>
              ))}
            </div>
            {/* 4–7 in 2×2 grid */}
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
        )}
      </div>
    </div>
  );
}

// ── step bar ──────────────────────────────────────────────────────────────────
const STEPS_UPLOAD = ["Upload", "Map Columns", "Unit of Measure", "Review Order", "Export"];
const STEPS_MANUAL = ["Upload", "Build Order", "Review Order", "Export"];
// Map step number → display index for manual mode (steps 0,1,3,4 → 0,1,2,3)
const manualStepIndex = { 0: 0, 1: 1, 3: 2, 4: 3 };
const StepBar = ({ current, buildMode, onReviewTripleClick }) => {
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

// ── Data Source Panel ─────────────────────────────────────────────────────────
function DataSourcePanel({ onLoadData, onClose }) {
  const [connections, setConnections] = useState(() => loadConnections());
  const [view, setView] = useState("list"); // "list" | "edit"
  const [editConn, setEditConn] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchedData, setFetchedData] = useState(null);
  const [fetchError, setFetchError] = useState("");
  const [filters, setFilters] = useState([]);
  const [newFilterCol, setNewFilterCol] = useState("");

  const saveConns = (c) => { setConnections(c); saveConnections(c); };

  const openNew = () => {
    const c = newConnection();
    setEditConn(c);
    setFetchedData(null);
    setFetchError("");
    setFilters([]);
    setNewFilterCol("");
    setView("edit");
  };

  const openEdit = (conn) => {
    setEditConn({ ...conn });
    setFetchedData(null);
    setFetchError("");
    setFilters(conn.filters || []);
    setNewFilterCol("");
    setView("edit");
  };

  const setField = (k, v) => setEditConn(c => ({ ...c, [k]: v }));

  const handleFetch = async () => {
    if (!editConn.url) return;
    setFetching(true); setFetchError(""); setFetchedData(null);
    try {
      const data = await fetchDataSource(editConn);
      setFetchedData(data);
    } catch (e) {
      setFetchError(e.message || "Fetch failed");
    } finally {
      setFetching(false);
    }
  };

  const handleSave = () => {
    const conn = { ...editConn, filters, lastFetched: fetchedData ? Date.now() : editConn.lastFetched, lastFetchOk: fetchedData ? true : editConn.lastFetchOk };
    const existing = connections.find(c => c.id === conn.id);
    const next = existing ? connections.map(c => c.id === conn.id ? conn : c) : [...connections, conn];
    saveConns(next);
    setView("list");
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete connection "${editConn.name || "Untitled"}"?`)) return;
    saveConns(connections.filter(c => c.id !== editConn.id));
    setView("list");
  };

  const handleLoad = (conn, data) => {
    const toLoad = data || fetchedData;
    if (!toLoad) return;
    const filtered = applyConnectionFilters(toLoad, filters);
    onLoadData({ headers: filtered.headers, rows: filtered.rows, fileName: conn.name || conn.url }, conn.name || "Data Source");
  };

  const handleQuickLoad = async (conn) => {
    setFetching(true);
    try {
      const data = await fetchDataSource(conn);
      const filtered = applyConnectionFilters(data, conn.filters || []);
      // Update lastFetched
      const next = connections.map(c => c.id === conn.id ? { ...c, lastFetched: Date.now(), lastFetchOk: true } : c);
      saveConns(next);
      onLoadData({ headers: filtered.headers, rows: filtered.rows, fileName: conn.name || conn.url }, conn.name);
    } catch (e) {
      alert(`Failed to load "${conn.name}": ${e.message}`);
    } finally {
      setFetching(false);
    }
  };

  // Filter helpers
  const addFilter = () => {
    if (!newFilterCol || filters.find(f => f.column === newFilterCol)) return;
    setFilters(f => [...f, { column: newFilterCol, values: [] }]);
    setNewFilterCol("");
  };
  const removeFilter = (col) => setFilters(f => f.filter(x => x.column !== col));
  const toggleFilterValue = (col, val) => setFilters(f => f.map(x => x.column !== col ? x : {
    ...x, values: x.values.includes(val) ? x.values.filter(v => v !== val) : [...x.values, val]
  }));
  const selectAllFilter = (col) => {
    if (!fetchedData) return;
    const idx = fetchedData.headers.indexOf(col);
    if (idx < 0) return;
    setFilters(f => f.map(x => x.column !== col ? x : { ...x, values: [] })); // empty = "all"
  };

  const filteredCount = fetchedData ? applyConnectionFilters(fetchedData, filters).rows.length : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: Math.min(620, window.innerWidth), height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Panel header */}
        <div style={{ padding: "18px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          {view === "edit" && (
            <button onClick={() => setView("list")} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>←</button>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>
              {view === "list" ? "Data Sources" : (editConn?.id && connections.find(c => c.id === editConn.id) ? "Edit Connection" : "New Connection")}
            </div>
            <div style={{ color: C.muted, fontSize: 11 }}>Connect to APIs, spreadsheet URLs, or JSON endpoints</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>

          {/* LIST VIEW */}
          {view === "list" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Btn small variant="ghost" onClick={openNew} style={{ alignSelf: "flex-start" }}>+ New Connection</Btn>
              {connections.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: C.muted, fontSize: 13 }}>
                  No connections yet. Add one to pull data from a URL or API.
                </div>
              )}
              {connections.map(conn => (
                <div key={conn.id} style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${conn.lastFetchOk ? C.green + "44" : C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, color: C.text, fontSize: 14, flex: 1 }}>{conn.name || "Untitled Connection"}</span>
                    {conn.lastFetchOk && <Badge color={C.green}>✓ connected</Badge>}
                    {conn.refreshPolicy === "on_open" && <Badge color={C.purple}>auto</Badge>}
                  </div>
                  <div style={{ color: C.muted, fontSize: 11, marginBottom: 10, wordBreak: "break-all" }}>{conn.url || "No URL set"}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {conn.lastFetched && <span style={{ color: C.muted, fontSize: 11 }}>Last fetched: {new Date(conn.lastFetched).toLocaleString()}</span>}
                    <div style={{ flex: 1 }} />
                    <Btn small variant="ghost" onClick={() => openEdit(conn)}>Edit</Btn>
                    <Btn small variant="success" disabled={!conn.url || fetching} onClick={() => handleQuickLoad(conn)}>
                      {fetching ? "Loading…" : "Load →"}
                    </Btn>
                  </div>
                </div>
              ))}

              {/* Info box */}
              <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}`, marginTop: 8 }}>
                <p style={{ color: C.muted, fontSize: 11, margin: "0 0 6px", fontWeight: 700 }}>SUPPORTED SOURCES</p>
                <ul style={{ color: C.muted, fontSize: 11, margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                  <li><strong style={{ color: C.text }}>Spreadsheet URL</strong> — Google Sheets (published CSV), SharePoint, Dropbox, OneDrive direct links</li>
                  <li><strong style={{ color: C.text }}>REST API</strong> — any JSON endpoint returning an array or nested array, with optional Bearer / API key auth</li>
                  <li><strong style={{ color: C.text }}>Power Query</strong> — publish your query to SharePoint or export to a URL-accessible file</li>
                </ul>
                <p style={{ color: C.muted, fontSize: 10, margin: "8px 0 0" }}>Note: the server must allow browser requests (CORS). SQL and direct database connections require a local desktop app (planned).</p>
              </div>
            </div>
          )}

          {/* EDIT VIEW */}
          {view === "edit" && editConn && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* Name */}
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>CONNECTION NAME</label>
                <Input value={editConn.name} onChange={e => setField("name", e.target.value)} placeholder="e.g. ERP Inventory Export" style={{ width: "100%" }} />
              </div>

              {/* URL */}
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>BASE URL</label>
                <Input value={editConn.url} onChange={e => setField("url", e.target.value)} placeholder="https://..." style={{ width: "100%" }} />
                <p style={{ color: C.muted, fontSize: 11, margin: "5px 0 0" }}>Paste the endpoint URL without query parameters. Add parameters below.</p>
              </div>

              {/* Query Parameters */}
              <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 10 }}>QUERY PARAMETERS</label>
                {(editConn.queryParams || []).map((p, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <Input value={p.key} onChange={e => setField("queryParams", editConn.queryParams.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                      placeholder="parameter name" style={{ width: "100%" }} />
                    <Input value={p.value} onChange={e => setField("queryParams", editConn.queryParams.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                      placeholder="value" style={{ width: "100%" }} />
                    <button onClick={() => setField("queryParams", editConn.queryParams.filter((_, j) => j !== i))}
                      style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "6px 10px" }}>×</button>
                  </div>
                ))}
                <Btn small variant="ghost" onClick={() => setField("queryParams", [...(editConn.queryParams || []), { key: "", value: "" }])}>+ Add Parameter</Btn>
                {editConn.url && (editConn.queryParams || []).some(p => p.key.trim()) && (
                  <div style={{ marginTop: 10, padding: "8px 10px", background: C.surface, borderRadius: 6, border: `1px solid ${C.border}` }}>
                    <p style={{ color: C.muted, fontSize: 10, fontWeight: 700, margin: "0 0 3px" }}>FULL REQUEST URL</p>
                    <p style={{ color: C.accent, fontSize: 11, margin: 0, wordBreak: "break-all", fontFamily: "monospace" }}>{buildFetchUrl(editConn)}</p>
                  </div>
                )}
              </div>

              {/* Auth */}
              <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 8 }}>AUTHENTICATION</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {[["none", "None"], ["bearer", "Bearer Token"], ["apikey", "API Key"]].map(([val, lbl]) => (
                    <button key={val} onClick={() => setField("authType", val)} style={{
                      padding: "5px 12px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                      border: `1px solid ${editConn.authType === val ? C.accent : C.border}`,
                      background: editConn.authType === val ? C.accentDim : "transparent",
                      color: editConn.authType === val ? C.accent : C.muted,
                    }}>{lbl}</button>
                  ))}
                </div>
                {editConn.authType === "bearer" && (
                  <Input value={editConn.authValue} onChange={e => setField("authValue", e.target.value)} placeholder="your-token-here" style={{ width: "100%" }} />
                )}
                {editConn.authType === "apikey" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                    <div>
                      <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>HEADER NAME</label>
                      <Input value={editConn.authHeader} onChange={e => setField("authHeader", e.target.value)} placeholder="X-API-Key" style={{ width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>KEY VALUE</label>
                      <Input value={editConn.authValue} onChange={e => setField("authValue", e.target.value)} placeholder="your-api-key" style={{ width: "100%" }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Format + JSON path */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>DATA FORMAT</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {[["auto", "Auto"], ["csv", "CSV"], ["json", "JSON"], ["xlsx", "XLSX"]].map(([val, lbl]) => (
                      <button key={val} onClick={() => setField("dataFormat", val)} style={{
                        padding: "5px 10px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                        border: `1px solid ${editConn.dataFormat === val ? C.accent : C.border}`,
                        background: editConn.dataFormat === val ? C.accentDim : "transparent",
                        color: editConn.dataFormat === val ? C.accent : C.muted,
                      }}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>JSON ARRAY PATH <span style={{ color: C.muted, fontWeight: 400 }}>(optional)</span></label>
                  <Input value={editConn.jsonPath} onChange={e => setField("jsonPath", e.target.value)}
                    placeholder="e.g. data.rows" style={{ width: "100%" }}
                    disabled={editConn.dataFormat !== "json" && editConn.dataFormat !== "auto"} />
                  <p style={{ color: C.muted, fontSize: 10, margin: "4px 0 0" }}>Dot path to the array inside the JSON response</p>
                </div>
              </div>

              {/* Refresh policy */}
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>REFRESH POLICY</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {[["manual", "Manual only"], ["on_open", "Auto on app open"]].map(([val, lbl]) => (
                    <button key={val} onClick={() => setField("refreshPolicy", val)} style={{
                      padding: "5px 12px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                      border: `1px solid ${editConn.refreshPolicy === val ? C.purple : C.border}`,
                      background: editConn.refreshPolicy === val ? C.purpleDim : "transparent",
                      color: editConn.refreshPolicy === val ? C.purple : C.muted,
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>

              {/* Fetch button */}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Btn onClick={handleFetch} disabled={!editConn.url || fetching} variant={fetchedData ? "success" : "primary"}>
                  {fetching ? "Fetching…" : fetchedData ? "✓ Re-fetch" : "Test & Fetch"}
                </Btn>
                {fetchError && <span style={{ color: C.red, fontSize: 12 }}>⚠ {fetchError}</span>}
                {fetchedData && <span style={{ color: C.green, fontSize: 12 }}>✓ {fetchedData.rows.length} rows, {fetchedData.headers.length} columns</span>}
              </div>

              {/* Preview + filters (shown after successful fetch) */}
              {fetchedData && (
                <>
                  <div>
                    <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 8px" }}>DATA PREVIEW</p>
                    <DataPreview headers={fetchedData.headers} rows={fetchedData.rows} maxRows={8} />
                  </div>

                  {/* Row Filters */}
                  <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                    <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 10px" }}>ROW FILTERS <span style={{ color: C.muted, fontWeight: 400 }}>(optional — limit which rows load into the app)</span></p>

                    {filters.map(f => {
                      const idx = fetchedData.headers.indexOf(f.column);
                      const allVals = idx >= 0 ? [...new Set(fetchedData.rows.map(r => String(r[idx] ?? "")))].sort() : [];
                      const noneSelected = f.values.length === 0;
                      return (
                        <div key={f.column} style={{ background: C.surface, borderRadius: 8, padding: "10px 12px", marginBottom: 8, border: `1px solid ${C.border}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span style={{ color: C.text, fontWeight: 700, fontSize: 12, flex: 1 }}>{f.column}</span>
                            <span style={{ color: C.muted, fontSize: 11 }}>{noneSelected ? "all values" : `${f.values.length} selected`}</span>
                            <button onClick={() => removeFilter(f.column)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 120, overflowY: "auto" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", color: C.muted, padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.border}`, background: noneSelected ? C.accentDim : "transparent" }}>
                              <input type="checkbox" checked={noneSelected} onChange={() => selectAllFilter(f.column)}
                                style={{ accentColor: C.accent, width: 11, height: 11 }} />
                              (All)
                            </label>
                            {allVals.map(v => (
                              <label key={v} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", color: f.values.includes(v) ? C.text : C.muted, padding: "2px 6px", borderRadius: 4, border: `1px solid ${f.values.includes(v) ? C.accentDim : C.border}`, background: f.values.includes(v) ? C.accentDim : "transparent" }}>
                                <input type="checkbox" checked={f.values.includes(v)} onChange={() => toggleFilterValue(f.column, v)}
                                  style={{ accentColor: C.accent, width: 11, height: 11 }} />
                                {v === "" ? <em>(blank)</em> : v}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Add filter */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Select value={newFilterCol} onChange={e => setNewFilterCol(e.target.value)} style={{ flex: 1 }}>
                        <option value="">+ Filter by column…</option>
                        {fetchedData.headers.filter(h => !filters.find(f => f.column === h)).map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </Select>
                      <Btn small variant="ghost" onClick={addFilter} disabled={!newFilterCol}>Add</Btn>
                    </div>
                  </div>

                  {/* Load to App */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 4 }}>
                    <Btn onClick={() => handleLoad(editConn, fetchedData)} variant="primary">
                      Load {filteredCount} rows → App
                    </Btn>
                    <span style={{ color: C.muted, fontSize: 12 }}>
                      {filters.filter(f => f.values.length > 0).length > 0 && `${fetchedData.rows.length - filteredCount} rows filtered out`}
                    </span>
                  </div>
                </>
              )}

              {/* Save / Delete */}
              <div style={{ display: "flex", gap: 10, paddingTop: 4, borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
                <Btn onClick={handleSave} disabled={!editConn.url}>Save Connection</Btn>
                {connections.find(c => c.id === editConn.id) && (
                  <Btn variant="danger" onClick={handleDelete}>Delete</Btn>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Template download ─────────────────────────────────────────────────────────
function downloadTemplates() {
  const wb = XLSX.utils.book_new();

  const addSheet = (name, cols, examples, notes) => {
    const headerRow   = cols.map(c => c.label);
    const requiredRow = cols.map(c => c.required ? "★ Required" : "  Optional");
    const descRow     = cols.map(c => c.desc || "");
    const blankRow    = cols.map(() => "");
    const data = [headerRow, requiredRow, descRow, blankRow, ...examples];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = cols.map(c => ({ wch: Math.max((c.label || "").length + 2, 22) }));
    // Freeze top 3 rows so examples scroll under the header
    ws["!freeze"] = { xSplit: 0, ySplit: 3 };
    if (notes) {
      ws["!sheetNotes"] = notes; // stored for reference, not rendered by SheetJS base
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  // ── 1. Inventory / Main File ──────────────────────────────────────────────
  addSheet("1 — Inventory File", [
    { label: "Location",         required: true,  desc: "Store, warehouse, or site name/number" },
    { label: "Product",          required: true,  desc: "Your internal item ID or SKU" },
    { label: "On Hand",          required: true,  desc: "Current stock count (in on-hand units)" },
    { label: "Lead Time (days)", required: true,  desc: "Days from order to receipt" },
    { label: "Daily Usage",      required: false, desc: "Avg units consumed per day (or map Sales column instead)" },
    { label: "Category",         required: false, desc: "Item category — enables filtering & UoM grouping" },
    { label: "Cost (per unit)",  required: false, desc: "Unit cost — enables extended cost column in export" },
    { label: "UOM",              required: false, desc: "On-hand unit of measure label (e.g. ea, cs, gal)" },
    { label: "Min On Hand",      required: false, desc: "Minimum stock floor — order will never let stock drop below this" },
    { label: "Max On Hand",      required: false, desc: "Maximum stock ceiling — order will be capped to stay below this" },
  ], [
    ["Store 1",  "ITEM-001", 50, 7,  5.2, "Chemicals", 12.50, "ea",  0,   200],
    ["Store 1",  "ITEM-002", 12, 14, 1.8, "Parts",     45.00, "cs",  5,   50],
    ["Store 2",  "ITEM-001", 30, 7,  5.2, "Chemicals", 12.50, "ea",  0,   200],
    ["Store 2",  "ITEM-003",  0, 10, 3.0, "Parts",     18.75, "ea", 10,  100],
  ]);

  // ── 2. Pending Orders ─────────────────────────────────────────────────────
  addSheet("2 — Pending Orders", [
    { label: "Product",  required: true,  desc: "Must match Product values in your inventory file" },
    { label: "Location", required: false, desc: "Leave blank if the pending order isn't location-specific" },
    { label: "Qty",      required: true,  desc: "Quantity already on order (will be subtracted from suggested order)" },
  ], [
    ["ITEM-001", "Store 1", 24],
    ["ITEM-002", "Store 1", 12],
    ["ITEM-001", "Store 2",  6],
    ["ITEM-003", "",        20],
  ]);

  // ── 3. Account Info ───────────────────────────────────────────────────────
  addSheet("3 — Account Info", [
    { label: "Location",    required: true,  desc: "Must match Location values in your inventory file. Leading zeros OK (023 matches 23)" },
    { label: "Account #",   required: false, desc: "Example custom column — add any columns you want to pull into the export" },
    { label: "Ship-To Name",required: false, desc: "Example: store or customer name" },
    { label: "Address",     required: false, desc: "Example: street address" },
    { label: "City",        required: false, desc: "Example: city" },
    { label: "State",       required: false, desc: "Example: state/province" },
    { label: "Phone",       required: false, desc: "Example: contact phone number" },
  ], [
    ["Store 1",  "ACC-001", "Main Street Store",  "123 Main St",   "Anytown",    "TX", "555-1234"],
    ["023",      "ACC-023", "Oak Ave Location",   "456 Oak Ave",   "Othertown",  "TX", "555-5678"],
    ["Store 2",  "ACC-002", "Warehouse North",    "789 Depot Rd",  "Somewhere",  "TX", "555-9999"],
  ]);

  // ── 4. Vendor / Part # Mapping ────────────────────────────────────────────
  addSheet("4 — Vendor Part # Mapping", [
    { label: "Internal Part #", required: true,  desc: "Your item ID — must match Product values in your inventory file" },
    { label: "Vendor Part #",   required: true,  desc: "The vendor's item number to use on the export/order sheet" },
    { label: "Description",     required: false, desc: "Optional — any extra columns can be mapped into the export" },
    { label: "Pack Size",       required: false, desc: "Optional — units per case/pack (informational)" },
    { label: "UOM",             required: false, desc: "Optional — vendor unit of measure" },
  ], [
    ["ITEM-001", "VND-7892-A", "Widget Assembly",   12, "cs"],
    ["ITEM-002", "VND-4431",   "Gear Bracket",       1, "ea"],
    ["ITEM-003", "VND-0081-B", "Mounting Plate Kit",  6, "cs"],
  ]);

  XLSX.writeFile(wb, "OrderGen_File_Templates.xlsx");
}

// ── STEP 1: Upload ────────────────────────────────────────────────────────────
function UploadStep({ onData, onManualBuild }) {
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

      {/* Manual build option */}
      {!preview && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "4px 0" }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <span style={{ color: C.muted, fontSize: 12 }}>or</span>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>
      )}
      {!preview && (
        <div style={{ textAlign: "center" }}>
          <button onClick={onManualBuild}
            style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 36px", cursor: "pointer", fontFamily: "inherit", width: "100%", maxWidth: 520, display: "block", margin: "0 auto", transition: "all .2s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = C.accent + "08"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "transparent"; }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✏️</div>
            <div style={{ color: C.text, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Build Order Manually</div>
            <div style={{ color: C.muted, fontSize: 12 }}>Type in products and locations — no file needed</div>
          </button>
        </div>
      )}
      {/* Template download */}
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <button onClick={downloadTemplates}
          style={{ background: "none", border: "none", color: C.muted, fontFamily: "inherit", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, transition: "color .2s" }}
          onMouseEnter={e => e.currentTarget.style.color = C.accent}
          onMouseLeave={e => e.currentTarget.style.color = C.muted}>
          <span>📄</span>
          <span>Download file templates</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>— shows required &amp; optional columns for each upload type</span>
        </button>
      </div>
    </div>
  );
}

// ── STEP 2: Map Columns ───────────────────────────────────────────────────────
function MapStep({ headers, rows, fileName, onConfirm, initialState, suggestion }) {
  // initialState  = full saved state when user pressed Back (session memory)
  // suggestion    = best matching saved mapping from localStorage (cross-session)
  const init = initialState || suggestion?.mapState || {};
  const [mapping, setMapping] = useState(init.mapping || {});
  const [fieldMode, setFieldMode] = useState(init.fieldMode || { location: "column", product: "column", leadtime: "column", min_on_hand: "column", max_on_hand: "column" });
  const [manualValues, setManualValues] = useState(init.manualValues || { location: "", product: "", leadtime: "", min_on_hand: "", max_on_hand: "" });
  const [targetDays, setTargetDays] = useState(init.targetDays ?? 14);
  const [usageMode, setUsageMode] = useState(init.usageMode || "direct");
  const [salesCol, setSalesCol] = useState(init.salesCol || "");
  const [salesDays, setSalesDays] = useState(init.salesDays ?? 30);
  const [showPreview, setShowPreview] = useState(true);
  // optional fields
  const [orderMin, setOrderMin] = useState(init.orderMin ?? "");
  const [orderMax, setOrderMax] = useState(init.orderMax ?? "");
  const [orderLimitType, setOrderLimitType] = useState(init.orderLimitType || "dollars");
  const [showOrderLimits, setShowOrderLimits] = useState(false);
  const [orderMode, setOrderMode] = useState(init.orderMode || "days_supply");
  const [zeroUsageFill, setZeroUsageFill] = useState(init.zeroUsageFill || "none");
  const [showOrderBehavior, setShowOrderBehavior] = useState(false);
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
    mapping.category, mapping.cost, mapping.uom, mapping.min_on_hand, mapping.max_on_hand,
  ].filter(Boolean);

  const currentMapState = () => ({
    mapping, fieldMode, manualValues, targetDays,
    usageMode, salesCol, salesDays,
    orderMin, orderMax, orderLimitType, orderMode, zeroUsageFill,
  });

  const handleConfirm = () => {
    const ms = currentMapState();
    saveMappingToStorage(headers, ms);
    onConfirm(
      mapping, targetDays,
      { mode: usageMode, salesCol, salesDays },
      { fieldMode, manualValues },
      { orderMin: orderMin !== "" ? Number(orderMin) : null, orderMax: orderMax !== "" ? Number(orderMax) : null, limitType: orderLimitType, orderMode, zeroUsageFill },
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

  const OptionalFieldCard = ({ field, label, description, withManual }) => {
    const mode = withManual ? (fieldMode[field] || "column") : "column";
    const isManual = mode === "manual";
    const satisfied = isManual ? !!manualValues[field] : !!mapping[field];
    return (
      <div style={{ background: C.card, borderRadius: 12, padding: "14px 18px", border: `1px solid ${satisfied ? C.accentDim : C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{label}</span>
            <span style={{ color: C.muted, fontSize: 11, marginLeft: 6 }}>optional</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {withManual && <ModeToggle field={field} />}
            {satisfied && <Badge color={C.green}>✓</Badge>}
          </div>
        </div>
        {isManual ? (
          <Input type="number" value={manualValues[field] || ""}
            onChange={e => setManualValues(m => ({ ...m, [field]: e.target.value }))}
            placeholder={field === "min_on_hand" ? "e.g. 5" : "e.g. 50"}
            style={{ width: "100%" }} />
        ) : (
          <Select value={mapping[field] || ""} onChange={(e) => set(field, e.target.value)} style={{ width: "100%" }}>
            <option value="">— Not mapped —</option>
            {headers.map((h, i) => <option key={i} value={h}>{h || `Column ${i + 1}`}</option>)}
          </Select>
        )}
        {description && <p style={{ color: C.muted, fontSize: 11, margin: "6px 0 0", lineHeight: 1.4 }}>{description}</p>}
      </div>
    );
  };

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

      {/* optional fields: category, cost, uom */}
      <div>
        <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>OPTIONAL FIELDS</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <OptionalFieldCard field="category" label="Category" description="Used for filtering and grouping your order by category." />
          <OptionalFieldCard field="cost" label="Cost (per unit)" description="Used to calculate total order value and cost-based order limits." />
          <OptionalFieldCard field="uom" label="Unit of Measure" description="Maps on-hand units to order units (e.g. quarts on hand, order in gallons) for accurate order quantities." />
          <OptionalFieldCard field="min_on_hand" label="Min On Hand" withManual description="Floor for on-hand quantity after delivery. The order will be raised to ensure this minimum is met." />
          <OptionalFieldCard field="max_on_hand" label="Max On Hand" withManual description="Ceiling for on-hand quantity after delivery. The order will be capped so this maximum is not exceeded." />
        </div>
      </div>

      {/* order min/max */}
      <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <button onClick={() => setShowOrderLimits(v => !v)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.text, fontWeight: 700 }}>{showOrderLimits ? "▼" : "▶"} Order Limits</span>
            <span style={{ color: C.muted, fontSize: 12 }}>optional — flags orders outside range in review</span>
          </div>
          {(orderMin !== "" || orderMax !== "") && <Badge color={C.accent}>set</Badge>}
        </button>
        {showOrderLimits && (
          <div style={{ padding: "0 20px 18px" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 14 }}>
              {[["dollars", "Total $ Value"], ["units", "Total Units"]].map(([val, label]) => (
                <button key={val} onClick={() => setOrderLimitType(val)} style={{
                  padding: "4px 12px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer",
                  border: `1px solid ${orderLimitType === val ? C.accent : C.border}`,
                  background: orderLimitType === val ? C.accentDim : "transparent",
                  color: orderLimitType === val ? C.accent : C.muted,
                }}>{label}</button>
              ))}
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
        )}
      </div>

      {/* order behavior */}
      <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${(orderMode !== "days_supply" || zeroUsageFill !== "none") ? C.accentDim : C.border}`, overflow: "hidden" }}>
        <button onClick={() => setShowOrderBehavior(v => !v)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.text, fontWeight: 700 }}>{showOrderBehavior ? "▼" : "▶"} Order Behavior</span>
            <span style={{ color: C.muted, fontSize: 12 }}>optional — how orders are calculated</span>
          </div>
          {(orderMode !== "days_supply" || zeroUsageFill !== "none") && <Badge color={C.accent}>custom</Badge>}
        </button>
        {showOrderBehavior && (
          <div style={{ padding: "0 20px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 8 }}>ORDER CALCULATION MODE</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {[["days_supply", "Days of Supply"], ["min_max", "Min / Max"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setOrderMode(val)} style={{
                    padding: "6px 14px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${orderMode === val ? C.accent : C.border}`,
                    background: orderMode === val ? C.accentDim : "transparent",
                    color: orderMode === val ? C.accent : C.muted,
                  }}>{lbl}</button>
                ))}
              </div>
              <p style={{ color: C.muted, fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                {orderMode === "days_supply"
                  ? "Standard formula: order enough to cover lead time + target days of supply. Min On Hand acts as a floor; Max On Hand caps the order."
                  : "Reorder-point logic: trigger an order when on-hand is at or below Min On Hand, or usage will deplete below Min before delivery. Order fills to Max On Hand (or days-of-supply target if no Max is set)."}
              </p>
            </div>
            <div>
              <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 8 }}>WHEN USAGE IS ZERO OR UNKNOWN</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {[["none", "No Order"], ["min", "Fill to Min"], ["max", "Fill to Max"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setZeroUsageFill(val)} style={{
                    padding: "6px 14px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${zeroUsageFill === val ? C.purple : C.border}`,
                    background: zeroUsageFill === val ? C.purpleDim : "transparent",
                    color: zeroUsageFill === val ? C.purple : C.muted,
                  }}>{lbl}</button>
                ))}
              </div>
              <p style={{ color: C.muted, fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                {zeroUsageFill === "none" ? "Products with no usage data will receive no order quantity." : zeroUsageFill === "min" ? "Fill to Min On Hand — order just enough to reach the minimum threshold." : "Fill to Max On Hand — order up to the maximum stocking level."}
              </p>
              {zeroUsageFill !== "none" && !mapping.min_on_hand && fieldMode.min_on_hand !== "manual" && !mapping.max_on_hand && fieldMode.max_on_hand !== "manual" && (
                <div style={{ background: C.orange + "18", border: `1px solid ${C.orange}44`, borderRadius: 8, padding: "8px 12px", color: C.orange, fontSize: 12, marginTop: 8 }}>
                  ⚠ Set a Min On Hand or Max On Hand above for the fill target.
                </div>
              )}
            </div>
          </div>
        )}
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

// ── STEP 2 (between Map and Review): Unit of Measure ─────────────────────────
function UomStep({ rawRows, headers, mapping, usageConfig, manualEntry, hasCategory, hasUom, productRules, initialUomMappings, initialCategoryUomSettings, initialPrefixSuffixRules, onBack, onConfirm }) {
  const [uomMappings, setUomMappings] = useState(initialUomMappings || []);
  const [categoryUomSettings, setCategoryUomSettings] = useState(initialCategoryUomSettings || {});
  const [prefixSuffixRules, setPrefixSuffixRules] = useState(initialPrefixSuffixRules || []);
  const [psIgnored, setPsIgnored] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("ordergen_ps_ignored_v1") || "[]")); } catch { return new Set(); }
  });
  const [psDetected, setPsDetected] = useState(null);
  const [newPsMatchType, setNewPsMatchType] = useState("suffix");
  const [newPsText, setNewPsText] = useState("");
  const [newPsPackSize, setNewPsPackSize] = useState("");
  const [newPsOrderMode, setNewPsOrderMode] = useState("pack");
  const [newUomFrom, setNewUomFrom] = useState("");
  const [newUomTo, setNewUomTo] = useState("");
  const [newUomFactor, setNewUomFactor] = useState("");
  const [newCatKey, setNewCatKey] = useState("");
  const [newCatOnHandUom, setNewCatOnHandUom] = useState("");
  const [newCatOrderUom, setNewCatOrderUom] = useState("");
  const [psExclPopup, setPsExclPopup] = useState(null);
  const [newExclProd, setNewExclProd] = useState("");
  const [newExclCat, setNewExclCat] = useState("");

  const savePsRulesLocal = (r) => { setPrefixSuffixRules(r); savePrefixSuffixRules(r); };

  const previewRows = rawRows.map(r => {
    const get = (field) => {
      if (manualEntry?.fieldMode?.[field] === "manual") return trimVal(manualEntry.manualValues?.[field] ?? "");
      const idx = headers.indexOf(mapping[field]);
      return idx >= 0 ? trimVal(r[idx]) : "";
    };
    return { product: get("product"), category: hasCategory ? get("category") : "", uom: hasUom ? get("uom") : "" };
  });

  const uomPairs = (() => {
    const m = new Map();
    previewRows.forEach(r => {
      const conv = getUomConversion(r, productRules, categoryUomSettings, uomMappings, prefixSuffixRules);
      if (conv.onHandUom || conv.orderUom) {
        const k = `${conv.onHandUom || ""}|${conv.orderUom || ""}`;
        if (!m.has(k)) m.set(k, { onHand: conv.onHandUom || "—", order: conv.orderUom || "—", hasConversion: conv.hasConversion, missing: conv.conversionMissing });
      }
    });
    return [...m.values()];
  })();

  const availableCategories = hasCategory ? [...new Set(previewRows.map(r => r.category).filter(Boolean))].sort() : [];
  const allProductIds = previewRows.map(r => String(r.product || "").trim()).filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ color: C.text, fontSize: 22, fontWeight: 800, margin: 0 }}>Unit of Measure</h2>
        <p style={{ color: C.muted, marginTop: 6 }}>Configure how on-hand units convert to order units</p>
      </div>

      {uomPairs.length > 0 && (
        <div style={{ background: C.surface, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
          <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 10px" }}>UoM STATUS — UPLOADED DATA</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {uomPairs.map((p, i) => {
              const isSame = p.onHand === p.order || (!p.order || p.order === "—");
              const icon = p.hasConversion ? "✓" : p.missing ? "⚠" : "→";
              const color = p.hasConversion ? C.green : p.missing ? C.orange : C.muted;
              const desc = p.hasConversion ? `${p.onHand} → ${p.order} (mapped)` : p.missing ? `${p.onHand} → ${p.order} — no mapping found, will use 1:1` : isSame ? `${p.onHand} (same unit, 1:1)` : `${p.onHand} (no order UoM set, 1:1)`;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: C.card, borderRadius: 6, border: `1px solid ${color}33` }}>
                  <span style={{ color, fontWeight: 700, fontSize: 14, width: 16, textAlign: "center" }}>{icon}</span>
                  <span style={{ color: C.text, fontSize: 12 }}>{desc}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unit conversion definitions */}
      <div style={{ background: C.surface, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
        <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 10px" }}>UNIT CONVERSIONS</p>
        <div style={{ background: C.purple + "11", border: `1px solid ${C.purple}33`, borderRadius: 8, padding: "8px 12px", color: C.purple, fontSize: 12, marginBottom: 12 }}>
          Define how on-hand units convert to order units. Example: 1 qt = 0.25 gal (ordering in gallons when stock is tracked in quarts).
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto auto", gap: 8, alignItems: "end", marginBottom: 10 }}>
          <div>
            <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>FROM (ON HAND)</label>
            <Input value={newUomFrom} onChange={e => setNewUomFrom(e.target.value)} placeholder="e.g. qt" style={{ width: "100%" }} />
          </div>
          <span style={{ color: C.muted, fontSize: 13, paddingBottom: 8 }}>→</span>
          <div>
            <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>TO (ORDER)</label>
            <Input value={newUomTo} onChange={e => setNewUomTo(e.target.value)} placeholder="e.g. gal" style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>FACTOR (1 FROM = ? TO)</label>
            <Input type="number" value={newUomFactor} onChange={e => setNewUomFactor(e.target.value)} placeholder="e.g. 0.25" style={{ width: 110 }} />
          </div>
          <Btn small onClick={() => {
            if (!newUomFrom.trim() || !newUomTo.trim() || newUomFactor === "") return;
            const next = [...uomMappings.filter(u => !(u.fromUnit === newUomFrom.trim() && u.toUnit === newUomTo.trim())),
              { fromUnit: newUomFrom.trim(), toUnit: newUomTo.trim(), factor: Number(newUomFactor) }];
            setUomMappings(next); saveUomMappings(next);
            setNewUomFrom(""); setNewUomTo(""); setNewUomFactor("");
          }} disabled={!newUomFrom.trim() || !newUomTo.trim() || newUomFactor === ""}>Add</Btn>
        </div>
        {uomMappings.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: "8px 0" }}>No conversions defined yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: C.card }}>
              {["On Hand Unit", "→", "Order Unit", "Factor", "Reverse", ""].map((h, i) => (
                <th key={i} style={{ padding: "6px 10px", textAlign: i > 2 ? "right" : "left", color: C.muted, fontSize: 10, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {uomMappings.map((u, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}33` }}>
                  <td style={{ padding: "6px 10px", color: C.text, fontWeight: 600 }}>{u.fromUnit}</td>
                  <td style={{ padding: "6px 10px", color: C.muted }}>→</td>
                  <td style={{ padding: "6px 10px", color: C.text, fontWeight: 600 }}>{u.toUnit}</td>
                  <td style={{ padding: "6px 10px", color: C.purple, fontWeight: 700, textAlign: "right" }}>{u.factor}</td>
                  <td style={{ padding: "6px 10px", color: C.muted, textAlign: "right" }}>{u.factor > 0 ? `${(1/u.factor).toFixed(4).replace(/\.?0+$/, "")} ${u.fromUnit}/${u.toUnit}` : "—"}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right" }}>
                    <Btn small variant="danger" onClick={() => {
                      const next = uomMappings.filter((_, j) => j !== i);
                      setUomMappings(next); saveUomMappings(next);
                    }}>✕</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Prefix/Suffix pack-size rules */}
      <div style={{ background: C.surface, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
        <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 6px" }}>PRODUCT ID PREFIX / SUFFIX RULES</p>
        <p style={{ color: C.muted, fontSize: 12, margin: "0 0 10px" }}>
          Match products by a prefix or suffix in their ID to apply a pack-size conversion. Example: suffix <strong style={{ color: C.accent }}>BB</strong> → 1 BB = 24 on-hand units.
        </p>
        <div style={{ background: C.card, borderRadius: 8, padding: "10px 12px", marginBottom: 12, border: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: psDetected !== null ? 10 : 0 }}>
            <span style={{ color: C.muted, fontSize: 11, fontWeight: 700, flex: 1 }}>AUTO-DETECT PATTERNS (1–3 letters)</span>
            <Btn small variant="ghost" onClick={() => setPsDetected(detectPrefixSuffixPatterns(allProductIds, psIgnored))}>Detect</Btn>
            {psDetected !== null && <Btn small variant="ghost" onClick={() => setPsDetected(null)}>Clear</Btn>}
          </div>
          {psDetected !== null && (psDetected.length === 0 ? (
            <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>No significant patterns found in product IDs.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
              {psDetected.map(p => {
                const typeColor = p.type === "prefix" ? C.accent : p.type === "suffix" ? C.purple : C.orange;
                const alreadyAdded = p.type !== "both" && prefixSuffixRules.some(r => r.matchType === p.type && r.text === p.text);
                return (
                  <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: C.surface, borderRadius: 6 }}>
                    <span style={{ color: typeColor, fontWeight: 700, fontSize: 10, minWidth: 46, letterSpacing: 0.5 }}>{p.type.toUpperCase()}</span>
                    <span style={{ color: C.text, fontWeight: 700, fontSize: 13, fontFamily: "monospace", minWidth: 44 }}>{p.text}</span>
                    <span style={{ color: C.muted, fontSize: 11, flex: 1 }}>{p.count} products · e.g. {p.examples.slice(0, 2).join(", ")}</span>
                    {!alreadyAdded && (
                      <Btn small variant="ghost" onClick={() => {
                        const newRules = p.type === "both"
                          ? [{ id: Date.now(), matchType: "prefix", text: p.prefix, purchaseSize: 1, orderMode: "unit" }, { id: Date.now() + 1, matchType: "suffix", text: p.suffix, purchaseSize: 1, orderMode: "unit" }]
                          : [{ id: Date.now(), matchType: p.type, text: p.text, purchaseSize: 1, orderMode: "unit" }];
                        const next = [...prefixSuffixRules, ...newRules.filter(nr => !prefixSuffixRules.some(r => r.matchType === nr.matchType && r.text === nr.text))];
                        savePsRulesLocal(next);
                        setPsDetected(prev => prev.filter(x => x.key !== p.key));
                      }}>Use</Btn>
                    )}
                    {alreadyAdded && <span style={{ color: C.green, fontSize: 11 }}>✓ Added</span>}
                    <Btn small variant="ghost" onClick={() => {
                      const next = new Set(psIgnored); next.add(p.key);
                      setPsIgnored(next);
                      try { localStorage.setItem("ordergen_ps_ignored_v1", JSON.stringify([...next])); } catch {}
                      setPsDetected(prev => prev.filter(x => x.key !== p.key));
                    }}>Ignore</Btn>
                  </div>
                );
              })}
            </div>
          ))}
          {psIgnored.size > 0 && (
            <div style={{ marginTop: psDetected !== null ? 10 : 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
              <span style={{ color: C.muted, fontSize: 10, fontWeight: 700 }}>IGNORED PATTERNS</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                {[...psIgnored].map(key => {
                  const parts = key.split(":");
                  const typeLabel = parts[0];
                  const text = parts.slice(1).join(":");
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 8px", background: C.surface, borderRadius: 10, border: `1px solid ${C.border}` }}>
                      <span style={{ color: C.muted, fontSize: 9, fontWeight: 700 }}>{typeLabel.toUpperCase()}</span>
                      <span style={{ color: C.text, fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>{text}</span>
                      <button onClick={() => {
                        const next = new Set(psIgnored); next.delete(key);
                        setPsIgnored(next);
                        try { localStorage.setItem("ordergen_ps_ignored_v1", JSON.stringify([...next])); } catch {}
                      }} title="Re-enable" style={{ background: "none", border: "none", color: C.green, cursor: "pointer", fontSize: 12, fontWeight: 700, padding: 0, lineHeight: 1 }}>↩</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 10 }}>
          <div>
            <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>MATCH BY</label>
            <div style={{ display: "flex", gap: 3 }}>
              {[["suffix", "Suffix"], ["prefix", "Prefix"]].map(([v, l]) => (
                <button key={v} onClick={() => setNewPsMatchType(v)} style={{ padding: "5px 10px", borderRadius: 5, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer", border: `1px solid ${newPsMatchType === v ? C.purple : C.border}`, background: newPsMatchType === v ? C.purpleDim : "transparent", color: newPsMatchType === v ? C.purple : C.muted }}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>{newPsMatchType === "suffix" ? "SUFFIX TEXT" : "PREFIX TEXT"}</label>
            <Input value={newPsText} onChange={e => setNewPsText(e.target.value)} placeholder={newPsMatchType === "suffix" ? "e.g. BB" : "e.g. SYN"} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>
              {newPsOrderMode === "pack" ? "ON-HAND UNITS PER PACK" : "ROUND UP TO MULTIPLE OF"}
            </label>
            <Input type="number" value={newPsPackSize} onChange={e => setNewPsPackSize(e.target.value)} placeholder="e.g. 12" style={{ width: "100%" }} />
          </div>
          <Btn small onClick={() => {
            if (!newPsText.trim() || !newPsPackSize) return;
            const rule = { id: Date.now(), matchType: newPsMatchType, text: newPsText.trim(), purchaseSize: Number(newPsPackSize), orderMode: newPsOrderMode };
            const next = [...prefixSuffixRules.filter(r => !(r.matchType === rule.matchType && r.text === rule.text)), rule];
            savePsRulesLocal(next); setNewPsText(""); setNewPsPackSize("");
          }} disabled={!newPsText.trim() || !newPsPackSize}>Add</Btn>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 12px", background: C.card, borderRadius: 8, border: `1px solid ${C.border}` }}>
          <span style={{ color: C.muted, fontSize: 12, fontWeight: 700 }}>ORDER MODE:</span>
          {[["pack", "In Packs"], ["unit", "Round to Multiple of N"]].map(([v, l]) => (
            <button key={v} onClick={() => setNewPsOrderMode(v)} style={{ padding: "4px 12px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer", border: `1px solid ${newPsOrderMode === v ? C.accent : C.border}`, background: newPsOrderMode === v ? C.accentDim : "transparent", color: newPsOrderMode === v ? C.accent : C.muted }}>{l}</button>
          ))}
          <span style={{ color: C.muted, fontSize: 11, marginLeft: 4 }}>
            {newPsOrderMode === "pack"
              ? `Order column shows packs — e.g. order 2 = 2 × ${newPsPackSize || "N"} = ${newPsPackSize ? 2 * Number(newPsPackSize) : "2N"} on-hand units received`
              : `Order column shows units, always rounded UP to the next multiple of ${newPsPackSize || "N"} — e.g. need 4 → order ${newPsPackSize ? Math.ceil(4 / Number(newPsPackSize)) * Number(newPsPackSize) : "N"}, need 13 → order ${newPsPackSize ? Math.ceil(13 / Number(newPsPackSize)) * Number(newPsPackSize) : "2N"}`}
          </span>
        </div>
        {prefixSuffixRules.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: "4px 0" }}>No prefix/suffix rules defined yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: C.card }}>
              {["Match", "Text", "N (Pack / Multiple)", "Exclusions", "Order Mode", ""].map((h, i) => (
                <th key={i} style={{ padding: "6px 10px", textAlign: i >= 4 ? "right" : "left", color: C.muted, fontSize: 10, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {prefixSuffixRules.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}33` }}>
                  <td style={{ padding: "6px 10px", color: C.muted }}>{r.matchType}</td>
                  <td style={{ padding: "6px 10px", color: C.purple, fontWeight: 700 }}>{r.text}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <span style={{ color: C.text, fontWeight: 700 }}>{r.purchaseSize}</span>
                    <span style={{ color: C.muted, marginLeft: 5, fontSize: 11 }}>
                      {r.orderMode === "pack" ? `on-hand / pack` : `→ multiples: ${r.purchaseSize}, ${r.purchaseSize * 2}, ${r.purchaseSize * 3}…`}
                    </span>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    {(() => {
                      const excl = r.exclusions || { products: [], categories: [] };
                      const total = (excl.products?.length || 0) + (excl.categories?.length || 0);
                      return (
                        <button onClick={() => setPsExclPopup(r.id)}
                          style={{ padding: "3px 10px", borderRadius: 5, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                            border: `1px solid ${total > 0 ? C.orange : C.border}`,
                            background: total > 0 ? C.orange + "22" : "transparent",
                            color: total > 0 ? C.orange : C.muted }}>
                          {total > 0 ? `${total} excluded` : "Exclude"}
                        </button>
                      );
                    })()}
                  </td>
                  <td style={{ padding: "6px 10px", color: C.muted, textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      {[["pack", "In Packs"], ["unit", "×Multiple"]].map(([v, l]) => (
                        <button key={v} onClick={() => { const next = prefixSuffixRules.map(x => x.id === r.id ? { ...x, orderMode: v } : x); savePsRulesLocal(next); }}
                          title={v === "pack" ? `Order column shows packs (1 pack = ${r.purchaseSize} on-hand units)` : `Order column shows units, rounded UP to next multiple of ${r.purchaseSize}`}
                          style={{ padding: "2px 8px", borderRadius: 4, fontFamily: "inherit", fontWeight: 700, fontSize: 10, cursor: "pointer", border: `1px solid ${r.orderMode === v ? C.accent : C.border}`, background: r.orderMode === v ? C.accentDim : "transparent", color: r.orderMode === v ? C.accent : C.muted }}>{l}</button>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right" }}>
                    <Btn small variant="danger" onClick={() => savePsRulesLocal(prefixSuffixRules.filter(x => x.id !== r.id))}>✕</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Exclusion popup */}
      {psExclPopup !== null && (() => {
        const rule = prefixSuffixRules.find(r => r.id === psExclPopup);
        if (!rule) return null;
        const excl = rule.exclusions || { products: [], categories: [] };
        const matchedIds = allProductIds.filter(id => rule.matchType === "prefix" ? id.toUpperCase().startsWith(rule.text.toUpperCase()) : id.toUpperCase().endsWith(rule.text.toUpperCase()));
        const excludedFromRule = matchedIds.filter(id => excl.products?.includes(id));
        const updateExcl = (next) => {
          savePsRulesLocal(prefixSuffixRules.map(r => r.id === psExclPopup ? { ...r, exclusions: next } : r));
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "#0008", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={e => { if (e.target === e.currentTarget) setPsExclPopup(null); }}>
            <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.orange}66`, padding: 24, width: 480, maxWidth: "95vw", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 16px 48px #0006" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <span style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>Exclusions — {rule.matchType} <span style={{ color: C.purple }}>{rule.text}</span></span>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>{matchedIds.length} products match this rule · {excludedFromRule.length} excluded</div>
                </div>
                <button onClick={() => setPsExclPopup(null)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18 }}>✕</button>
              </div>
              {/* Exclude by product */}
              <div style={{ marginBottom: 14 }}>
                <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 8px" }}>EXCLUDE BY PRODUCT</p>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <datalist id="excl-prod-list">{matchedIds.map(id => <option key={id} value={id} />)}</datalist>
                  <Input value={newExclProd} onChange={e => setNewExclProd(e.target.value)} placeholder="Product ID" list="excl-prod-list" style={{ flex: 1 }} />
                  <Btn small onClick={() => {
                    if (!newExclProd.trim() || excl.products?.includes(newExclProd.trim())) return;
                    updateExcl({ ...excl, products: [...(excl.products || []), newExclProd.trim()] });
                    setNewExclProd("");
                  }} disabled={!newExclProd.trim()}>Add</Btn>
                </div>
                {(excl.products || []).length === 0 ? (
                  <p style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: "6px 0" }}>No products excluded.</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {(excl.products || []).map(prod => (
                      <div key={prod} style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 8px", background: C.surface, borderRadius: 8, border: `1px solid ${C.orange}44` }}>
                        <span style={{ color: C.text, fontSize: 12 }}>{prod}</span>
                        <button onClick={() => updateExcl({ ...excl, products: excl.products.filter(p => p !== prod) })}
                          style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Exclude by category */}
              {availableCategories.length > 0 && (
                <div>
                  <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 8px" }}>EXCLUDE BY CATEGORY</p>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <datalist id="excl-cat-list">{availableCategories.map(c => <option key={c} value={c} />)}</datalist>
                    <Input value={newExclCat} onChange={e => setNewExclCat(e.target.value)} placeholder="Category name" list="excl-cat-list" style={{ flex: 1 }} />
                    <Btn small onClick={() => {
                      if (!newExclCat.trim() || excl.categories?.includes(newExclCat.trim())) return;
                      updateExcl({ ...excl, categories: [...(excl.categories || []), newExclCat.trim()] });
                      setNewExclCat("");
                    }} disabled={!newExclCat.trim()}>Add</Btn>
                  </div>
                  {(excl.categories || []).length === 0 ? (
                    <p style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: "6px 0" }}>No categories excluded.</p>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {(excl.categories || []).map(cat => (
                        <div key={cat} style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 8px", background: C.surface, borderRadius: 8, border: `1px solid ${C.orange}44` }}>
                          <span style={{ color: C.text, fontSize: 12 }}>{cat}</span>
                          <button onClick={() => updateExcl({ ...excl, categories: excl.categories.filter(c => c !== cat) })}
                            style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {hasCategory && availableCategories.length > 0 && (
        <div style={{ background: C.surface, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
          <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 10px" }}>CATEGORY DEFAULTS</p>
          <p style={{ color: C.muted, fontSize: 12, margin: "0 0 10px" }}>Set UoM for an entire category. Per-product rules override these.</p>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 10 }}>
            <div>
              <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>CATEGORY</label>
              <datalist id="uom-cat-list-step">{availableCategories.map(c => <option key={c} value={c} />)}</datalist>
              <Input value={newCatKey} onChange={e => setNewCatKey(e.target.value)} placeholder="e.g. Paint" style={{ width: "100%" }} list="uom-cat-list-step" />
            </div>
            <div>
              <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>ON HAND UOM</label>
              <Input value={newCatOnHandUom} onChange={e => setNewCatOnHandUom(e.target.value)} placeholder="e.g. qt" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>ORDER UOM</label>
              <Input value={newCatOrderUom} onChange={e => setNewCatOrderUom(e.target.value)} placeholder="e.g. gal" style={{ width: "100%" }} />
            </div>
            <Btn small onClick={() => {
              if (!newCatKey.trim() || !newCatOnHandUom.trim() || !newCatOrderUom.trim()) return;
              const next = { ...categoryUomSettings, [newCatKey.trim()]: { onHandUom: newCatOnHandUom.trim(), orderUom: newCatOrderUom.trim() } };
              setCategoryUomSettings(next); saveCategoryUom(next);
              setNewCatKey(""); setNewCatOnHandUom(""); setNewCatOrderUom("");
            }} disabled={!newCatKey.trim() || !newCatOnHandUom.trim() || !newCatOrderUom.trim()}>Save</Btn>
          </div>
          {Object.keys(categoryUomSettings).length === 0 ? (
            <p style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: "4px 0" }}>No category defaults set.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: C.card }}>
                {["Category", "On Hand UoM", "Order UoM", ""].map((h, i) => (
                  <th key={i} style={{ padding: "6px 10px", textAlign: i === 3 ? "right" : "left", color: C.muted, fontSize: 10, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {Object.entries(categoryUomSettings).map(([cat, uom]) => (
                  <tr key={cat} style={{ borderBottom: `1px solid ${C.border}33` }}>
                    <td style={{ padding: "6px 10px", color: C.text, fontWeight: 600 }}>{cat}</td>
                    <td style={{ padding: "6px 10px", color: C.purple }}>{uom.onHandUom}</td>
                    <td style={{ padding: "6px 10px", color: C.accent }}>{uom.orderUom}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>
                      <Btn small variant="danger" onClick={() => { const next = { ...categoryUomSettings }; delete next[cat]; setCategoryUomSettings(next); saveCategoryUom(next); }}>✕</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Btn variant="ghost" onClick={onBack}>← Back</Btn>
        <Btn onClick={() => onConfirm(uomMappings, categoryUomSettings, prefixSuffixRules)}>Continue to Review →</Btn>
      </div>
    </div>
  );
}

// ── STEP 3: Review Order ──────────────────────────────────────────────────────
function ReviewStep({ rawRows, headers, mapping, targetDays, usageConfig, manualEntry, orderLimits, uomMappings, categoryUomSettings, prefixSuffixRules, onConfirm, onBack, initialPendingOrders = [], isManualBuild = false, initialRows = null, manualLocations = [] }) {
  const hasCost = !!mapping.cost;
  const hasCategory = !!mapping.category;
  const hasUom = !!mapping.uom;
  const limitType = orderLimits?.limitType || "dollars"; // "units" | "dollars"

  // Product rules — loaded from localStorage, editable inline
  const [productRules, setProductRules] = useState(() => loadProductRules());
  const saveRules = (rules) => { setProductRules(rules); saveProductRules(rules); };
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  const [newRuleId, setNewRuleId] = useState("");
  const [newRuleCaseSize, setNewRuleCaseSize] = useState("");
  const [newRuleMin, setNewRuleMin] = useState("");
  const [newRuleMax, setNewRuleMax] = useState("");
  const [newRuleMaxOnHand, setNewRuleMaxOnHand] = useState("");
  const [newRuleOnHandUom, setNewRuleOnHandUom] = useState("");
  const [newRuleOrderUom, setNewRuleOrderUom] = useState("");
  const [rulesTab, setRulesTab] = useState("manual"); // "manual" | "upload" | "uom"
  const [rulesUploadPreview, setRulesUploadPreview] = useState(null); // parsed rows from file
  const [rulesDragging, setRulesDragging] = useState(false);
  const [rulesUploadError, setRulesUploadError] = useState("");
  const rulesFileRef = useRef();

  const [totalRowsIncluded, setTotalRowsIncluded] = useState(() => new Set());
  const [pendingOrders, setPendingOrders] = useState(initialPendingOrders);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const pendingFileRef = useRef();
  const [pendingUploadIdx, setPendingUploadIdx] = useState(0);
  const [pendingDragSlot, setPendingDragSlot] = useState(null);

  // Add Products to Order section
  const [addProductsExpanded, setAddProductsExpanded] = useState(false);
  const [manualAddList, setManualAddList] = useState([{ product: "", qty: "", location: "" }]);
  const [pushedManualItems, setPushedManualItems] = useState([]);

  // adj and ignoreMaxArg are explicit params (not closed-over state) so the lazy
  // useState initializer can call buildRows before those state declarations execute.
  const buildRows = (productRules, uomMaps = uomMappings, catUom = categoryUomSettings, psRules = prefixSuffixRules, pendingOrdrs = [], adj = null, ignoreMaxArg = null) =>
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
      const _rawUsage = daily_usage;
      // Apply usage adjustment multiplier
      const _adjMult = getUsageMultiplier(get("product"), hasCategory ? get("category") : "", adj);
      if (!isNaN(parseFloat(daily_usage)) && _adjMult !== 1) {
        daily_usage = parseFloat(daily_usage) * _adjMult;
      }
      const row = {
        _idx: i,
        location: get("location"), product: get("product"),
        daily_usage, on_hand: get("on_hand"), leadtime: get("leadtime"),
        category: hasCategory ? get("category") : "",
        cost: hasCost ? get("cost") : "",
        uom: hasUom ? get("uom") : "",
        min_on_hand: (mapping.min_on_hand || manualEntry?.fieldMode?.min_on_hand === "manual") ? get("min_on_hand") : "",
        max_on_hand: (mapping.max_on_hand || manualEntry?.fieldMode?.max_on_hand === "manual") ? get("max_on_hand") : "",
      };
      const productId = String(row.product ?? "").trim();
      const rule = (productRules || []).find(ru => String(ru.productId).trim() === productId);
      const _isTotal = isTotalRow(row);
      const uomConv = getUomConversion(row, productRules, catUom, uomMaps, psRules);
      const days_on_hand = calcDaysOnHand(row);
      const onHandNum = parseFloat(row.on_hand);
      const pendingKey = `${String(row.location || "").trim()}|${String(row.product || "").trim()}`.toLowerCase();
      const pendingQtyTotal = pendingOrdrs.reduce((s, po) => s + (po._index?.get(pendingKey) ?? 0), 0);
      const effectiveOnHand = isNaN(onHandNum) ? null : onHandNum + pendingQtyTotal;
      const _orderMode = orderLimits?.orderMode || "days_supply";
      const _zeroFill = orderLimits?.zeroUsageFill || "none";
      const suggested = computeSuggested(row, effectiveOnHand, targetDays, uomConv, _orderMode, _zeroFill);
      let finalOrder = _isTotal ? 0 : (rule ? applyProductRule(rule, suggested ?? 0, effectiveOnHand) : (suggested ?? 0));
      if (!_isTotal && uomConv.isPack && uomConv.packSize > 1 && !uomConv.hasConversion && (!rule || rule.caseSize == null) && finalOrder > 0) {
        finalOrder = Math.ceil(finalOrder / uomConv.packSize) * uomConv.packSize;
      }
      const { order: _constrained, minC: _minConstrained, maxC: _maxConstrained } = applyOnHandConstraints(finalOrder, row, effectiveOnHand, uomConv, ignoreMaxArg);
      finalOrder = _constrained;
      const safeOrder = Math.max(0, finalOrder);
      const est_on_hand_after = !_isTotal && !isNaN(onHandNum) ? onHandNum + pendingQtyTotal + safeOrder * uomConv.orderToOnHandFactor : null;
      const units_ordered = !_isTotal && !isNaN(safeOrder) ? Math.round(safeOrder * (uomConv.orderToOnHandFactor ?? 1)) : null;
      const pendingQtys = {};
      pendingOrdrs.forEach(po => { pendingQtys[`pending_${po.id}`] = po._index?.get(pendingKey) ?? 0; });
      return { ...row, suggested, order: safeOrder, days_on_hand, est_on_hand_after, appliedRule: rule || null, uomConv, _isTotal, _rawUsage, _minConstrained, _maxConstrained, on_hand_uom: uomConv.onHandUom || "", order_uom: uomConv.orderUom || "", units_ordered, ...pendingQtys };
    });

  // ignoreMax must be declared BEFORE rows so buildRows() can close over it safely
  const [ignoreMax, setIgnoreMax] = useState(() => loadIgnoreMax());
  const [ignoreMaxExpanded, setIgnoreMaxExpanded] = useState(false);
  const [newIgnoreMaxCat, setNewIgnoreMaxCat] = useState("");
  const [newIgnoreMaxProd, setNewIgnoreMaxProd] = useState("");
  const saveIgnoreMaxState = (v) => { setIgnoreMax(v); saveIgnoreMax(v); };

  const [rows, setRows] = useState(() => initialRows ?? buildRows(productRules, uomMappings, categoryUomSettings, prefixSuffixRules, [], loadUsageAdjustments(), loadIgnoreMax()));
  const [targetLocal, setTargetLocal] = useState(targetDays);
  // colTextFilters: { [colKey]: string }  — type-in text filter
  // colCheckedFilters: { [colKey]: Set<string> }  — empty Set = show all; non-empty = show only checked
  const [colTextFilters, setColTextFilters] = useState({});
  const [colCheckedFilters, setColCheckedFilters] = useState({});
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(1);
  const [hideZero, setHideZero] = useState(false);

  const [usageAdj, setUsageAdj] = useState(() => loadUsageAdjustments());
  const [adjExpanded, setAdjExpanded] = useState(false);
  const [newAdjGlobal, setNewAdjGlobal] = useState("");
  const [newAdjCat, setNewAdjCat] = useState("");
  const [newAdjCatPct, setNewAdjCatPct] = useState("");
  const [newAdjProd, setNewAdjProd] = useState("");
  const [newAdjProdPct, setNewAdjProdPct] = useState("");
  const saveAdj = (a) => { setUsageAdj(a); saveUsageAdjustments(a); };

  const applyPackRounding = (finalOrder, rule, uomConv) => {
    if (uomConv.isPack && uomConv.packSize > 1 && !uomConv.hasConversion && (!rule || rule.caseSize == null) && finalOrder > 0) {
      return Math.ceil(finalOrder / uomConv.packSize) * uomConv.packSize;
    }
    return finalOrder;
  };

  const recalc = (td, rulesOverride, uomOverride, catUomOverride, psOverride, pendingOverride, adjOverride) => {
    const rules = rulesOverride ?? productRules;
    const uomMaps = uomOverride ?? uomMappings;
    const catUom = catUomOverride ?? categoryUomSettings;
    const psRules = psOverride ?? prefixSuffixRules;
    const poList = pendingOverride ?? pendingOrders;
    const adj = adjOverride ?? usageAdj;
    setRows(prev => prev.map(r => {
      const pendingKey = `${String(r.location || "").trim()}|${String(r.product || "").trim()}`.toLowerCase();
      const pendingQtyTotal = poList.reduce((s, po) => s + (po._index?.get(pendingKey) ?? 0), 0);
      const uomConv = getUomConversion(r, rules, catUom, uomMaps, psRules);
      const onHandNum = parseFloat(r.on_hand);
      const effectiveOnHand = isNaN(onHandNum) ? null : onHandNum + pendingQtyTotal;
      const adjMult = getUsageMultiplier(r.product, r.category, adj);
      const effectiveDailyUsage = isNaN(parseFloat(r._rawUsage ?? r.daily_usage)) ? r.daily_usage : parseFloat(r._rawUsage ?? r.daily_usage) * adjMult;
      const adjRow = { ...r, daily_usage: effectiveDailyUsage };
      const _om = orderLimits?.orderMode || "days_supply";
      const _zf = orderLimits?.zeroUsageFill || "none";
      const s = computeSuggested(adjRow, effectiveOnHand, td, uomConv, _om, _zf);
      const rule = rules.find(ru => String(ru.productId).trim() === String(r.product ?? "").trim());
      let finalOrder = r._isTotal ? 0 : (rule ? applyProductRule(rule, s ?? 0, effectiveOnHand) : (s ?? 0));
      finalOrder = applyPackRounding(finalOrder, rule, uomConv);
      const { order: _co, minC: _minConstrained, maxC: _maxConstrained } = applyOnHandConstraints(finalOrder, r, effectiveOnHand, uomConv, ignoreMax);
      finalOrder = _co;
      const safeOrder = Math.max(0, finalOrder);
      const est_on_hand_after = r._isTotal || isNaN(onHandNum) ? null : onHandNum + pendingQtyTotal + safeOrder * uomConv.orderToOnHandFactor;
      const days_on_hand = calcDaysOnHand(adjRow);
      const units_ordered = r._isTotal || isNaN(safeOrder) ? null : Math.round(safeOrder * (uomConv.orderToOnHandFactor ?? 1));
      const pendingQtys = {};
      poList.forEach(po => { pendingQtys[`pending_${po.id}`] = po._index?.get(pendingKey) ?? 0; });
      return { ...r, daily_usage: effectiveDailyUsage, suggested: s, order: safeOrder, appliedRule: rule || null, est_on_hand_after, days_on_hand, uomConv, _minConstrained, _maxConstrained, on_hand_uom: uomConv.onHandUom || "", order_uom: uomConv.orderUom || "", units_ordered, ...pendingQtys };
    }));
    setTargetLocal(td);
  };

  const applyRulesToRows = (rules, uomOverride, catUomOverride, psOverride) => {
    const uomMaps = uomOverride ?? uomMappings;
    const catUom = catUomOverride ?? categoryUomSettings;
    const psRules = psOverride ?? prefixSuffixRules;
    const poList = pendingOrders;
    setRows(prev => prev.map(r => {
      const pendingKey = `${String(r.location || "").trim()}|${String(r.product || "").trim()}`.toLowerCase();
      const pendingQtyTotal = poList.reduce((s, po) => s + (po._index?.get(pendingKey) ?? 0), 0);
      const uomConv = getUomConversion(r, rules, catUom, uomMaps, psRules);
      const onHandNum = parseFloat(r.on_hand);
      const effectiveOnHand = isNaN(onHandNum) ? null : onHandNum + pendingQtyTotal;
      const adjMult = getUsageMultiplier(r.product, r.category, usageAdj);
      const effectiveDailyUsage = isNaN(parseFloat(r._rawUsage ?? r.daily_usage)) ? r.daily_usage : parseFloat(r._rawUsage ?? r.daily_usage) * adjMult;
      const adjRow = { ...r, daily_usage: effectiveDailyUsage };
      const _om2 = orderLimits?.orderMode || "days_supply";
      const _zf2 = orderLimits?.zeroUsageFill || "none";
      const s = computeSuggested(adjRow, effectiveOnHand, targetLocal, uomConv, _om2, _zf2);
      const rule = rules.find(ru => String(ru.productId).trim() === String(r.product ?? "").trim());
      let finalOrder = r._isTotal ? 0 : (rule ? applyProductRule(rule, s ?? 0, effectiveOnHand) : (s ?? 0));
      finalOrder = applyPackRounding(finalOrder, rule, uomConv);
      const { order: _co2, minC: _minConstrained, maxC: _maxConstrained } = applyOnHandConstraints(finalOrder, r, effectiveOnHand, uomConv, ignoreMax);
      finalOrder = _co2;
      const safeOrder = Math.max(0, finalOrder);
      const est_on_hand_after = r._isTotal || isNaN(onHandNum) ? null : onHandNum + pendingQtyTotal + safeOrder * uomConv.orderToOnHandFactor;
      const days_on_hand = calcDaysOnHand(adjRow);
      const units_ordered = r._isTotal || isNaN(safeOrder) ? null : Math.round(safeOrder * (uomConv.orderToOnHandFactor ?? 1));
      const pendingQtys = {};
      poList.forEach(po => { pendingQtys[`pending_${po.id}`] = po._index?.get(pendingKey) ?? 0; });
      return { ...r, daily_usage: effectiveDailyUsage, suggested: s, order: safeOrder, appliedRule: rule || null, est_on_hand_after, days_on_hand, uomConv, _minConstrained, _maxConstrained, on_hand_uom: uomConv.onHandUom || "", order_uom: uomConv.orderUom || "", units_ordered, ...pendingQtys };
    }));
  };
  const setOrder = (idx, val) => setRows(prev => prev.map(r => {
    if (r._idx !== idx) return r;
    const newOrder = val === "" ? "" : Math.max(0, Number(val));
    const onHandNum = parseFloat(r.on_hand);
    const factor = r.uomConv?.orderToOnHandFactor ?? 1;
    const est_on_hand_after = !isNaN(onHandNum) && newOrder !== "" ? onHandNum + Number(newOrder) * factor : null;
    return { ...r, order: newOrder, est_on_hand_after };
  }));
  const resetOne = (idx) => setRows(prev => prev.map(r => {
    if (r._idx !== idx) return r;
    const o = Math.max(0, r.suggested ?? 0);
    const onHandNum = parseFloat(r.on_hand);
    const factor = r.uomConv?.orderToOnHandFactor ?? 1;
    const est_on_hand_after = !isNaN(onHandNum) ? onHandNum + o * factor : null;
    return { ...r, order: o, est_on_hand_after };
  }));
  const resetAll = () => recalc(targetLocal);

  const applyPendingToRows = (poList) => {
    setRows(prev => prev.map(r => {
      const pendingKey = `${String(r.location || "").trim()}|${String(r.product || "").trim()}`.toLowerCase();
      const pendingQtyTotal = poList.reduce((s, po) => s + (po._index?.get(pendingKey) ?? 0), 0);
      const onHandNum = parseFloat(r.on_hand);
      const effectiveOnHand = isNaN(onHandNum) ? null : onHandNum + pendingQtyTotal;
      const uomConv = r.uomConv ?? { onHandToOrderFactor: 1, orderToOnHandFactor: 1 };
      const adjMult = getUsageMultiplier(r.product, r.category, usageAdj);
      const effectiveDailyUsage = isNaN(parseFloat(r._rawUsage ?? r.daily_usage)) ? r.daily_usage : parseFloat(r._rawUsage ?? r.daily_usage) * adjMult;
      const adjRow = { ...r, daily_usage: effectiveDailyUsage };
      const s = r._isTotal ? null : calcOrder(adjRow, targetLocal, uomConv.onHandToOrderFactor ?? 1, effectiveOnHand);
      const rule = r.appliedRule;
      const wasEdited = r.order !== r.suggested;
      let newOrder;
      if (wasEdited) {
        newOrder = r.order;
      } else {
        let fo = rule ? applyProductRule(rule, s ?? 0, effectiveOnHand) : (s ?? 0);
        fo = applyPackRounding(fo, rule, uomConv);
        newOrder = Math.max(0, fo);
      }
      const est_on_hand_after = r._isTotal || isNaN(onHandNum) ? null : onHandNum + pendingQtyTotal + newOrder * (uomConv.orderToOnHandFactor ?? 1);
      const units_ordered = r._isTotal || isNaN(newOrder) ? null : Math.round(newOrder * (uomConv.orderToOnHandFactor ?? 1));
      const pendingQtys = {};
      poList.forEach(po => { pendingQtys[`pending_${po.id}`] = po._index?.get(pendingKey) ?? 0; });
      return { ...r, daily_usage: effectiveDailyUsage, suggested: s, order: newOrder, est_on_hand_after, units_ordered, ...pendingQtys };
    }));
  };

  // When ReviewStep mounts with restored pending orders (coming back from Export step),
  // re-apply their quantities to the rows so the pending columns show actual values.
  useEffect(() => {
    if (initialPendingOrders && initialPendingOrders.length > 0) {
      applyPendingToRows(initialPendingOrders);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount only

  // Add Products to Order handler
  const handleAddToOrder = () => {
    const validItems = manualAddList.filter(item => item.product.trim() && item.qty !== "" && !isNaN(Number(item.qty)));
    if (!validItems.length) return;
    setRows(prev => {
      let next = [...prev];
      validItems.forEach(item => {
        const prodKey = item.product.trim().toLowerCase();
        const locKey = item.location.trim().toLowerCase();
        const qty = Math.max(0, Number(item.qty));
        // Match by product + location (if location specified)
        const existingIdx = next.findIndex(r =>
          String(r.product ?? "").trim().toLowerCase() === prodKey &&
          (!locKey || String(r.location ?? "").trim().toLowerCase() === locKey)
        );
        if (existingIdx >= 0) {
          next = next.map((r, i) => i === existingIdx ? { ...r, order: qty } : r);
        } else {
          const newIdx = -(Date.now() + Math.random() * 1000);
          next = [...next, {
            _idx: newIdx, product: item.product.trim(), location: item.location.trim(),
            daily_usage: "", on_hand: "", leadtime: "", category: "", cost: "", uom: "",
            min_on_hand: "", max_on_hand: "", order: qty, suggested: qty,
            days_on_hand: null, est_on_hand_after: null, appliedRule: null,
            uomConv: { onHandToOrderFactor: 1, orderToOnHandFactor: 1, isPack: false, packSize: 1, hasConversion: false },
            _isTotal: false, _rawUsage: "", _minConstrained: false, _maxConstrained: false,
            on_hand_uom: "", order_uom: "", units_ordered: qty, _manuallyAdded: true,
          }];
        }
      });
      return next;
    });
    setPushedManualItems(prev => {
      const next = [...prev];
      validItems.forEach(item => {
        const existing = next.findIndex(p =>
          p.product.trim().toLowerCase() === item.product.trim().toLowerCase() &&
          (p.location ?? "").trim().toLowerCase() === item.location.trim().toLowerCase()
        );
        if (existing >= 0) next[existing] = { ...item };
        else next.push({ product: item.product.trim(), qty: item.qty, location: item.location.trim() });
      });
      return next;
    });
    // reset list to single empty row after push
    setManualAddList([{ product: "", qty: "", location: "" }]);
  };

  const handlePendingFile = (slotIdx, file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (data.length < 2) return;
        const hdrs = data[0].map(h => String(h).trim());
        const rawR = data.slice(1).filter(row => row.some(c => String(c).trim() !== ""));
        const colMap = autoPendingColMap(hdrs);
        const po = { id: Date.now() + slotIdx, filename: file.name, headers: hdrs, rawRows: rawR, colMap, deliveryMode: "days", deliveryDate: "", leadtimeDays: "" };
        po._index = buildPendingIndex(po);
        const next = [...pendingOrders];
        while (next.length <= slotIdx) next.push(null);
        next[slotIdx] = po;
        const filtered = next.filter(Boolean);
        setPendingOrders(filtered);
        applyPendingToRows(filtered);
      } catch {}
    };
    reader.readAsArrayBuffer(file);
  };

  const removePendingOrder = (id) => {
    const next = pendingOrders.filter(po => po.id !== id);
    setPendingOrders(next);
    applyPendingToRows(next);
  };

  const updatePendingOrderMeta = (id, updates) => {
    const next = pendingOrders.map(po => {
      if (po.id !== id) return po;
      const updated = { ...po, ...updates };
      if ("colMap" in updates) updated._index = buildPendingIndex(updated);
      return updated;
    });
    setPendingOrders(next);
    if ("colMap" in updates) applyPendingToRows(next);
  };

  const sort = (key) => { if (sortKey === key) setSortDir(d => -d); else { setSortKey(key); setSortDir(1); } };
  const setTextFilter = (key, val) => setColTextFilters(f => ({ ...f, [key]: val }));
  const setCheckedFilter = (key, set) => setColCheckedFilters(f => ({ ...f, [key]: set }));
  const clearFilters = () => { setColTextFilters({}); setColCheckedFilters({}); };

  const COLS = [
    { key: "location", label: "Location", defaultWidth: 120 },
    { key: "product", label: "Product", defaultWidth: 180 },
    ...(hasCategory && !isManualBuild ? [{ key: "category", label: "Category", defaultWidth: 120 }] : []),
    ...(!isManualBuild ? [{ key: "on_hand_uom", label: "On Hand UoM", defaultWidth: 100 }] : []),
    ...(!isManualBuild ? [{ key: "daily_usage", label: usageConfig.mode === "calculated" ? `Daily Usage (÷${usageConfig.salesDays}d)` : "Daily Usage", defaultWidth: 120 }] : []),
    ...(!isManualBuild ? [{ key: "on_hand", label: "On Hand", defaultWidth: 90 }] : []),
    ...(!isManualBuild && (mapping.min_on_hand || manualEntry?.fieldMode?.min_on_hand === "manual") ? [{ key: "min_on_hand", label: "Min On Hand", defaultWidth: 100 }] : []),
    ...(!isManualBuild && (mapping.max_on_hand || manualEntry?.fieldMode?.max_on_hand === "manual") ? [{ key: "max_on_hand", label: "Max On Hand", defaultWidth: 100 }] : []),
    ...(!isManualBuild ? [{ key: "days_on_hand", label: "Days On Hand", defaultWidth: 110 }] : []),
    ...(!isManualBuild ? [{ key: "leadtime", label: "Lead Time", defaultWidth: 90 }] : []),
    ...(!isManualBuild ? [{ key: "suggested", label: "Suggested", defaultWidth: 100 }] : []),
    ...(!isManualBuild ? [{ key: "est_on_hand_after", label: "Est. On Hand After", defaultWidth: 140 }] : []),
    ...pendingOrders.map((po, i) => ({
      key: `pending_${po.id}`,
      label: `Pending ${i + 1}${po.deliveryDate ? ` (${po.deliveryDate})` : po.leadtimeDays ? ` +${po.leadtimeDays}d` : ""}`,
      defaultWidth: 100, noFilter: true, noSort: true,
    })),
    { key: "order", label: "Order Qty", defaultWidth: 110, noFilter: true },
    ...(!isManualBuild ? [{ key: "order_uom", label: "Order UoM", defaultWidth: 100 }] : []),
    ...(!isManualBuild ? [{ key: "units_ordered", label: "Units Ordered", defaultWidth: 110, noFilter: true, noSort: true }] : []),
    ...(hasCost ? [{ key: "ext_cost", label: "Ext. Cost", defaultWidth: 100, noFilter: true, noSort: true }] : []),
  ];

  const _tPrefs = loadTablePrefs();
  const [savedColOrder, setSavedColOrder] = useState(() => _tPrefs.colOrder ?? null);
  const [pinnedCols, setPinnedCols] = useState(() => new Set(_tPrefs.pinnedCols ?? ["location", "product"]));
  const [colWidths, setColWidths] = useState(() => _tPrefs.colWidths ?? {});
  const dragColRef = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  const defaultColKeys = COLS.map(c => c.key);
  const effectiveColOrder = savedColOrder
    ? [...savedColOrder.filter(k => defaultColKeys.includes(k)), ...defaultColKeys.filter(k => !savedColOrder.includes(k))]
    : defaultColKeys;
  const orderedCols = effectiveColOrder.map(k => COLS.find(c => c.key === k)).filter(Boolean);
  const pinnedOrdered = orderedCols.filter(c => pinnedCols.has(c.key));
  const unpinnedOrdered = orderedCols.filter(c => !pinnedCols.has(c.key));
  const displayCols = [...pinnedOrdered, ...unpinnedOrdered];
  const getColWidth = (key) => colWidths[key] ?? COLS.find(c => c.key === key)?.defaultWidth ?? 120;
  const pinnedLeftOffsets = {};
  let _leftAcc = 0;
  for (const col of pinnedOrdered) { pinnedLeftOffsets[col.key] = _leftAcc; _leftAcc += getColWidth(col.key); }

  const _savePrefs = (order, pinned, widths) => {
    saveTablePrefs({ colOrder: order ?? effectiveColOrder, pinnedCols: [...(pinned ?? pinnedCols)], colWidths: widths ?? colWidths });
  };
  const togglePin = (key) => {
    const next = new Set(pinnedCols);
    if (next.has(key)) next.delete(key); else next.add(key);
    setPinnedCols(next); _savePrefs(null, next, null);
  };
  const startResize = (key, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startWidth = getColWidth(key);
    const onMove = (ev) => setColWidths(prev => ({ ...prev, [key]: Math.max(60, startWidth + ev.clientX - startX) }));
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const newWidths = { ...colWidths, [key]: Math.max(60, startWidth + ev.clientX - startX) };
      setColWidths(newWidths); _savePrefs(null, null, newWidths);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const onDragStart = (key, e) => { dragColRef.current = key; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); };
  const onDragOver = (key, e) => { e.preventDefault(); setDragOver(key); };
  const onDrop = (key, e) => {
    e.preventDefault();
    const from = dragColRef.current;
    if (!from || from === key) { setDragOver(null); return; }
    const newOrder = [...effectiveColOrder];
    const fi = newOrder.indexOf(from), ti = newOrder.indexOf(key);
    if (fi < 0 || ti < 0) { setDragOver(null); return; }
    newOrder.splice(fi, 1); newOrder.splice(ti, 0, from);
    setSavedColOrder(newOrder); setDragOver(null); _savePrefs(newOrder, null, null);
  };
  const onDragEnd = () => { dragColRef.current = null; setDragOver(null); };

  const renderCell = (col, r, edited) => {
    switch (col.key) {
      case "location": return <span style={{ color: C.text, fontSize: 13 }}>{r.location}</span>;
      case "product": return (
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product}</span>
          {r.appliedRule && <span title={`Rule: case=${r.appliedRule.caseSize ?? "—"} min=${r.appliedRule.minQty ?? "—"} max=${r.appliedRule.maxQty ?? "—"}`} style={{ color: C.purple, fontSize: 11, cursor: "help", flexShrink: 0 }}>⚙</span>}
        </span>
      );
      case "category": return <span style={{ color: C.muted, fontSize: 12 }}>{r.category}</span>;
      case "on_hand_uom": return <span style={{ color: C.muted, fontSize: 12 }}>{r.on_hand_uom || "—"}</span>;
      case "daily_usage": return <span style={{ color: usageConfig.mode === "calculated" ? C.purple : C.muted, fontSize: 13 }}>{fmtUsage(r.daily_usage)}</span>;
      case "on_hand": return <span style={{ color: C.muted, fontSize: 13 }}>{fmtNum(r.on_hand)}</span>;
      case "days_on_hand": {
        const doh = r.days_on_hand;
        const dohColor = doh === null ? C.muted : doh < 3 ? C.red : doh < 7 ? C.orange : C.green;
        return <span style={{ color: dohColor, fontWeight: doh !== null && doh < 7 ? 700 : 400, fontSize: 13 }}>{doh === null ? "—" : fmtNum(doh) + "d"}</span>;
      }
      case "leadtime": return <span style={{ color: C.muted, fontSize: 13 }}>{fmtNum(r.leadtime)}</span>;
      case "suggested": return r.suggested === null
        ? <span style={{ color: C.red, fontSize: 12 }}>N/A</span>
        : <span style={{ color: r.suggested === 0 ? C.green : C.accent, fontWeight: 700 }}>{fmtNum(r.suggested, 0)}</span>;
      case "min_on_hand": {
        const v = r.min_on_hand;
        const n = parseFloat(v);
        return <span style={{ color: !isNaN(n) ? C.purple : C.muted, fontSize: 12 }}>{!isNaN(n) ? fmtNum(n, 0) : "—"}</span>;
      }
      case "max_on_hand": {
        const v = r.max_on_hand;
        const n = parseFloat(v);
        return <span style={{ color: !isNaN(n) ? C.orange : C.muted, fontSize: 12 }}>{!isNaN(n) ? fmtNum(n, 0) : "—"}</span>;
      }
      case "est_on_hand_after": {
        const eoh = r.est_on_hand_after;
        if (eoh === null || eoh === undefined) return <span style={{ color: C.muted }}>—</span>;
        const rule = r.appliedRule;
        const overMax = rule?.maxOnHandAfter != null && eoh > rule.maxOnHandAfter;
        const color = overMax ? C.red : r._minConstrained ? C.purple : r._maxConstrained ? C.orange : eoh === 0 ? C.orange : C.green;
        const indicator = overMax ? " ⚠" : r._minConstrained ? " ↑" : r._maxConstrained ? " ↓" : "";
        const title = overMax ? `Exceeds max on hand after (${rule.maxOnHandAfter})` : r._minConstrained ? `Raised to meet min on hand (${r.min_on_hand})` : r._maxConstrained ? `Capped at max on hand (${r.max_on_hand})` : undefined;
        return <span style={{ color, fontWeight: 700, fontSize: 13 }} title={title}>{fmtNum(eoh, 0)}{indicator}</span>;
      }
      case "order": return (
        <Input type="number" min={0} value={r.order} onChange={e => setOrder(r._idx, e.target.value)}
          style={{ width: "100%", textAlign: "right", borderColor: edited ? C.orange : C.border }} />
      );
      case "order_uom": return <span style={{ color: C.muted, fontSize: 12 }}>{r.order_uom || "—"}</span>;
      case "units_ordered": {
        const uo = r.units_ordered;
        if (uo === null || uo === undefined || uo === 0) return <span style={{ color: C.muted }}>—</span>;
        const factor = r.uomConv?.orderToOnHandFactor ?? 1;
        if (Math.abs(factor - 1) < 0.0001) return <span style={{ color: C.muted }}>—</span>;
        return <span style={{ color: C.muted, fontSize: 12 }}>{fmtNum(uo, 0)}</span>;
      }
      case "ext_cost": {
        const extCost = !isNaN(parseFloat(r.cost)) ? parseFloat(r.cost) * (Number(r.order) || 0) : null;
        return <span style={{ color: C.muted, fontSize: 12 }}>{extCost !== null ? fmtCurrency(extCost) : "—"}</span>;
      }
      default: {
        if (col.key.startsWith("pending_")) {
          const qty = r[col.key] ?? 0;
          return <span style={{ color: qty > 0 ? C.green : C.muted, fontWeight: qty > 0 ? 700 : 400, fontSize: 13 }}>{qty > 0 ? fmtNum(qty, 0) : "—"}</span>;
        }
        return <span style={{ color: C.muted, fontSize: 12 }}>{String(r[col.key] ?? "")}</span>;
      }
    }
  };

  const activeFilterCount = COLS.filter(c => {
    if (c.noFilter) return false;
    const txt = colTextFilters[c.key] || "";
    const chk = colCheckedFilters[c.key];
    return txt || (chk && chk.mode === "some");
  }).length;

  const displayed = rows
    .filter(r => {
      if (r._isTotal && !totalRowsIncluded.has(r._idx)) return false;
      if (hideZero && (Number(r.order) || 0) === 0) return false;
      return COLS.every(c => {
        if (c.noFilter) return true;
        const cellVal = String(r[c.key] ?? "");
        const txt = (colTextFilters[c.key] || "").toLowerCase();
        if (txt && !cellVal.toLowerCase().includes(txt)) return false;
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

  const nonTotalRows = rows.filter(r => !r._isTotal || totalRowsIncluded.has(r._idx));
  const totalOrder = nonTotalRows.reduce((s, r) => s + (Number(r.order) || 0), 0);
  const totalCost = hasCost ? nonTotalRows.reduce((s, r) => {
    const c = parseFloat(r.cost), o = Number(r.order) || 0;
    return s + (isNaN(c) ? 0 : c * o);
  }, 0) : 0;
  const editedCount = rows.filter(r => r.order !== r.suggested).length;

  // Most/Least ordered callout cards — bulkVal lives inside OrderCalloutCard to avoid ReviewStep re-renders
  const [mostMode, setMostMode] = useState("unit");
  const [leastMode, setLeastMode] = useState("unit");
  const [mostN, setMostN] = useState(1);
  const [leastN, setLeastN] = useState(1);

  const setGroupOrders = (idxList, val) => {
    const newOrder = Math.max(0, Number(val));
    setRows(prev => prev.map(r => {
      if (!idxList.includes(r._idx)) return r;
      const onHandNum = parseFloat(r.on_hand);
      const factor = r.uomConv?.orderToOnHandFactor ?? 1;
      const est_on_hand_after = !isNaN(onHandNum) ? onHandNum + newOrder * factor : null;
      return { ...r, order: newOrder, est_on_hand_after };
    }));
  };

  const orderedRowsCallout = rows.filter(r => !r._isTotal && (Number(r.order) || 0) > 0);
  const sortedDescCallout = [...new Set(orderedRowsCallout.map(r => Number(r.order) || 0))].sort((a, b) => b - a);
  const sortedAscCallout  = [...sortedDescCallout].reverse();
  const mostQtysCallout = mostMode === "unit"
    ? sortedDescCallout.filter(q => q >= sortedDescCallout[0] - (mostN - 1)).slice(0, mostN)
    : sortedDescCallout.slice(0, mostN);
  const leastQtysCallout = leastMode === "unit"
    ? sortedAscCallout.filter(q => q <= sortedAscCallout[0] + (leastN - 1)).slice(0, leastN)
    : sortedAscCallout.slice(0, leastN);
  const maxRowsCallout = orderedRowsCallout.filter(r => mostQtysCallout.includes(Number(r.order) || 0));
  const minRowsCallout = orderedRowsCallout.filter(r => leastQtysCallout.includes(Number(r.order) || 0));
  const maxQtyCallout = sortedDescCallout[0] ?? null;
  const minQtyCallout = sortedAscCallout[0] ?? null;

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
      onHandUom: newRuleOnHandUom.trim() || null,
      orderUom: newRuleOrderUom.trim() || null,
    };
    const next = [...productRules.filter(r => r.productId !== rule.productId), rule];
    saveRules(next);
    applyRulesToRows(next);
    setNewRuleId(""); setNewRuleCaseSize(""); setNewRuleMin(""); setNewRuleMax(""); setNewRuleMaxOnHand("");
    setNewRuleOnHandUom(""); setNewRuleOrderUom("");
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
        <Btn onClick={() => onConfirm(rows, pendingOrders)}>Confirm & Configure Export →</Btn>
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
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                <div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>PRODUCT ID</label>
                  <Input value={newRuleId} onChange={e => setNewRuleId(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && newRuleId.trim() && addRule()}
                    placeholder="e.g. A1746" style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }} title="Rounds order up to next multiple — e.g. Case Size 12: need 4 → order 12, need 13 → order 24">CASE SIZE ×</label>
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
                <div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>ON HAND UOM</label>
                  <Input value={newRuleOnHandUom} onChange={e => setNewRuleOnHandUom(e.target.value)} placeholder="e.g. qt" style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>ORDER UOM</label>
                  <Input value={newRuleOrderUom} onChange={e => setNewRuleOrderUom(e.target.value)} placeholder="e.g. gal" style={{ width: "100%" }} />
                </div>
                <Btn small onClick={addRule} disabled={!newRuleId.trim()}>Add</Btn>
              </div>
              <p style={{ color: C.muted, fontSize: 11, margin: "8px 0 0" }}>
                Case size ×: rounds order UP to next multiple (e.g. ×12 → need 4 order 12, need 13 order 24). Min/max clamp after rounding. On Hand / Order UoM overrides the category default. Press Enter to save quickly.
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
                      {["Product ID", "Case Size", "Min Qty", "Max Qty", "Max On Hand After", "On Hand UoM", "Order UoM", ""].map((h, i) => (
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
                          <td style={{ padding: "8px 12px", color: rule.onHandUom ? C.purple : C.muted, textAlign: "right" }}>{rule.onHandUom ?? "—"}</td>
                          <td style={{ padding: "8px 12px", color: rule.orderUom ? C.accent : C.muted, textAlign: "right" }}>{rule.orderUom ?? "—"}</td>
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

      {/* Most / Least ordered callout cards — module-level OrderCalloutCard keeps inputs stable */}
      {orderedRowsCallout.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <OrderCalloutCard
            title="MOST ORDERED" accentColor={C.accent}
            theRows={maxRowsCallout} mode={mostMode} setMode={setMostMode}
            n={mostN} setN={setMostN} sortedList={sortedDescCallout}
            onSetOrder={setOrder} onSetGroupOrders={setGroupOrders}
            label={mostMode === "unit" && mostN === 1 ? `${fmtNum(maxQtyCallout, 0)} units` : `Top ${mostN} ${mostMode === "group" ? "rank" : "qty"}${mostN > 1 ? "s" : ""}`}
          />
          <OrderCalloutCard
            title="LEAST ORDERED" accentColor={C.orange}
            theRows={minRowsCallout.filter(() => minQtyCallout !== maxQtyCallout)} mode={leastMode} setMode={setLeastMode}
            n={leastN} setN={setLeastN} sortedList={sortedAscCallout}
            onSetOrder={setOrder} onSetGroupOrders={setGroupOrders}
            label={leastMode === "unit" && leastN === 1 ? `${fmtNum(minQtyCallout, 0)} units` : `Bottom ${leastN} ${leastMode === "group" ? "rank" : "qty"}${leastN > 1 ? "s" : ""}`}
          />
        </div>
      )}

      {/* pending orders panel */}
      <input ref={pendingFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) { handlePendingFile(pendingUploadIdx, e.target.files[0]); e.target.value = ""; } }} />
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <button onClick={() => setPendingExpanded(x => !x)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>
            📦 Pending Orders
            {pendingOrders.length > 0 && <span style={{ marginLeft: 8, color: C.green, fontSize: 12 }}>({pendingOrders.length} uploaded — affects {new Set(rows.filter(r => pendingOrders.some(po => (po._index?.get(`${String(r.location||"").trim()}|${String(r.product||"").trim()}`.toLowerCase()) ?? 0) > 0)).map(r => r._idx)).size} rows)</span>}
          </span>
          <span style={{ color: C.muted, fontSize: 12 }}>{pendingExpanded ? "▲" : "▼"}</span>
        </button>
        {pendingExpanded && (
          <div style={{ padding: "12px 16px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 14, flexWrap: "wrap", minHeight: 220 }}>
            {[0, 1, 2].map(slotIdx => {
              const po = pendingOrders[slotIdx];
              const matchCount = po ? [...(po._index?.values() ?? [])].filter(v => v > 0).length : 0;
              const isDraggingOver = pendingDragSlot === slotIdx;
              return (
                <div key={slotIdx}
                  onDragOver={e => { e.preventDefault(); setPendingDragSlot(slotIdx); }}
                  onDragEnter={e => { e.preventDefault(); setPendingDragSlot(slotIdx); }}
                  onDragLeave={() => setPendingDragSlot(null)}
                  onDrop={e => { e.preventDefault(); setPendingDragSlot(null); const f = e.dataTransfer.files[0]; if (f) handlePendingFile(slotIdx, f); }}
                  style={{ flex: "1 1 220px", minWidth: 200, background: isDraggingOver ? C.accent + "11" : C.card, borderRadius: 10, border: `1px solid ${isDraggingOver ? C.accent : po ? C.accent + "55" : C.border}`, padding: 12, display: "flex", flexDirection: "column", gap: 8, transition: "all .15s" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ color: C.muted, fontSize: 11, fontWeight: 700 }}>PENDING ORDER {slotIdx + 1}</span>
                    {po && <button onClick={() => removePendingOrder(po.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>}
                  </div>
                  {!po ? (
                    <button onClick={() => { setPendingUploadIdx(slotIdx); pendingFileRef.current.click(); }}
                      style={{ flex: 1, minHeight: 110, background: isDraggingOver ? C.accent + "18" : C.surface, border: `2px dashed ${isDraggingOver ? C.accent : C.border}`, borderRadius: 8, color: isDraggingOver ? C.accent : C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>
                      {isDraggingOver ? "Drop to upload" : "+ Upload File"}
                    </button>
                  ) : (
                    <>
                      <div style={{ color: C.text, fontSize: 12, fontWeight: 600, wordBreak: "break-all" }}>{po.filename}</div>
                      <div style={{ color: C.green, fontSize: 11 }}>✓ {matchCount} product{matchCount !== 1 ? "s" : ""} matched</div>
                      {/* Column mapping */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {[["product", "Product Col"], ["location", "Location Col"], ["qty", "Qty Col"]].map(([field, label]) => (
                          <div key={field} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ color: C.muted, fontSize: 10, fontWeight: 700, minWidth: 68 }}>{label.toUpperCase()}</span>
                            <select value={po.colMap[field] || ""} onChange={e => updatePendingOrderMeta(po.id, { colMap: { ...po.colMap, [field]: e.target.value } })}
                              style={{ flex: 1, background: C.surface, border: `1px solid ${po.colMap[field] ? C.border : C.orange}`, borderRadius: 4, color: C.text, fontFamily: "inherit", fontSize: 11, padding: "2px 4px" }}>
                              <option value="">— not set —</option>
                              {po.headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                      {/* Delivery mode */}
                      <div style={{ display: "flex", gap: 4 }}>
                        {[["days", "Lead Time Days"], ["date", "Delivery Date"]].map(([v, l]) => (
                          <button key={v} onClick={() => updatePendingOrderMeta(po.id, { deliveryMode: v })}
                            style={{ flex: 1, padding: "4px 6px", borderRadius: 5, fontFamily: "inherit", fontWeight: 700, fontSize: 10, cursor: "pointer", border: `1px solid ${po.deliveryMode === v ? C.accent : C.border}`, background: po.deliveryMode === v ? C.accentDim : "transparent", color: po.deliveryMode === v ? C.accent : C.muted }}>{l}</button>
                        ))}
                      </div>
                      {po.deliveryMode === "date" ? (
                        <input type="date" value={po.deliveryDate || ""} onChange={e => updatePendingOrderMeta(po.id, { deliveryDate: e.target.value, leadtimeDays: "" })}
                          style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontFamily: "inherit", fontSize: 12, padding: "3px 6px", width: "100%", boxSizing: "border-box" }} />
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input type="number" min={0} value={po.leadtimeDays || ""} onChange={e => updatePendingOrderMeta(po.id, { leadtimeDays: e.target.value, deliveryDate: "" })} placeholder="Days until delivery"
                            style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontFamily: "inherit", fontSize: 12, padding: "3px 6px" }} />
                          <span style={{ color: C.muted, fontSize: 11 }}>days</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ignore-max exceptions */}
          {!isManualBuild && (mapping.max_on_hand || manualEntry?.fieldMode?.max_on_hand === "manual") && (
            <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
              <button onClick={() => setIgnoreMaxExpanded(v => !v)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{ignoreMaxExpanded ? "▼" : "▶"} Max On Hand Exceptions</span>
                  {(ignoreMax.categories.length > 0 || ignoreMax.products.length > 0) && (
                    <Badge color={C.orange}>{ignoreMax.categories.length + ignoreMax.products.length} excluded</Badge>
                  )}
                </div>
                <span style={{ color: C.muted, fontSize: 11 }}>categories / products that ignore the max cap</span>
              </button>
              {ignoreMaxExpanded && (
                <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                  {hasCategory && (
                    <div>
                      <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>EXCLUDE CATEGORY</label>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <Select value={newIgnoreMaxCat} onChange={e => setNewIgnoreMaxCat(e.target.value)} style={{ flex: 1 }}>
                          <option value="">— select category —</option>
                          {[...new Set(rows.map(r => r.category).filter(Boolean))].sort().filter(c => !ignoreMax.categories.includes(c)).map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </Select>
                        <Btn small variant="ghost" onClick={() => {
                          if (!newIgnoreMaxCat) return;
                          const next = { ...ignoreMax, categories: [...ignoreMax.categories, newIgnoreMaxCat] };
                          saveIgnoreMaxState(next); setNewIgnoreMaxCat(""); recalc(targetLocal);
                        }}>Add</Btn>
                      </div>
                      {ignoreMax.categories.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {ignoreMax.categories.map(c => (
                            <span key={c} style={{ background: C.orange + "22", color: C.orange, border: `1px solid ${C.orange}44`, borderRadius: 6, padding: "3px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                              {c}
                              <button onClick={() => { const next = { ...ignoreMax, categories: ignoreMax.categories.filter(x => x !== c) }; saveIgnoreMaxState(next); recalc(targetLocal); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: C.orange, fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>EXCLUDE PRODUCT</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                      <Input value={newIgnoreMaxProd} onChange={e => setNewIgnoreMaxProd(e.target.value)}
                        placeholder="Product ID" style={{ flex: 1 }} />
                      <Btn small variant="ghost" onClick={() => {
                        const p = newIgnoreMaxProd.trim();
                        if (!p || ignoreMax.products.includes(p)) return;
                        const next = { ...ignoreMax, products: [...ignoreMax.products, p] };
                        saveIgnoreMaxState(next); setNewIgnoreMaxProd(""); recalc(targetLocal);
                      }}>Add</Btn>
                    </div>
                    {ignoreMax.products.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {ignoreMax.products.map(p => (
                          <span key={p} style={{ background: C.orange + "22", color: C.orange, border: `1px solid ${C.orange}44`, borderRadius: 6, padding: "3px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                            {p}
                            <button onClick={() => { const next = { ...ignoreMax, products: ignoreMax.products.filter(x => x !== p) }; saveIgnoreMaxState(next); recalc(targetLocal); }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: C.orange, fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

      {/* usage adjustment panel — hidden for manual builds */}
      {!isManualBuild && <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <button onClick={() => setAdjExpanded(x => !x)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>
            📈 Usage Adjustment
            {(usageAdj.global != null || Object.keys(usageAdj.categories).length > 0 || Object.keys(usageAdj.products).length > 0) && (
              <span style={{ marginLeft: 8, color: C.orange, fontSize: 12 }}>
                ({[
                  usageAdj.global != null ? `${usageAdj.global > 0 ? "+" : ""}${usageAdj.global}% global` : null,
                  Object.keys(usageAdj.categories).length > 0 ? `${Object.keys(usageAdj.categories).length} category` : null,
                  Object.keys(usageAdj.products).length > 0 ? `${Object.keys(usageAdj.products).length} product` : null,
                ].filter(Boolean).join(", ")} override{Object.keys(usageAdj.categories).length + Object.keys(usageAdj.products).length + (usageAdj.global != null ? 1 : 0) > 1 ? "s" : ""})
              </span>
            )}
          </span>
          <span style={{ color: C.muted, fontSize: 12 }}>{adjExpanded ? "▲" : "▼"}</span>
        </button>
        {adjExpanded && (
          <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ color: C.muted, fontSize: 12, margin: "10px 0 0" }}>Adjust daily usage up or down by a % to ramp orders up or down. Product overrides take priority over category, which takes priority over global.</p>

            {/* Global adjustment */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: C.muted, fontSize: 12, fontWeight: 700, minWidth: 100 }}>GLOBAL</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Input type="number" value={newAdjGlobal} onChange={e => setNewAdjGlobal(e.target.value)} placeholder="e.g. 10 or -15" style={{ width: 110 }} />
                <span style={{ color: C.muted, fontSize: 13 }}>%</span>
                <Btn small onClick={() => {
                  const pct = parseFloat(newAdjGlobal);
                  if (isNaN(pct)) return;
                  const next = { ...usageAdj, global: pct };
                  saveAdj(next); recalc(targetLocal, undefined, undefined, undefined, undefined, undefined, next);
                  setNewAdjGlobal("");
                }} disabled={newAdjGlobal === ""}>Apply</Btn>
                {usageAdj.global != null && (
                  <span style={{ color: C.orange, fontWeight: 700, fontSize: 13 }}>Current: {usageAdj.global > 0 ? "+" : ""}{usageAdj.global}%</span>
                )}
                {usageAdj.global != null && (
                  <Btn small variant="ghost" onClick={() => {
                    const next = { ...usageAdj, global: null };
                    saveAdj(next); recalc(targetLocal, undefined, undefined, undefined, undefined, undefined, next);
                  }}>Remove</Btn>
                )}
              </div>
            </div>

            {/* Category adjustment */}
            {hasCategory && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ color: C.muted, fontSize: 12, fontWeight: 700 }}>BY CATEGORY</span>
                <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                  <div>
                    <datalist id="adj-cat-list">{[...new Set(rows.map(r => r.category).filter(Boolean))].sort().map(c => <option key={c} value={c} />)}</datalist>
                    <Input value={newAdjCat} onChange={e => setNewAdjCat(e.target.value)} placeholder="Category name" list="adj-cat-list" style={{ width: 160 }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <Input type="number" value={newAdjCatPct} onChange={e => setNewAdjCatPct(e.target.value)} placeholder="e.g. 20" style={{ width: 90 }} />
                    <span style={{ color: C.muted, fontSize: 13 }}>%</span>
                  </div>
                  <Btn small onClick={() => {
                    const pct = parseFloat(newAdjCatPct);
                    if (!newAdjCat.trim() || isNaN(pct)) return;
                    const next = { ...usageAdj, categories: { ...usageAdj.categories, [newAdjCat.trim()]: pct } };
                    saveAdj(next); recalc(targetLocal, undefined, undefined, undefined, undefined, undefined, next);
                    setNewAdjCat(""); setNewAdjCatPct("");
                  }} disabled={!newAdjCat.trim() || newAdjCatPct === ""}>Add</Btn>
                </div>
                {Object.keys(usageAdj.categories).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {Object.entries(usageAdj.categories).map(([cat, pct]) => (
                      <div key={cat} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: C.card, borderRadius: 8, border: `1px solid ${C.orange}55` }}>
                        <span style={{ color: C.text, fontSize: 12 }}>{cat}</span>
                        <span style={{ color: C.orange, fontWeight: 700, fontSize: 12 }}>{pct > 0 ? "+" : ""}{pct}%</span>
                        <button onClick={() => {
                          const next = { ...usageAdj, categories: { ...usageAdj.categories } };
                          delete next.categories[cat];
                          saveAdj(next); recalc(targetLocal, undefined, undefined, undefined, undefined, undefined, next);
                        }} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Product adjustment */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 12, fontWeight: 700 }}>BY PRODUCT</span>
              <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                <div>
                  <datalist id="adj-prod-list">{[...new Set(rows.map(r => r.product).filter(Boolean))].sort().map(p => <option key={p} value={p} />)}</datalist>
                  <Input value={newAdjProd} onChange={e => setNewAdjProd(e.target.value)} placeholder="Product ID" list="adj-prod-list" style={{ width: 160 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Input type="number" value={newAdjProdPct} onChange={e => setNewAdjProdPct(e.target.value)} placeholder="e.g. -10" style={{ width: 90 }} />
                  <span style={{ color: C.muted, fontSize: 13 }}>%</span>
                </div>
                <Btn small onClick={() => {
                  const pct = parseFloat(newAdjProdPct);
                  if (!newAdjProd.trim() || isNaN(pct)) return;
                  const next = { ...usageAdj, products: { ...usageAdj.products, [newAdjProd.trim()]: pct } };
                  saveAdj(next); recalc(targetLocal, undefined, undefined, undefined, undefined, undefined, next);
                  setNewAdjProd(""); setNewAdjProdPct("");
                }} disabled={!newAdjProd.trim() || newAdjProdPct === ""}>Add</Btn>
              </div>
              {Object.keys(usageAdj.products).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(usageAdj.products).map(([prod, pct]) => (
                    <div key={prod} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: C.card, borderRadius: 8, border: `1px solid ${C.orange}55` }}>
                      <span style={{ color: C.text, fontSize: 12 }}>{prod}</span>
                      <span style={{ color: C.orange, fontWeight: 700, fontSize: 12 }}>{pct > 0 ? "+" : ""}{pct}%</span>
                      <button onClick={() => {
                        const next = { ...usageAdj, products: { ...usageAdj.products } };
                        delete next.products[prod];
                        saveAdj(next); recalc(targetLocal, undefined, undefined, undefined, undefined, undefined, next);
                      }} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>}

      {/* Add Products to Order */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <button onClick={() => setAddProductsExpanded(x => !x)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>
            ➕ Add Products to Order
            {pushedManualItems.length > 0 && (
              <span style={{ marginLeft: 8, color: C.accent, fontSize: 12 }}>({pushedManualItems.length} added)</span>
            )}
          </span>
          <span style={{ color: C.muted, fontSize: 12 }}>{addProductsExpanded ? "▲" : "▼"}</span>
        </button>
        {addProductsExpanded && (
          <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${C.border}` }}>
            <p style={{ color: C.muted, fontSize: 12, margin: "10px 0 12px" }}>
              Add products by product ID and quantity. Products already in the order will have their order quantity overridden.
            </p>
            {/* Top "Add to Order" button — always shown */}
            <div style={{ marginBottom: 12 }}>
              <Btn onClick={handleAddToOrder} disabled={!manualAddList.some(i => i.product.trim() && i.qty !== "")}>
                Add to Order ✓
              </Btn>
            </div>
            {/* Product + qty input rows */}
            <datalist id="manual-add-prod-list">
              {[...new Set(rows.map(r => r.product).filter(Boolean))].sort().map(p => <option key={p} value={p} />)}
            </datalist>
            {/* Location autocomplete from existing rows or manual locations */}
            <datalist id="manual-add-loc-list">
              {[...new Set([...manualLocations, ...rows.map(r => r.location).filter(Boolean)])].sort().map(l => <option key={l} value={l} />)}
            </datalist>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {manualAddList.map((item, idx) => {
                const matchRow = rows.find(r =>
                  !r._isTotal && item.product.trim() !== "" &&
                  String(r.product ?? "").trim().toLowerCase() === item.product.trim().toLowerCase() &&
                  (!item.location.trim() || String(r.location ?? "").trim().toLowerCase() === item.location.trim().toLowerCase())
                );
                const alreadyOnOrder = matchRow && matchRow.order > 0;
                return (
                  <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      value={item.product}
                      onChange={e => setManualAddList(prev => prev.map((it, i) => i === idx ? { ...it, product: e.target.value } : it))}
                      placeholder="Product ID"
                      list="manual-add-prod-list"
                      style={{ flex: 2, minWidth: 130, background: alreadyOnOrder ? C.orange + "22" : C.card, border: `1px solid ${alreadyOnOrder ? C.orange : C.border}`, borderRadius: 6, color: alreadyOnOrder ? C.orange : C.text, fontFamily: "inherit", fontSize: 13, padding: "5px 10px", outline: "none" }}
                    />
                    <input
                      type="text"
                      value={item.location}
                      onChange={e => setManualAddList(prev => prev.map((it, i) => i === idx ? { ...it, location: e.target.value } : it))}
                      placeholder="Location (optional)"
                      list="manual-add-loc-list"
                      style={{ flex: 1, minWidth: 110, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontFamily: "inherit", fontSize: 13, padding: "5px 10px", outline: "none" }}
                    />
                    <input
                      type="number"
                      value={item.qty}
                      onChange={e => setManualAddList(prev => prev.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it))}
                      placeholder="Qty"
                      min={0}
                      style={{ width: 80, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "5px 10px", outline: "none" }}
                    />
                    {manualAddList.length > 1 && (
                      <button onClick={() => setManualAddList(prev => prev.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>✕</button>
                    )}
                    {alreadyOnOrder && (
                      <span style={{ color: C.orange, fontSize: 11, width: "100%", marginTop: -4 }}>On order: {matchRow.order} — new amount will override prefilled order amount</span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Plus button to add another row */}
            <button
              onClick={() => setManualAddList(prev => [...prev, { product: "", qty: "", location: "" }])}
              style={{ marginTop: 10, background: "none", border: `1px dashed ${C.border}`, borderRadius: 6, color: C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: "5px 14px", width: "100%" }}
            >
              + Add another product
            </button>
            {/* Bottom "Add to Order" button — only shown when list has more than 3 items */}
            {manualAddList.length > 3 && (
              <div style={{ marginTop: 12 }}>
                <Btn onClick={handleAddToOrder} disabled={!manualAddList.some(i => i.product.trim() && i.qty !== "")}>
                  Add to Order ✓
                </Btn>
              </div>
            )}
            {/* Summary of already-pushed items */}
            {pushedManualItems.length > 0 && (
              <div style={{ marginTop: 14, padding: "10px 12px", background: C.accent + "18", border: `1px solid ${C.accent}44`, borderRadius: 8 }}>
                <div style={{ color: C.accent, fontWeight: 700, fontSize: 11, marginBottom: 6 }}>ADDED TO ORDER</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {pushedManualItems.map((item, i) => (
                    <span key={i} style={{ background: C.accent + "22", color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 6, padding: "3px 10px", fontSize: 12 }}>
                      {item.product}{item.location ? <span style={{ opacity: 0.7 }}> @ {item.location}</span> : ""} × {item.qty}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* excluded total rows callout */}
      {(() => {
        const excludedTotals = rows.filter(r => r._isTotal && !totalRowsIncluded.has(r._idx));
        if (!excludedTotals.length) return null;
        return (
          <div style={{ background: C.orange + "18", border: `1px solid ${C.orange}55`, borderRadius: 10, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: C.orange, fontWeight: 700, fontSize: 13 }}>
                ⚠ {excludedTotals.length} summary row{excludedTotals.length > 1 ? "s were" : " was"} excluded from the order
              </span>
              <button
                onClick={() => setTotalRowsIncluded(prev => { const s = new Set(prev); excludedTotals.forEach(r => s.add(r._idx)); return s; })}
                style={{ background: C.orange + "33", border: `1px solid ${C.orange}66`, borderRadius: 6, color: C.orange, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "4px 12px", whiteSpace: "nowrap" }}
              >Include All</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {excludedTotals.map(r => (
                <div key={r._idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: C.orange + "0e", borderRadius: 6, padding: "4px 10px" }}>
                  <span style={{ color: C.text, fontSize: 13 }}>
                    <span style={{ color: C.muted, fontSize: 11, marginRight: 8 }}>{r.location || "—"}</span>
                    {r.product}
                  </span>
                  <button
                    onClick={() => setTotalRowsIncluded(prev => { const s = new Set(prev); s.add(r._idx); return s; })}
                    style={{ background: "transparent", border: `1px solid ${C.orange}55`, borderRadius: 6, color: C.orange, fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: "2px 10px", whiteSpace: "nowrap" }}
                  >Include →</button>
                </div>
              ))}
            </div>
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
        <table style={{ borderCollapse: "collapse", fontFamily: "inherit", tableLayout: "fixed", width: displayCols.reduce((s, c) => s + getColWidth(c.key), 0) + 50 }}>
          <colgroup>
            {displayCols.map(col => <col key={col.key} style={{ width: getColWidth(col.key) }} />)}
            <col style={{ width: 50 }} />
          </colgroup>
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            <tr style={{ background: C.card, borderBottom: `1px solid ${C.border}` }}>
              {displayCols.map((col, ci) => {
                const isPinned = pinnedCols.has(col.key);
                const isLastPinned = isPinned && (ci === displayCols.length - 1 || !pinnedCols.has(displayCols[ci + 1].key));
                const leftOff = isPinned ? pinnedLeftOffsets[col.key] : undefined;
                return (
                  <th key={col.key} style={{ padding: "10px 10px 10px 8px", textAlign: "left", position: "sticky", top: 0,
                    ...(isPinned ? { left: leftOff, zIndex: 20, background: C.card, boxShadow: isLastPinned ? `inset 0 -1px 0 ${C.border}, inset -2px 0 0 ${C.accentDim}` : `inset 0 -1px 0 ${C.border}, inset -1px 0 0 ${C.border}` }
                      : { zIndex: 10, background: C.card, boxShadow: `inset 0 -1px 0 ${C.border}` }),
                    borderLeft: dragOver === col.key && dragColRef.current !== col.key ? `2px solid ${C.accent}` : undefined,
                    overflow: "hidden", userSelect: "none" }}
                    onDragOver={e => onDragOver(col.key, e)}
                    onDrop={e => onDrop(col.key, e)}
                    onDragLeave={() => setDragOver(null)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                      <span draggable onDragStart={e => onDragStart(col.key, e)} onDragEnd={onDragEnd}
                        style={{ cursor: "grab", color: C.border, fontSize: 13, flexShrink: 0, lineHeight: 1 }} title="Drag to reorder">⠿</span>
                      {col.noSort
                        ? <span style={{ color: C.muted, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", flex: 1, letterSpacing: 0.5 }}>{col.label.toUpperCase()}</span>
                        : <SortBtn k={col.key} label={col.label} align="left" />}
                      <button onClick={() => togglePin(col.key)} title={isPinned ? "Unpin column" : "Pin to left"}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "0 1px", fontSize: 11, color: isPinned ? C.accent : C.border, flexShrink: 0, lineHeight: 1, opacity: isPinned ? 1 : 0.5 }}>📌</button>
                    </div>
                    <div onMouseDown={e => startResize(col.key, e)}
                      style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 1 }} />
                  </th>
                );
              })}
              <th style={{ padding: "10px 12px", width: 50, position: "sticky", top: 0, zIndex: 10, background: C.card, boxShadow: `inset 0 -1px 0 ${C.border}` }} />
            </tr>
            <tr style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
              {displayCols.map((col, ci) => {
                const isPinned = pinnedCols.has(col.key);
                const isLastPinned = isPinned && (ci === displayCols.length - 1 || !pinnedCols.has(displayCols[ci + 1].key));
                const leftOff = isPinned ? pinnedLeftOffsets[col.key] : undefined;
                return (
                  <th key={col.key} style={{ padding: "4px 8px", position: "sticky", top: 41,
                    ...(isPinned ? { left: leftOff, zIndex: 20, background: C.surface, boxShadow: isLastPinned ? `inset 0 -1px 0 ${C.border}, inset -2px 0 0 ${C.accentDim}` : `inset 0 -1px 0 ${C.border}, inset -1px 0 0 ${C.border}` }
                      : { zIndex: 10, background: C.surface, boxShadow: `inset 0 -1px 0 ${C.border}` }),
                    overflow: "visible" }}>
                    {!col.noFilter && (
                      <ColumnFilter colKey={col.key} rows={rows}
                        textValue={colTextFilters[col.key] || ""}
                        onTextChange={val => setTextFilter(col.key, val)}
                        checkedFilter={colCheckedFilters[col.key] || { mode: "all", values: new Set() }}
                        onCheckedChange={cf => setCheckedFilter(col.key, cf)} />
                    )}
                  </th>
                );
              })}
              <th style={{ position: "sticky", top: 41, zIndex: 10, background: C.surface, boxShadow: `inset 0 -1px 0 ${C.border}` }} />
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr><td colSpan={displayCols.length + 1} style={{ padding: "24px", textAlign: "center", color: C.muted }}>No rows match the current filters.</td></tr>
            ) : displayed.map(r => {
              const edited = r.order !== r.suggested;
              const cellBg = edited ? "#2a2210" : C.bg;
              const numericKeys = new Set(["daily_usage","on_hand","days_on_hand","leadtime","suggested","est_on_hand_after","order","ext_cost"]);
              return (
                <tr key={r._idx} style={{ borderBottom: `1px solid ${C.border}`, background: edited ? C.orange + "08" : "transparent" }}>
                  {displayCols.map((col, ci) => {
                    const isPinned = pinnedCols.has(col.key);
                    const isLastPinned = isPinned && (ci === displayCols.length - 1 || !pinnedCols.has(displayCols[ci + 1].key));
                    const leftOff = isPinned ? pinnedLeftOffsets[col.key] : undefined;
                    return (
                      <td key={col.key} style={{ padding: col.key === "order" ? "5px 8px" : "9px 8px 9px 10px",
                        textAlign: numericKeys.has(col.key) ? "right" : "left",
                        overflow: "hidden",
                        borderRight: `1px solid ${C.border}22`,
                        ...(isPinned ? { position: "sticky", left: leftOff, zIndex: 5, background: cellBg,
                          boxShadow: isLastPinned ? `inset -2px 0 0 ${C.accentDim}` : `inset -1px 0 0 ${C.border}` } : {}) }}>
                        {renderCell(col, r, edited)}
                      </td>
                    );
                  })}
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
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [accountInfo, setAccountInfo] = useState(null);
  const accountInfoFileRef = useRef();
  const [productInfo, setProductInfo] = useState(null);
  const productInfoFileRef = useRef();

  const handleAccountFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (json.length < 2) return;
        const hdrs = json[0].map(h => String(h).trim());
        const acctRows = json.slice(1).filter(r => r.some(c => String(c).trim() !== ""));
        const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, "");
        const locIdx = hdrs.findIndex(h => ["location","loc","store","site","name","storename","locationname"].includes(norm(h)));
        setAccountInfo({ headers: hdrs, rows: acctRows, locationColIdx: locIdx >= 0 ? locIdx : 0, fileName: file.name });
      } catch {}
    };
    reader.readAsArrayBuffer(file);
  };

  const handleProductFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (json.length < 2) return;
        const hdrs = json[0].map(h => String(h).trim());
        const prodRows = json.slice(1).filter(r => r.some(c => String(c).trim() !== ""));
        const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, "");
        // Try to auto-detect internal ID column and vendor ID column
        const intIdx = hdrs.findIndex(h => ["internal","internalid","partno","partnum","internalpart","ourpart","itemno","itemid","sku"].includes(norm(h)));
        const vendIdx = hdrs.findIndex(h => ["vendor","vendorpart","vendoritem","vendorno","vendorid","supplierpart","supplieritem","mfgpart","externalid","externalpart"].includes(norm(h)));
        setProductInfo({ headers: hdrs, rows: prodRows, internalColIdx: intIdx >= 0 ? intIdx : 0, vendorColIdx: vendIdx >= 0 ? vendIdx : (hdrs.length > 1 ? 1 : 0), fileName: file.name });
      } catch {}
    };
    reader.readAsArrayBuffer(file);
  };

  const productLookup = productInfo ? (() => {
    const m = new Map();
    productInfo.rows.forEach(r => {
      const key = String(r[productInfo.internalColIdx] ?? "").trim().toLowerCase();
      if (key) m.set(key, r);
    });
    return m;
  })() : new Map();

  // Normalize location for fuzzy matching: strip leading zeros, lowercase, collapse spaces
  // e.g. "023" === "23", "Store 001" === "store 1"
  const normLoc = (loc) => String(loc ?? "").trim().toLowerCase().replace(/\b0+(\d)/g, "$1").replace(/\s+/g, " ");

  const accountLookup = accountInfo ? (() => {
    const m = new Map();
    accountInfo.rows.forEach(r => {
      const raw = String(r[accountInfo.locationColIdx] ?? "").trim().toLowerCase();
      const norm = normLoc(raw);
      if (raw) m.set(raw, r);       // exact (raw) match first
      if (norm && norm !== raw) m.set(norm, r); // normalized fallback
    });
    return m;
  })() : new Map();

  const resolveCell = (c, r) => {
    if (c.type === "blank") return "";
    if (c.type === "constant") return c.value ?? "";
    if (c.type === "account") {
      const rawLoc = String(r.location ?? "").trim().toLowerCase();
      const normLocVal = normLoc(rawLoc);
      const acctRow = accountLookup.get(rawLoc) ?? accountLookup.get(normLocVal);
      if (!acctRow || !accountInfo) return "";
      const colIdx = accountInfo.headers.indexOf(c.acctCol);
      return colIdx >= 0 ? String(acctRow[colIdx] ?? "") : "";
    }
    if (c.type === "product") {
      const prod = String(r.product ?? "").trim();
      const prodRow = productLookup.get(prod.toLowerCase());
      if (!prodRow || !productInfo) {
        // Fallback when not mapped
        const fb = c.fallback ?? "internal";
        if (fb === "blank") return "";
        if (fb === "manual" && c.fallbackValue) return c.fallbackValue;
        return prod; // "internal" — use original product ID
      }
      const colIdx = productInfo.headers.indexOf(c.prodCol);
      return colIdx >= 0 ? String(prodRow[colIdx] ?? "") : prod;
    }
    return String(r[c.key] ?? "");
  };

  // Editable local rows
  const [localRows, setLocalRows] = useState(() => rows.map(r => ({ ...r })));
  const updateLocalOrder = (idx, val) => setLocalRows(prev => prev.map(r => r._idx === idx ? { ...r, order: val === "" ? "" : Math.max(0, Number(val)) } : r));

  const setColFilter = (id, val) => setColFilters(f => ({ ...f, [id]: val }));
  const clearFilters = () => setColFilters({});
  const activeFilterCount = Object.values(colFilters).filter(v => v).length;

  const toggleSort = (id) => {
    if (previewSortKey === id) setPreviewSortDir(d => -d);
    else { setPreviewSortKey(id); setPreviewSortDir(1); }
  };

  const exportRows = excludeZeros ? localRows.filter(r => (Number(r.order) || 0) > 0) : localRows;

  const filteredRows = exportRows.filter(r =>
    cols.every(c => {
      const fv = (colFilters[c.id] || "").toLowerCase();
      return !fv || String(resolveCell(c, r)).toLowerCase().includes(fv);
    })
  ).sort((a, b) => {
    if (!previewSortKey) return 0;
    const col = cols.find(c => c.id === previewSortKey);
    if (!col || col.type === "blank" || col.type === "constant") return 0;
    const av = (col.type === "account" || col.type === "product") ? resolveCell(col, a) : a[col.key];
    const bv = (col.type === "account" || col.type === "product") ? resolveCell(col, b) : b[col.key];
    return (isNaN(Number(av)) ? String(av ?? "").localeCompare(String(bv ?? "")) : Number(av) - Number(bv)) * previewSortDir;
  });

  const addData = () => { setCols(c => [...c, { id: nextId, type: "data", key: "order", header: "Order Qty" }]); setNextId(n => n + 1); };
  const addBlank = () => { setCols(c => [...c, { id: nextId, type: "blank", header: "Notes" }]); setNextId(n => n + 1); };
  const addConstant = () => { setCols(c => [...c, { id: nextId, type: "constant", value: "", header: "Custom" }]); setNextId(n => n + 1); };
  const addAccount = () => {
    const firstHeader = accountInfo?.headers?.[0] || "";
    setCols(c => [...c, { id: nextId, type: "account", acctCol: firstHeader, header: firstHeader }]);
    setNextId(n => n + 1);
  };
  const addProduct = () => {
    const vendorHeader = productInfo?.headers?.[productInfo.vendorColIdx] || productInfo?.headers?.[0] || "";
    setCols(c => [...c, { id: nextId, type: "product", prodCol: vendorHeader, header: "Vendor Part #" }]);
    setNextId(n => n + 1);
  };
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
    const data = exportRows.map(r => cols.map(c => resolveCell(c, r)));
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ color: C.text, fontSize: 22, fontWeight: 800, margin: 0 }}>Configure Export</h2>
        <p style={{ color: C.muted, marginTop: 4 }}>Build your custom column layout, then download your order file</p>
      </div>

      {/* order summary */}
      <div style={{ background: C.card, borderRadius: 12, padding: "18px 22px", border: `1px solid ${C.accentDim}` }}>
        <p style={{ color: C.muted, fontSize: 12, fontWeight: 700, margin: "0 0 14px" }}>ORDER SUMMARY</p>

        {/* Stat pills row */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {totalCostExport !== null && (
            <div style={{ flex: "1 1 140px", background: C.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${C.green}55` }}>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700 }}>TOTAL ORDER $</div>
              <div style={{ color: C.green, fontWeight: 800, fontSize: 24, marginTop: 4 }}>{fmtCurrency(totalCostExport)}</div>
            </div>
          )}
          <div style={{ flex: "1 1 140px", background: C.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${C.border}` }}>
            <div style={{ color: C.muted, fontSize: 10, fontWeight: 700 }}>PRODUCTS ORDERED</div>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 24, marginTop: 4 }}>{orderedRows.length}</div>
          </div>
          <div style={{ flex: "1 1 140px", background: C.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${C.border}` }}>
            <div style={{ color: C.muted, fontSize: 10, fontWeight: 700 }}>LOCATIONS</div>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 24, marginTop: 4 }}>{locations.length || "—"}</div>
          </div>
          <div style={{ flex: "1 1 140px", background: C.surface, borderRadius: 10, padding: "14px 18px", border: `1px solid ${C.accentDim}` }}>
            <div style={{ color: C.muted, fontSize: 10, fontWeight: 700 }}>TOTAL UNITS</div>
            <div style={{ color: C.accent, fontWeight: 800, fontSize: 24, marginTop: 4 }}>{fmtNum(totalQty, 0)}</div>
          </div>
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

      {/* account info upload */}
      <input ref={accountInfoFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) { handleAccountFile(e.target.files[0]); e.target.value = ""; } }} />
      <div style={{ background: C.card, borderRadius: 12, padding: "16px 20px", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Account Info</span>
          {!accountInfo ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Upload a file to match locations to account numbers, store codes, etc.</span>
              <Btn small variant="ghost" onClick={() => accountInfoFileRef.current?.click()}>Upload Account File</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: C.green, fontSize: 12, fontWeight: 700 }}>✓ {accountInfo.fileName}</span>
              <span style={{ color: C.muted, fontSize: 12 }}>{accountLookup.size} locations matched</span>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: C.muted, fontSize: 11 }}>Location col:</span>
                <Select value={accountInfo.locationColIdx} onChange={e => setAccountInfo(a => ({ ...a, locationColIdx: Number(e.target.value) }))} style={{ fontSize: 11, padding: "3px 6px" }}>
                  {accountInfo.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </Select>
              </div>
              <Btn small variant="danger" onClick={() => { setAccountInfo(null); setCols(c => c.filter(col => col.type !== "account")); }}>Remove</Btn>
            </div>
          )}
        </div>
      </div>

      {/* product info (part number mapping) upload */}
      <input ref={productInfoFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) { handleProductFile(e.target.files[0]); e.target.value = ""; } }} />
      <div style={{ background: C.card, borderRadius: 12, padding: "16px 20px", border: `1px solid ${productInfo ? C.purple + "55" : C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Vendor Part # Mapping</span>
          {!productInfo ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Upload a file to map internal part numbers to vendor part numbers on the export.</span>
              <Btn small variant="ghost" onClick={() => productInfoFileRef.current?.click()} style={{ color: C.purple, borderColor: C.purple + "66" }}>Upload Mapping File</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: C.purple, fontSize: 12, fontWeight: 700 }}>✓ {productInfo.fileName}</span>
              <span style={{ color: C.muted, fontSize: 12 }}>{productLookup.size} products mapped</span>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: C.muted, fontSize: 11 }}>Internal ID col:</span>
                <Select value={productInfo.internalColIdx} onChange={e => setProductInfo(p => ({ ...p, internalColIdx: Number(e.target.value) }))} style={{ fontSize: 11, padding: "3px 6px" }}>
                  {productInfo.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </Select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: C.muted, fontSize: 11 }}>Vendor ID col:</span>
                <Select value={productInfo.vendorColIdx} onChange={e => setProductInfo(p => ({ ...p, vendorColIdx: Number(e.target.value) }))} style={{ fontSize: 11, padding: "3px 6px" }}>
                  {productInfo.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </Select>
              </div>
              <Btn small variant="danger" onClick={() => { setProductInfo(null); setCols(c => c.filter(col => col.type !== "product")); }}>Remove</Btn>
            </div>
          )}
        </div>
      </div>

      {/* column builder */}
      <div style={{ background: C.card, borderRadius: 12, padding: "20px 24px", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ color: C.text, fontWeight: 700 }}>Column Layout</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Btn small variant="ghost" onClick={addData}>+ Data</Btn>
            {accountInfo && <Btn small variant="success" onClick={addAccount}>+ Account</Btn>}
            {productInfo && <Btn small variant="ghost" onClick={addProduct} style={{ color: C.purple, borderColor: C.purple + "66" }}>+ Vendor Part</Btn>}
            <Btn small variant="ghost" onClick={addConstant} style={{ color: C.orange, borderColor: C.orange + "66" }}>+ Constant</Btn>
            <Btn small variant="ghost" onClick={addBlank}>+ Blank</Btn>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cols.map((col, i) => {
            const badgeColor = col.type === "blank" ? C.muted : col.type === "account" ? C.green : col.type === "product" ? C.purple : col.type === "constant" ? C.orange : C.accent;
            const borderColor = col.type === "blank" ? C.border : col.type === "account" ? C.green + "55" : col.type === "product" ? C.purple + "55" : col.type === "constant" ? C.orange + "55" : C.accentDim;
            return (
              <div key={col.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 8, padding: "10px 14px", border: `1px solid ${borderColor}` }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button onClick={() => move(col.id, -1)} disabled={i === 0} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 10, padding: 0 }}>▲</button>
                  <button onClick={() => move(col.id, 1)} disabled={i === cols.length - 1} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 10, padding: 0 }}>▼</button>
                </div>
                <Badge color={badgeColor}>{col.type}</Badge>
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
                  {col.type === "account" && accountInfo && (
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={{ color: C.muted, fontSize: 10, display: "block", marginBottom: 3 }}>ACCOUNT FIELD</label>
                      <Select value={col.acctCol} onChange={(e) => update(col.id, { acctCol: e.target.value, header: e.target.value })} style={{ width: "100%" }}>
                        {accountInfo.headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </Select>
                    </div>
                  )}
                  {col.type === "product" && productInfo && (
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={{ color: C.muted, fontSize: 10, display: "block", marginBottom: 3 }}>VENDOR FIELD</label>
                      <Select value={col.prodCol} onChange={(e) => update(col.id, { prodCol: e.target.value, header: e.target.value })} style={{ width: "100%" }}>
                        {productInfo.headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </Select>
                    </div>
                  )}
                  {col.type === "product" && (
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={{ color: C.muted, fontSize: 10, display: "block", marginBottom: 3 }}>IF NOT MAPPED</label>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {[["internal","Use Internal ID"], ["blank","Leave Blank"], ["manual","Manual Value"]].map(([v, l]) => (
                          <button key={v} onClick={() => update(col.id, { fallback: v })}
                            style={{ padding: "2px 8px", borderRadius: 4, fontFamily: "inherit", fontWeight: 700, fontSize: 10, cursor: "pointer",
                              border: `1px solid ${(col.fallback ?? "internal") === v ? C.purple : C.border}`,
                              background: (col.fallback ?? "internal") === v ? C.purple + "22" : "transparent",
                              color: (col.fallback ?? "internal") === v ? C.purple : C.muted }}>{l}</button>
                        ))}
                      </div>
                      {(col.fallback ?? "internal") === "manual" && (
                        <Input
                          value={col.fallbackValue ?? ""}
                          onChange={e => update(col.id, { fallbackValue: e.target.value })}
                          placeholder="Value for unmapped products"
                          style={{ width: "100%", marginTop: 4 }}
                        />
                      )}
                    </div>
                  )}
                  {col.type === "constant" && (
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={{ color: C.muted, fontSize: 10, display: "block", marginBottom: 3 }}>REPEATING VALUE</label>
                      <Input value={col.value ?? ""} onChange={(e) => update(col.id, { value: e.target.value })} placeholder="Same value for every row" style={{ width: "100%" }} />
                    </div>
                  )}
                </div>
                <Btn small variant="danger" onClick={() => remove(col.id)}>✕</Btn>
              </div>
            );
          })}
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
                      <button onClick={() => (c.type !== "blank" && c.type !== "constant") && toggleSort(c.id)}
                        style={{ background: "none", border: "none", color: C.accent, cursor: (c.type === "blank" || c.type === "constant") ? "default" : "pointer", fontWeight: 700, fontSize: 13, padding: 0, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
                        {c.header || <em style={{ color: C.muted }}>untitled</em>}
                        {(c.type !== "blank" && c.type !== "constant") && <span style={{ color: previewSortKey === c.id ? C.accent : C.border, fontSize: 10 }}>{previewSortKey === c.id ? (previewSortDir > 0 ? "▲" : "▼") : "⇅"}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
                <tr style={{ background: C.surface }}>
                  {cols.map(c => (
                    <th key={c.id} style={{ padding: "4px 8px", borderBottom: `1px solid ${C.border}`, background: C.surface }}>
                      {(c.type === "blank") ? <div style={{ height: 28 }} /> : (
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
                    {cols.map(c => {
                      const val = resolveCell(c, r);
                      return (
                        <td key={c.id} style={{ padding: "7px 12px", color: c.type === "blank" ? C.muted : c.type === "constant" ? C.orange : c.type === "account" ? C.green : C.text, whiteSpace: "nowrap" }}>
                          {c.type === "blank" ? <em style={{ color: C.border }}>—</em> : val || <em style={{ color: C.muted, fontSize: 11 }}>—</em>}
                        </td>
                      );
                    })}
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
  const [buildMode, setBuildMode] = useState("upload"); // "upload" | "manual"
  const [fileData, setFileData] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [targetDays, setTargetDays] = useState(14);
  const [usageConfig, setUsageConfig] = useState(null);
  const [manualEntry, setManualEntry] = useState(null);
  const [orderLimits, setOrderLimits] = useState(null);
  const [finalRows, setFinalRows] = useState(null);
  const [savedPendingOrders, setSavedPendingOrders] = useState([]);
  const [manualBuiltRows, setManualBuiltRows] = useState(null); // rows from ManualBuildStep
  const [manualLocations, setManualLocations] = useState([]); // location list from manual build
  const [snakeOpen, setSnakeOpen] = useState(false);
  useEffect(() => { setSnakeOpen(false); }, [step]);
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

  const [uomMappings, setUomMappings] = useState(() => loadUomMappings());
  const [categoryUomSettings, setCategoryUomSettings] = useState(() => loadCategoryUom());
  const [prefixSuffixRules, setPrefixSuffixRules] = useState(() => loadPrefixSuffixRules());

  const handleMapConfirm = (m, td, uc, me, ol, ms) => {
    setMapping(m); setTargetDays(td); setUsageConfig(uc);
    setManualEntry(me); setOrderLimits(ol);
    setSavedMapState(ms);
    setStep(2);
  };

  const handleUomConfirm = (uomMaps, catUom, psRules) => {
    setUomMappings(uomMaps);
    setCategoryUomSettings(catUom);
    setPrefixSuffixRules(psRules);
    setStep(3);
  };

  const handleManualBuildConfirm = (rows, locs) => {
    setManualBuiltRows(rows);
    setManualLocations(locs);
    setStep(3);
  };

  const handleReviewBack = () => {
    if (buildMode === "manual") setStep(1);
    else setStep(2);
  };

  const [showDataSource, setShowDataSource] = useState(false);
  const [activeConnName, setActiveConnName] = useState(null);

  const handleLoadFromSource = (data, connName) => {
    setShowDataSource(false);
    setActiveConnName(connName);
    setMapping(null); setUsageConfig(null); setManualEntry(null);
    setOrderLimits(null); setFinalRows(null); setSavedMapState(null);
    setSuggestion(findBestSavedMapping(data.headers));
    setFileData(data);
    setStep(1);
  };

  const handleNewOrder = () => {
    setStep(0);
    setBuildMode("upload");
    setFileData(null);
    setMapping(null);
    setUsageConfig(null);
    setManualEntry(null);
    setOrderLimits(null);
    setFinalRows(null);
    setSavedMapState(null);
    setSuggestion(null);
    setManualBuiltRows(null);
    setManualLocations([]);
    setSavedPendingOrders([]);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", color: C.text, paddingBottom: 60 }}>
      {showDataSource && <DataSourcePanel onLoadData={handleLoadFromSource} onClose={() => setShowDataSource(false)} />}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "18px 32px", display: "flex", alignItems: "center", gap: 14, marginBottom: 40 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, #7b5bf7)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📦</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>OrderGen</span>
            <span style={{ color: C.muted, fontSize: 11, fontWeight: 600 }}>{VERSION}</span>
          </div>
          <div style={{ color: C.muted, fontSize: 12 }}>
            Inventory-driven order planning
            {activeConnName && <span style={{ color: C.accent, marginLeft: 8 }}>· {activeConnName}</span>}
          </div>
        </div>
        <button onClick={() => setShowDataSource(true)} style={{ background: activeConnName ? C.accentDim : "transparent", border: `1px solid ${activeConnName ? C.accent : C.border}`, borderRadius: 8, color: activeConnName ? C.accent : C.muted, fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "8px 16px", transition: "all .15s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
          onMouseLeave={e => { if (!activeConnName) { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; } }}>
          ⚡ Data Source
        </button>
        {step > 0 && (
          <button onClick={handleNewOrder} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "8px 16px", transition: "all .15s" }}
            onMouseEnter={e => { e.target.style.borderColor = C.accent; e.target.style.color = C.accent; }}
            onMouseLeave={e => { e.target.style.borderColor = C.border; e.target.style.color = C.muted; }}>
            ↩ Start New Order
          </button>
        )}
      </div>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 24px" }}>
        <StepBar current={step} buildMode={buildMode} onReviewTripleClick={() => setSnakeOpen(v => !v)} />
        {snakeOpen && <SnakeGame onClose={() => setSnakeOpen(false)} />}
        {step === 0 && <UploadStep onData={handleFileUploaded} onManualBuild={() => { setBuildMode("manual"); setStep(1); }} />}
        {step === 1 && buildMode === "manual" && (
          <ManualBuildStep onConfirm={handleManualBuildConfirm} onBack={() => { setBuildMode("upload"); setStep(0); }} />
        )}
        {step === 1 && buildMode === "upload" && fileData && (
          <MapStep
            headers={fileData.headers} rows={fileData.rows} fileName={fileData.fileName}
            initialState={savedMapState}
            suggestion={!savedMapState ? suggestion : null}
            onConfirm={handleMapConfirm}
          />
        )}
        {step === 2 && buildMode === "upload" && fileData && mapping && usageConfig && (
          <UomStep
            rawRows={fileData.rows} headers={fileData.headers} mapping={mapping}
            usageConfig={usageConfig} manualEntry={manualEntry}
            hasCategory={!!mapping.category} hasUom={!!mapping.uom}
            productRules={[]}
            initialUomMappings={uomMappings}
            initialCategoryUomSettings={categoryUomSettings}
            initialPrefixSuffixRules={prefixSuffixRules}
            onBack={() => setStep(1)}
            onConfirm={handleUomConfirm}
          />
        )}
        {step === 3 && (buildMode === "manual" ? manualBuiltRows : (fileData && mapping && usageConfig)) && (
          <ErrorBoundary>
            <ReviewStep
              rawRows={buildMode === "manual" ? [] : fileData.rows}
              headers={buildMode === "manual" ? [] : fileData.headers}
              mapping={buildMode === "manual" ? {} : mapping}
              targetDays={targetDays}
              usageConfig={buildMode === "manual" ? { mode: "direct" } : usageConfig}
              manualEntry={buildMode === "manual" ? null : manualEntry}
              orderLimits={buildMode === "manual" ? null : orderLimits}
              uomMappings={uomMappings} categoryUomSettings={categoryUomSettings} prefixSuffixRules={prefixSuffixRules}
              initialPendingOrders={savedPendingOrders}
              isManualBuild={buildMode === "manual"}
              initialRows={buildMode === "manual" ? manualBuiltRows : null}
              manualLocations={buildMode === "manual" ? manualLocations : []}
              onConfirm={(rows, pos) => { setFinalRows(rows); setSavedPendingOrders(pos || []); setStep(4); }}
              onBack={handleReviewBack} />
          </ErrorBoundary>
        )}
        {step === 4 && finalRows && <ErrorBoundary><ExportStep rows={finalRows} onBack={() => setStep(3)} /></ErrorBoundary>}
      </div>
    </div>
  );
}
