import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { useC } from "../context/theme.jsx";
import { Btn, Input, DraftInput } from "../components/ui.jsx";

const ALL_LOCS = "__all__";

export function ManualBuildStep({ onConfirm, onBack }) {
  const C = useC();

  // ── Locations ────────────────────────────────────────────────────────────────
  const [locations, setLocations] = useState([]);
  const [locEntryMode, setLocEntryMode] = useState("individual"); // "individual" | "csv"
  const [newLocInput, setNewLocInput] = useState("");
  const [csvLocInput, setCsvLocInput] = useState("");
  const locFileRef = useRef();
  const newLocInputRef = useRef();

  const addSingleLoc = () => {
    const loc = newLocInput.trim();
    if (!loc || locations.includes(loc)) { setNewLocInput(""); return; }
    setLocations(prev => [...prev, loc]);
    setNewLocInput("");
    // Keep focus so user can type the next one
    newLocInputRef.current?.focus();
  };

  const addCsvLocs = () => {
    const locs = csvLocInput.split(",").map(l => l.trim()).filter(Boolean);
    if (!locs.length) return;
    setLocations(prev => {
      const combined = [...prev];
      locs.forEach(l => { if (!combined.includes(l)) combined.push(l); });
      return combined;
    });
    setCsvLocInput("");
  };

  const removeLocation = (loc) => {
    setLocations(prev => prev.filter(l => l !== loc));
    // If the removed loc was selected in the entry row, clear it
    if (newLocSingle === loc) setNewLocSingle("");
  };

  const handleLocFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (!json.length) return;
        const hdrs = json[0].map(h => String(h).trim());
        const dataRows = json.slice(1);
        const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, "");
        // Detect location column — same heuristic as account file in ExportStep
        const locIdx = hdrs.findIndex(h =>
          ["location","loc","store","storename","locationname","site","name","account","accountname","accountno","accountnumber"].includes(norm(h))
        );
        const colIdx = locIdx >= 0 ? locIdx : 0;
        const extracted = [...new Set(dataRows.map(r => String(r[colIdx] ?? "").trim()).filter(Boolean))];
        if (!extracted.length) return;
        setLocations(prev => {
          const combined = [...prev];
          extracted.forEach(l => { if (!combined.includes(l)) combined.push(l); });
          return combined;
        });
      } catch {}
    };
    reader.readAsArrayBuffer(file);
  };

  // ── Product reference data (optional) ────────────────────────────────────────
  const refFileRef = useRef();
  const [refData, setRefData] = useState(null);
  const [minDaysSupply, setMinDaysSupply] = useState(7);

  const handleRefFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (json.length < 2) return;
        const hdrs = json[0].map(h => String(h).trim());
        const dataRows = json.slice(1).filter(r => r.some(c => String(c).trim() !== ""));
        const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, "");
        const find = (...keys) => hdrs.findIndex(h => keys.includes(norm(h)));
        const colMap = {
          product:     find("product","item","sku","partno","internalid","itemid","itemno"),
          on_hand:     find("onhand","oh","qtyoh","quantityonhand","invcurrentonhand"),
          daily_usage: find("dailyusage","daily","usage","velocity","avgdailyusage","avgsales"),
          leadtime:    find("leadtime","leaddays","lead","leadtimedays"),
          min_on_hand: find("min","minimum","minonhand","reorderpoint","rop","reorder"),
          max_on_hand: find("max","maximum","maxonhand","targetstock","maxstock"),
          vendor:      find("vendor","supplier","distributor","vendorname","suppliername"),
          cost:        find("cost","price","unitcost","unitprice"),
        };
        const lookup = new Map();
        if (colMap.product >= 0) {
          dataRows.forEach(r => {
            const key = String(r[colMap.product] ?? "").trim().toLowerCase();
            if (key) lookup.set(key, r);
          });
        }
        setRefData({ headers: hdrs, rows: dataRows, colMap, lookup, fileName: file.name });
      } catch {}
    };
    reader.readAsArrayBuffer(file);
  };

  const lookupRef = (product, field) => {
    if (!refData || (refData.colMap[field] ?? -1) < 0) return "";
    const row = refData.lookup.get(String(product ?? "").trim().toLowerCase());
    if (!row) return "";
    return String(row[refData.colMap[field]] ?? "").trim();
  };

  const autoSuggestQty = (prod) => {
    const onHand = parseFloat(lookupRef(prod, "on_hand")) || 0;
    const usage  = parseFloat(lookupRef(prod, "daily_usage")) || 0;
    const lead   = parseFloat(lookupRef(prod, "leadtime")) || 0;
    const maxOH  = parseFloat(lookupRef(prod, "max_on_hand"));
    if (!isNaN(maxOH) && maxOH > 0) return Math.max(0, Math.ceil(maxOH - onHand));
    if (usage > 0) return Math.max(0, Math.ceil(usage * (lead + minDaysSupply) - onHand));
    return 0;
  };

  // ── Product entry (keyboard-flow) ─────────────────────────────────────────────
  const [orderEntries, setOrderEntries] = useState([]);
  const [newProduct, setNewProduct] = useState("");
  const [newQty, setNewQty] = useState("");
  // Single location select — carries forward after each add
  const [newLocSingle, setNewLocSingle] = useState("");

  const productInputRef = useRef();
  const locSelectRef    = useRef();
  const qtyInputRef     = useRef();

  const addProduct = () => {
    const prod = newProduct.trim();
    if (!prod) return;
    const qty = newQty !== "" ? Math.max(0, Number(newQty)) : (refData ? autoSuggestQty(prod) : 0);

    // Expand "All" to every defined location; fall back to empty string (no location)
    let targetLocs;
    if (newLocSingle === ALL_LOCS) {
      targetLocs = locations.length > 0 ? locations : [""];
    } else {
      targetLocs = [newLocSingle];
    }

    setOrderEntries(prev => [
      ...prev,
      ...targetLocs.map(loc => ({ id: `${Date.now()}-${Math.random()}`, product: prod, location: loc, qty })),
    ]);

    setNewProduct("");
    setNewQty("");
    // ← Do NOT reset newLocSingle — carry the selection to the next row
    setTimeout(() => productInputRef.current?.focus(), 10);
  };

  const handleConfirm = () => {
    const rows = orderEntries.map((e, i) => {
      const onHand    = lookupRef(e.product, "on_hand");
      const usage     = lookupRef(e.product, "daily_usage");
      const lead      = lookupRef(e.product, "leadtime");
      const minOH     = lookupRef(e.product, "min_on_hand");
      const maxOH     = lookupRef(e.product, "max_on_hand");
      const vendor    = lookupRef(e.product, "vendor");
      const cost      = lookupRef(e.product, "cost");
      const usageNum  = parseFloat(usage);
      const onHandNum = parseFloat(onHand);
      return {
        _idx: i, product: e.product, location: e.location, order: e.qty,
        daily_usage: usage, on_hand: onHand, leadtime: lead,
        category: vendor || "", cost, uom: "",
        min_on_hand: minOH, max_on_hand: maxOH,
        suggested: e.qty,
        days_on_hand: (!isNaN(usageNum) && usageNum > 0 && !isNaN(onHandNum)) ? onHandNum / usageNum : null,
        est_on_hand_after: !isNaN(onHandNum) ? onHandNum + e.qty : null,
        appliedRule: null,
        uomConv: { onHandToOrderFactor: 1, orderToOnHandFactor: 1, isPack: false, packSize: 1, hasConversion: false },
        _isTotal: false, _rawUsage: usage, _minConstrained: false, _maxConstrained: false,
        on_hand_uom: "", order_uom: "", units_ordered: null, _manuallyBuilt: true,
        vendor, _minDaysSupply: minDaysSupply,
      };
    });
    onConfirm(rows, locations);
  };

  const existingProducts = [...new Set(orderEntries.map(e => e.product))].sort();

  // ── Shared styles ─────────────────────────────────────────────────────────────
  const selectStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.text, fontFamily: "inherit", fontSize: 13, padding: "6px 10px",
    outline: "none", cursor: "pointer", width: "100%",
  };
  const modeBtn = (label, active, onClick) => (
    <button onClick={onClick} style={{
      padding: "4px 12px", borderRadius: 5, fontFamily: "inherit", fontWeight: 700,
      fontSize: 11, cursor: "pointer",
      border: `1px solid ${active ? C.accent : C.border}`,
      background: active ? C.accentDim : "transparent",
      color: active ? C.accent : C.muted,
    }}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: C.text, fontSize: 22, fontWeight: 800, margin: 0 }}>Build Order Manually</h2>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>Add locations, then enter products and quantities</p>
        </div>
        <Btn variant="ghost" onClick={onBack}>← Back</Btn>
      </div>

      {/* ── Step 1 — Locations ──────────────────────────────────────────────── */}
      <input ref={locFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) { handleLocFile(e.target.files[0]); e.target.value = ""; } }} />

      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>📍 Step 1 — Locations</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              onClick={() => locFileRef.current?.click()}
              title="Upload a CSV or Excel file with a locations column"
              style={{ padding: "4px 10px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer", border: `1px solid ${C.border}`, background: "transparent", color: C.muted, whiteSpace: "nowrap" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}>
              📂 Upload Location File
            </button>
            {modeBtn("Individual", locEntryMode === "individual", () => setLocEntryMode("individual"))}
            {modeBtn("Comma-separated", locEntryMode === "csv", () => setLocEntryMode("csv"))}
          </div>
        </div>

        {locEntryMode === "individual" ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              ref={newLocInputRef}
              value={newLocInput}
              onChange={e => setNewLocInput(e.target.value)}
              placeholder="Type a location name, press Enter to add…"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSingleLoc(); } }}
              style={{ ...selectStyle, flex: 1, cursor: "text" }}
            />
            <Btn small onClick={addSingleLoc} disabled={!newLocInput.trim()}>Add</Btn>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
            <input
              value={csvLocInput}
              onChange={e => setCsvLocInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCsvLocs(); } }}
              placeholder="Store 1, Store 2, Warehouse A, …  — comma-separated, then Enter"
              style={{ ...selectStyle, flex: 1, cursor: "text" }}
            />
            <Btn small onClick={addCsvLocs} disabled={!csvLocInput.trim()}>Add All</Btn>
          </div>
        )}

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
          <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
            No locations added yet — products will be entered as general order items (no location split).
            You can also upload a location file or your account info file from the Export step.
          </p>
        )}
      </div>

      {/* ── Product reference (optional) ────────────────────────────────────── */}
      <input ref={refFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) { handleRefFile(e.target.files[0]); e.target.value = ""; } }} />
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${refData ? C.accent + "66" : C.border}`, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>📋 Product Reference</span>
            <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>optional — enables auto-suggested quantities</span>
          </div>
          {!refData ? (
            <Btn small variant="ghost" onClick={() => refFileRef.current?.click()}>Upload Reference File</Btn>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: C.green, fontSize: 12, fontWeight: 700 }}>✓ {refData.fileName}</span>
              <span style={{ color: C.muted, fontSize: 12 }}>{refData.rows.length} products</span>
              <span style={{ color: C.muted, fontSize: 12 }}>
                {["on_hand","daily_usage","leadtime","min_on_hand","max_on_hand","vendor"]
                  .filter(f => (refData.colMap[f] ?? -1) >= 0)
                  .map(f => ({ on_hand:"On Hand", daily_usage:"Usage", leadtime:"Lead Time", min_on_hand:"Min", max_on_hand:"Max", vendor:"Vendor" })[f])
                  .join(" · ")}
              </span>
              <Btn small variant="danger" onClick={() => setRefData(null)}>Remove</Btn>
            </div>
          )}
        </div>
        {refData && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>Min days of supply target:</span>
              <input type="number" min={1} max={365} value={minDaysSupply} onChange={e => setMinDaysSupply(Math.max(1, Number(e.target.value)))}
                style={{ width: 64, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "4px 8px", outline: "none", textAlign: "center" }} />
              <span style={{ color: C.muted, fontSize: 12 }}>days</span>
            </div>
            <span style={{ color: C.muted, fontSize: 11 }}>Used when no qty is entered — auto-suggests order amounts per product</span>
          </div>
        )}
        {!refData && (
          <p style={{ color: C.muted, fontSize: 11, marginTop: 10, margin: "10px 0 0" }}>
            Upload a file with columns like <em>Product, On Hand, Daily Usage, Lead Time, Min, Max, Vendor</em> — headers are detected automatically.
          </p>
        )}
      </div>

      {/* ── Step 2 — Add Products ────────────────────────────────────────────── */}
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px 20px" }}>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 6 }}>📦 Step 2 — Add Products</div>
        <p style={{ color: C.muted, fontSize: 11, margin: "0 0 14px" }}>
          Tab between fields · Enter on Qty to add and jump back to Product
        </p>
        <datalist id="mbs-prod-list">{existingProducts.map(p => <option key={p} value={p} />)}</datalist>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          {/* Product */}
          <div style={{ flex: "2 1 150px" }}>
            <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>PRODUCT ID</div>
            <input
              ref={productInputRef}
              value={newProduct}
              onChange={e => setNewProduct(e.target.value)}
              placeholder="Product / Item #"
              list="mbs-prod-list"
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); addProduct(); }
              }}
              style={{ ...selectStyle, cursor: "text" }}
            />
          </div>

          {/* Location — native <select> for keyboard tab/enter flow */}
          {locations.length > 0 && (
            <div style={{ flex: "2 1 160px" }}>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>LOCATION</div>
              <select
                ref={locSelectRef}
                value={newLocSingle}
                onChange={e => setNewLocSingle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); qtyInputRef.current?.focus(); }
                }}
                style={{ ...selectStyle, color: newLocSingle ? C.text : C.muted }}>
                <option value="">— no specific location —</option>
                <option value={ALL_LOCS}>All Locations ({locations.length})</option>
                <optgroup label="──────────────────">
                  {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                </optgroup>
              </select>
            </div>
          )}

          {/* Qty */}
          <div style={{ flex: "0 0 80px" }}>
            <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>QTY</div>
            <input
              ref={qtyInputRef}
              type="number"
              min={0}
              value={newQty}
              onChange={e => setNewQty(e.target.value)}
              placeholder="0"
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); addProduct(); }
              }}
              style={{ ...selectStyle, width: "100%", cursor: "text" }}
            />
          </div>

          <Btn onClick={addProduct} disabled={!newProduct.trim()}>+ Add</Btn>
        </div>

        {/* Context hints below the entry row */}
        <div style={{ marginTop: 8, minHeight: 18 }}>
          {newLocSingle === ALL_LOCS && locations.length > 0 && (
            <p style={{ color: C.accent, fontSize: 11, margin: 0 }}>
              Will create <strong>{locations.length}</strong> rows — one per location — with qty {newQty || 0} each
            </p>
          )}
          {locations.length > 0 && !newLocSingle && (
            <p style={{ color: C.muted, fontSize: 11, margin: 0 }}>No location selected — added as a general item</p>
          )}
          {refData && newProduct.trim() && newQty === "" && (() => {
            const suggested = autoSuggestQty(newProduct.trim());
            const usage = lookupRef(newProduct.trim(), "daily_usage");
            const maxOH = lookupRef(newProduct.trim(), "max_on_hand");
            if (!refData.lookup.has(newProduct.trim().toLowerCase()))
              return <p style={{ color: C.muted, fontSize: 11, margin: 0 }}>Product not found in reference — enter qty manually</p>;
            return (
              <p style={{ color: C.accent, fontSize: 11, margin: 0 }}>
                Auto-suggest: <strong>{suggested}</strong> units
                {!isNaN(parseFloat(maxOH)) ? ` (fill to max ${maxOH})` : usage ? ` (${minDaysSupply}d supply + lead time)` : ""}
              </p>
            );
          })()}
        </div>
      </div>

      {/* ── Step 3 — Order list ──────────────────────────────────────────────── */}
      {orderEntries.length > 0 && (
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>
              Order Items <span style={{ color: C.muted, fontSize: 12, fontWeight: 400 }}>({orderEntries.length} row{orderEntries.length !== 1 ? "s" : ""})</span>
            </span>
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
                    <td style={{ padding: "6px 20px", color: C.muted, fontSize: 12, textAlign: "center" }}>
                      {e.location || <span style={{ fontStyle: "italic" }}>—</span>}
                    </td>
                    <td style={{ padding: "6px 20px", textAlign: "center" }}>
                      <DraftInput value={e.qty}
                        onCommit={v => setOrderEntries(prev => prev.map(x => x.id === e.id ? { ...x, qty: Number(v) } : x))}
                        style={{ width: 70, textAlign: "center", background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, color: C.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "2px 6px", outline: "none" }} />
                    </td>
                    <td style={{ padding: "6px 12px", textAlign: "center" }}>
                      <button onClick={() => setOrderEntries(prev => prev.filter(x => x.id !== e.id))}
                        style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {orderEntries.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn onClick={handleConfirm}>Review Order →</Btn>
        </div>
      )}
    </div>
  );
}
