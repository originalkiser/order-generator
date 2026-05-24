import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { C } from "../constants.js";
import { Btn, Input, DraftInput } from "../components/ui.jsx";
import { LocationMultiSelect } from "../components/LocationMultiSelect.jsx";

export function ManualBuildStep({ onConfirm, onBack }) {
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

  // ── product reference data (optional) ─────────────────────────────────────
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

  const addProduct = () => {
    const prod = newProduct.trim();
    if (!prod) return;
    const qty = newQty !== "" ? Math.max(0, Number(newQty)) : (refData ? autoSuggestQty(prod) : 0);
    const targetLocs = newLocs.size > 0 ? [...newLocs] : [""];
    setOrderEntries(prev => [...prev, ...targetLocs.map(loc => ({ id: `${Date.now()}-${Math.random()}`, product: prod, location: loc, qty }))]);
    setNewProduct(""); setNewQty(""); setNewLocs(new Set());
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

      {/* 1.5 — Optional product reference (min/max/usage/leadtime) */}
      <input ref={refFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) { handleRefFile(e.target.files[0]); e.target.value = ""; } }} />
      <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${refData ? C.accent + "66" : C.border}`, padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>📋 Product Reference</span>
            <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>optional — enables auto-suggested quantities, efficiency scoring</span>
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
        {refData && newProduct.trim() && newQty === "" && (() => {
          const suggested = autoSuggestQty(newProduct.trim());
          const usage = lookupRef(newProduct.trim(), "daily_usage");
          const lead = lookupRef(newProduct.trim(), "leadtime");
          const maxOH = lookupRef(newProduct.trim(), "max_on_hand");
          if (!refData.lookup.has(newProduct.trim().toLowerCase())) return <p style={{ color: C.muted, fontSize: 11, margin: "6px 0 0" }}>Product not found in reference — enter qty manually</p>;
          return (
            <p style={{ color: C.accent, fontSize: 11, margin: "6px 0 0" }}>
              Auto-suggest: <strong>{suggested}</strong> units
              {!isNaN(parseFloat(maxOH)) ? ` (fill to max ${maxOH})` : usage ? ` (${minDaysSupply}d supply + ${lead || 0}d lead)` : ""}
            </p>
          );
        })()}
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
