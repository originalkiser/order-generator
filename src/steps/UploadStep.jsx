import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { useC } from "../context/theme.jsx";
import { Btn, DataPreview } from "../components/ui.jsx";
import { HintCard } from "../components/HintCard.jsx";

// ── Built-in demo dataset ─────────────────────────────────────────────────────
const DEMO_HEADERS = ["Location", "Product", "Category", "On Hand", "Daily Usage", "Lead Time (days)", "Cost"];
const DEMO_ROWS = [
  ["Store 001", "ITEM-A101", "Cleaning",    48,    4.2,  7,  12.50],
  ["Store 001", "ITEM-B205", "Hardware",     6,    1.5, 14,  89.99],
  ["Store 001", "ITEM-C012", "Electrical", 120,    2.8,  3,   4.25],
  ["Store 001", "ITEM-D340", "Plumbing",     0,    0.9, 10,  34.00],
  ["Store 001", "ITEM-E099", "Safety",      32,    3.6,  5,   8.75],
  ["Store 001", "ITEM-F777", "Cleaning",    15,    5.1,  7,   6.99],
  ["Store 001", "ITEM-G288", "Hardware",     3,    0.7, 21, 125.00],
  ["Store 002", "ITEM-A101", "Cleaning",    22,    3.8,  7,  12.50],
  ["Store 002", "ITEM-B205", "Hardware",    18,    2.1, 14,  89.99],
  ["Store 002", "ITEM-C012", "Electrical",  45,    1.9,  3,   4.25],
  ["Store 002", "ITEM-D340", "Plumbing",    14,    1.2, 10,  34.00],
  ["Store 002", "ITEM-E099", "Safety",       0,    2.2,  5,   8.75],
  ["Store 002", "ITEM-H411", "Plumbing",    24,    1.1, 10,  18.50],
  ["Store 002", "ITEM-I520", "Electrical",  60,    3.3,  7,  22.75],
  ["Warehouse",  "ITEM-A101", "Cleaning",  350,   28.5,  7,  11.00],
  ["Warehouse",  "ITEM-B205", "Hardware",   42,    8.2, 14,  82.00],
  ["Warehouse",  "ITEM-C012", "Electrical",680,   18.6,  3,   3.90],
  ["Warehouse",  "ITEM-D340", "Plumbing",  110,    5.4, 10,  31.00],
  ["Warehouse",  "ITEM-E099", "Safety",     95,    4.4,  5,   8.00],
  ["Warehouse",  "ITEM-J630", "Safety",      0,    6.8,  5,  15.25],
];
const DEMO_FILE = { fileName: "demo_inventory.csv", headers: DEMO_HEADERS, rows: DEMO_ROWS, skippedRows: 0 };

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

export function UploadStep({ onData, onManualBuild }) {
  const C = useC();
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
      <HintCard id="upload-intro" title="Welcome to OrderGen">
        Upload your inventory spreadsheet (.xlsx or .csv) and OrderGen will suggest reorder quantities based on your stock levels and daily usage.
        No file on hand? Hit <strong>Try with demo data</strong> below to walk through the full workflow instantly.
      </HintCard>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ color: C.text, fontSize: 26, fontWeight: 800, margin: 0 }}>Upload Your Inventory File</h2>
        <p style={{ color: C.muted, marginTop: 8 }}>Accepts .xlsx, .xls, or .csv — we'll read the first sheet</p>
      </div>
      {!preview ? (
        <div style={{ maxWidth: 520, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Drop zone */}
          <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => inputRef.current.click()}
            style={{ border: `2px dashed ${dragging ? C.accent : C.border}`, borderRadius: 16, padding: "48px 32px", textAlign: "center", cursor: "pointer", background: dragging ? C.accent + "0a" : C.card, transition: "all .2s" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
            <p style={{ color: C.text, fontWeight: 700, margin: 0 }}>Drag & drop your spreadsheet here</p>
            <p style={{ color: C.muted, marginTop: 8, marginBottom: 20 }}>or click to browse</p>
            <Btn variant="ghost" onClick={(e) => { e.stopPropagation(); inputRef.current.click(); }}>Browse Files</Btn>
          </div>
          {/* Demo data option */}
          <button onClick={() => setPreview(DEMO_FILE)}
            style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 24px", cursor: "pointer", fontFamily: "inherit", textAlign: "center", transition: "all .2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = C.accent + "0a"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.surface; }}>
            <span style={{ fontSize: 22 }}>🎯</span>
            <div style={{ textAlign: "left" }}>
              <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>Try with demo data</div>
              <div style={{ color: C.muted, fontSize: 12 }}>20 products · 3 locations · categories, usage & cost — no file needed</div>
            </div>
          </button>
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
