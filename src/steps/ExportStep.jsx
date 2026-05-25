import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { STOCK_COLS } from "../constants.js";
import { useC } from "../context/theme.jsx";
import { fmtNum, fmtCurrency } from "../utils/format.js";
import { Btn, Badge, Input, Select } from "../components/ui.jsx";
import { ColumnFilter } from "../components/ColumnFilter.jsx";
import { HintCard } from "../components/HintCard.jsx";

export function ExportStep({ rows, onBack }) {
  const C = useC();
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
  // Export template upload
  const templateFileRef = useRef();
  const [templateName, setTemplateName] = useState(null);
  // Vendor grouping
  const [vendorGrouping, setVendorGrouping] = useState("none"); // "none" | "sheets" | "files"
  const [vendorColSource, setVendorColSource] = useState("product"); // "product" | "account" | "data"
  const [vendorColName, setVendorColName] = useState("");
  const [vendorLayouts, setVendorLayouts] = useState({}); // { vendorName: cols[] } overrides
  const [expandedVendorLayout, setExpandedVendorLayout] = useState(null);

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

  const handleTemplateFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (!json.length) return;
        const hdrs = json[0].map(h => String(h).trim()).filter(Boolean);
        if (!hdrs.length) return;
        const normH = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        let id = nextId;
        const newCols = hdrs.map(h => {
          const match = STOCK_COLS.find(s => normH(s.label) === normH(h) || normH(s.key) === normH(h));
          return match
            ? { id: id++, type: "data", key: match.key, header: h }
            : { id: id++, type: "blank", header: h };
        });
        setCols(newCols);
        setNextId(id);
        setTemplateName(file.name);
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
    if (c.type === "date") {
      const d = new Date();
      if (c.dateFormat === "iso") return d.toISOString().slice(0, 10);
      if (c.dateFormat === "us") return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
      return d.toLocaleDateString();
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
    if (!col || col.type === "blank" || col.type === "constant" || col.type === "date") return 0;
    const av = (col.type === "account" || col.type === "product") ? resolveCell(col, a) : a[col.key];
    const bv = (col.type === "account" || col.type === "product") ? resolveCell(col, b) : b[col.key];
    return (isNaN(Number(av)) ? String(av ?? "").localeCompare(String(bv ?? "")) : Number(av) - Number(bv)) * previewSortDir;
  });

  const addData = () => { setCols(c => [...c, { id: nextId, type: "data", key: "order", header: "Order Qty" }]); setNextId(n => n + 1); };
  const addBlank = () => { setCols(c => [...c, { id: nextId, type: "blank", header: "Notes" }]); setNextId(n => n + 1); };
  const addConstant = () => { setCols(c => [...c, { id: nextId, type: "constant", value: "", header: "Custom" }]); setNextId(n => n + 1); };
  const addDate = () => { setCols(c => [...c, { id: nextId, type: "date", header: "Order Date", dateFormat: "local" }]); setNextId(n => n + 1); };
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

  // ── Vendor grouping helpers ────────────────────────────────────────────────
  const getVendorForRow = (row) => {
    if (vendorColSource === "data") return String(row.vendor || row.category || "Unknown");
    if (vendorColSource === "product" && productInfo && vendorColName) {
      const prodRow = productLookup.get(String(row.product ?? "").trim().toLowerCase());
      if (!prodRow) return "Unknown";
      const idx = productInfo.headers.indexOf(vendorColName);
      return idx >= 0 && String(prodRow[idx] ?? "").trim() ? String(prodRow[idx]).trim() : "Unknown";
    }
    if (vendorColSource === "account" && accountInfo && vendorColName) {
      const rawLoc = String(row.location ?? "").trim().toLowerCase();
      const acctRow = accountLookup.get(rawLoc) ?? accountLookup.get(normLoc(rawLoc));
      if (!acctRow) return "Unknown";
      const idx = accountInfo.headers.indexOf(vendorColName);
      return idx >= 0 && String(acctRow[idx] ?? "").trim() ? String(acctRow[idx]).trim() : "Unknown";
    }
    return "Unknown";
  };

  const doGroupedExport = () => {
    const safeSheet = (name) => String(name).replace(/[:\\\/\?\*\[\]]/g, "_").slice(0, 31) || "Vendor";
    const vendors = [...new Set(exportRows.map(r => getVendorForRow(r)))].filter(Boolean).sort();
    if (vendorGrouping === "sheets") {
      const wb = XLSX.utils.book_new();
      vendors.forEach(vendor => {
        const vRows = exportRows.filter(r => getVendorForRow(r) === vendor);
        const vCols = vendorLayouts[vendor] || cols;
        const data = [vCols.map(c => c.header || ""), ...vRows.map(r => vCols.map(c => resolveCell(c, r)))];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), safeSheet(vendor));
      });
      XLSX.writeFile(wb, `${fileName || "order"}_by_vendor.xlsx`);
    } else if (vendorGrouping === "files") {
      vendors.forEach(vendor => {
        const vRows = exportRows.filter(r => getVendorForRow(r) === vendor);
        const vCols = vendorLayouts[vendor] || cols;
        const data = [vCols.map(c => c.header || ""), ...vRows.map(r => vCols.map(c => resolveCell(c, r)))];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), sheetName || "Order");
        XLSX.writeFile(wb, `${fileName || "order"}_${String(vendor).replace(/[^a-z0-9]/gi, "_")}.xlsx`);
      });
    }
  };

  const doExport = () => {
    if (vendorGrouping !== "none") { doGroupedExport(); return; }
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
      <HintCard id="export-intro" title="Customise your export" icon="📤">
        Use the <strong>Column Layout</strong> section to pick exactly which fields appear in your downloaded file — and in what order.
        You can also upload an <strong>Account Info</strong> file to pull in store addresses or account numbers, and a <strong>Vendor Part # Mapping</strong>
        file to translate your internal IDs to vendor item numbers automatically.
      </HintCard>

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

      {/* ── Vendor grouping ──────────────────────────────────────────────────── */}
      <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${vendorGrouping !== "none" ? C.purple + "66" : C.border}`, padding: "18px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>🗂 Group Export by Vendor</span>
            <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>split the export into separate sheets or files per vendor</span>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            {[["none","Single File"], ["sheets","Sheet per Vendor"], ["files","File per Vendor"]].map(([v, l]) => (
              <button key={v} onClick={() => setVendorGrouping(v)} style={{
                padding: "5px 12px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                border: `1px solid ${vendorGrouping === v ? C.purple : C.border}`,
                background: vendorGrouping === v ? C.purpleDim : "transparent",
                color: vendorGrouping === v ? C.purple : C.muted,
              }}>{l}</button>
            ))}
          </div>
        </div>
        {vendorGrouping !== "none" && (
          <>
            {/* vendor column picker */}
            <div style={{ background: C.surface, borderRadius: 8, padding: "12px 14px", marginBottom: 12, border: `1px solid ${C.border}` }}>
              <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 8 }}>VENDOR COLUMN SOURCE</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 5 }}>
                  {[
                    ["product", "Product Info", !productInfo],
                    ["account", "Account Info", !accountInfo],
                    ["data",    "Row Data",     false],
                  ].map(([src, lbl, disabled]) => (
                    <button key={src} onClick={() => !disabled && setVendorColSource(src)} disabled={disabled} style={{
                      padding: "4px 10px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11,
                      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
                      border: `1px solid ${vendorColSource === src ? C.purple : C.border}`,
                      background: vendorColSource === src ? C.purpleDim : "transparent",
                      color: vendorColSource === src ? C.purple : C.muted,
                    }}>{lbl}</button>
                  ))}
                </div>
                {vendorColSource === "product" && productInfo && (
                  <select value={vendorColName} onChange={e => setVendorColName(e.target.value)}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "inherit", fontSize: 12, padding: "4px 8px" }}>
                    <option value="">— pick column —</option>
                    {productInfo.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                )}
                {vendorColSource === "account" && accountInfo && (
                  <select value={vendorColName} onChange={e => setVendorColName(e.target.value)}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "inherit", fontSize: 12, padding: "4px 8px" }}>
                    <option value="">— pick column —</option>
                    {accountInfo.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                )}
                {vendorColSource === "data" && (
                  <span style={{ color: C.muted, fontSize: 11 }}>Uses the <em>vendor</em> / <em>category</em> field from your inventory data</span>
                )}
              </div>
            </div>

            {/* per-vendor layout overrides */}
            {(() => {
              const vendors = [...new Set(exportRows.map(r => getVendorForRow(r)))].filter(Boolean).sort();
              if (!vendors.length) return <p style={{ color: C.muted, fontSize: 12 }}>No vendors detected yet — configure vendor column above.</p>;
              return (
                <div>
                  <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 8px" }}>
                    {vendors.length} VENDOR{vendors.length !== 1 ? "S" : ""} · configure a custom column layout per vendor (optional — defaults to global layout)
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {vendors.map(vendor => {
                      const customCols = vendorLayouts[vendor];
                      const isExpanded = expandedVendorLayout === vendor;
                      return (
                        <div key={vendor} style={{ background: C.surface, borderRadius: 8, border: `1px solid ${customCols ? C.purple + "66" : C.border}`, overflow: "hidden" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px" }}>
                            <span style={{ fontWeight: 700, fontSize: 13, color: C.text, flex: 1 }}>{vendor}</span>
                            <span style={{ color: customCols ? C.purple : C.muted, fontSize: 11 }}>
                              {customCols ? `Custom: ${customCols.length} col${customCols.length !== 1 ? "s" : ""}` : "Global layout"}
                            </span>
                            <button onClick={() => setExpandedVendorLayout(isExpanded ? null : vendor)}
                              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, cursor: "pointer", fontSize: 11, padding: "3px 8px", fontFamily: "inherit" }}>
                              {isExpanded ? "▲ Close" : "📝 Customize"}
                            </button>
                            {customCols && (
                              <button onClick={() => setVendorLayouts(l => { const n = { ...l }; delete n[vendor]; return n; })}
                                style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}>Reset</button>
                            )}
                          </div>
                          {isExpanded && (
                            <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px" }}>
                              <p style={{ color: C.muted, fontSize: 11, margin: "0 0 8px" }}>Toggle columns and rename headers for <strong style={{ color: C.purple }}>{vendor}</strong>. Order is inherited from global layout.</p>
                              {cols.map(c => {
                                const vCols = vendorLayouts[vendor] || cols.map(x => ({ ...x }));
                                const included = vCols.some(vc => vc.id === c.id);
                                const vcol = vCols.find(vc => vc.id === c.id);
                                return (
                                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                                    <input type="checkbox" checked={included}
                                      onChange={() => {
                                        const base = vendorLayouts[vendor] || cols.map(x => ({ ...x }));
                                        const next = included ? base.filter(vc => vc.id !== c.id) : [...base, { ...c }];
                                        setVendorLayouts(l => ({ ...l, [vendor]: next }));
                                      }}
                                      style={{ accentColor: C.purple, width: 14, height: 14 }} />
                                    <span style={{ color: C.muted, fontSize: 11, width: 80 }}>{c.header || c.type}</span>
                                    {included && (
                                      <input value={vcol?.header ?? c.header} onChange={e => {
                                        const base = vendorLayouts[vendor] || cols.map(x => ({ ...x }));
                                        setVendorLayouts(l => ({ ...l, [vendor]: base.map(vc => vc.id === c.id ? { ...vc, header: e.target.value } : vc) }));
                                      }}
                                        placeholder="Column header"
                                        style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontFamily: "inherit", fontSize: 12, padding: "3px 8px", outline: "none" }} />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </>
        )}
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

      {/* export template upload — hidden input */}
      <input ref={templateFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) { handleTemplateFile(e.target.files[0]); e.target.value = ""; } }} />

      {/* column builder */}
      <div style={{ background: C.card, borderRadius: 12, padding: "20px 24px", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
          <div>
            <span style={{ color: C.text, fontWeight: 700 }}>Column Layout</span>
            {templateName && (
              <span style={{ color: C.green, fontSize: 11, fontWeight: 700, marginLeft: 10 }}>
                ✓ from {templateName}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={() => templateFileRef.current?.click()}
              title="Upload a previous order or any file with headers to auto-populate columns"
              style={{ padding: "4px 10px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer", border: `1px solid ${C.border}`, background: "transparent", color: C.muted, whiteSpace: "nowrap" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}>
              📋 Load from Template
            </button>
            <Btn small variant="ghost" onClick={addData}>+ Data</Btn>
            {accountInfo && <Btn small variant="success" onClick={addAccount}>+ Account</Btn>}
            {productInfo && <Btn small variant="ghost" onClick={addProduct} style={{ color: C.purple, borderColor: C.purple + "66" }}>+ Vendor Part</Btn>}
            <Btn small variant="ghost" onClick={addDate} style={{ color: "#06b6d4", borderColor: "#06b6d455" }}>+ Date</Btn>
            <Btn small variant="ghost" onClick={addConstant} style={{ color: C.orange, borderColor: C.orange + "66" }}>+ Constant</Btn>
            <Btn small variant="ghost" onClick={addBlank}>+ Blank</Btn>
          </div>
        </div>
        <HintCard id="export-columns" title="Building your column layout">
          Each column maps to a data field, account/vendor info, a static value, today's date, or a blank spacer.
          <strong> Load from Template</strong> reads the headers from a previous order file and auto-matches them — unrecognized columns become blank spacers you can reassign.
        </HintCard>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cols.map((col, i) => {
            const badgeColor = col.type === "blank" ? C.muted : col.type === "account" ? C.green : col.type === "product" ? C.purple : col.type === "constant" ? C.orange : col.type === "date" ? "#06b6d4" : C.accent;
            const borderColor = col.type === "blank" ? C.border : col.type === "account" ? C.green + "55" : col.type === "product" ? C.purple + "55" : col.type === "constant" ? C.orange + "55" : col.type === "date" ? "#06b6d433" : C.accentDim;
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
                  {col.type === "date" && (
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <label style={{ color: C.muted, fontSize: 10, display: "block", marginBottom: 3 }}>DATE FORMAT</label>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                        {[["local", "Local"], ["us", "MM/DD/YYYY"], ["iso", "YYYY-MM-DD"]].map(([fmt, lbl]) => (
                          <button key={fmt} onClick={() => update(col.id, { dateFormat: fmt })}
                            style={{ padding: "2px 8px", borderRadius: 4, fontFamily: "inherit", fontWeight: 700, fontSize: 10, cursor: "pointer",
                              border: `1px solid ${(col.dateFormat ?? "local") === fmt ? "#06b6d4" : C.border}`,
                              background: (col.dateFormat ?? "local") === fmt ? "#06b6d422" : "transparent",
                              color: (col.dateFormat ?? "local") === fmt ? "#06b6d4" : C.muted }}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                      <span style={{ color: C.muted, fontSize: 10 }}>Preview: {resolveCell(col, {})}</span>
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
                      <button onClick={() => (c.type !== "blank" && c.type !== "constant" && c.type !== "date") && toggleSort(c.id)}
                        style={{ background: "none", border: "none", color: C.accent, cursor: (c.type === "blank" || c.type === "constant" || c.type === "date") ? "default" : "pointer", fontWeight: 700, fontSize: 13, padding: 0, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
                        {c.header || <em style={{ color: C.muted }}>untitled</em>}
                        {(c.type !== "blank" && c.type !== "constant" && c.type !== "date") && <span style={{ color: previewSortKey === c.id ? C.accent : C.border, fontSize: 10 }}>{previewSortKey === c.id ? (previewSortDir > 0 ? "▲" : "▼") : "⇅"}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
                <tr style={{ background: C.surface }}>
                  {cols.map(c => (
                    <th key={c.id} style={{ padding: "4px 8px", borderBottom: `1px solid ${C.border}`, background: C.surface }}>
                      {(c.type === "blank" || c.type === "date") ? <div style={{ height: 28 }} /> : (
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
                        <td key={c.id} style={{ padding: "7px 12px", color: c.type === "blank" ? C.muted : c.type === "constant" ? C.orange : c.type === "account" ? C.green : c.type === "date" ? "#06b6d4" : C.text, whiteSpace: "nowrap" }}>
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
        <Btn variant="success" onClick={doExport} disabled={cols.length === 0}>
          {vendorGrouping === "sheets" ? `⬇ Download ${fileName || "order"}_by_vendor.xlsx`
          : vendorGrouping === "files" ? `⬇ Download ${[...new Set(exportRows.map(r => getVendorForRow(r)))].filter(Boolean).length} Vendor File${[...new Set(exportRows.map(r => getVendorForRow(r)))].filter(Boolean).length !== 1 ? "s" : ""}`
          : `⬇ Download ${fileName || "order"}.${exportFormat}`}
        </Btn>
      </div>
    </div>
  );
}
