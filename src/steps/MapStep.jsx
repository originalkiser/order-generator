import { useState } from "react";
import { REQUIRED_CORE, MANUAL_ENTRY_FIELDS, FIELD_LABELS } from "../constants.js";
import { useC } from "../context/theme.jsx";
import { Btn, Input, Select, Badge, DataPreview } from "../components/ui.jsx";
import { saveMappingToStorage } from "../utils/storage.js";
import { HintCard } from "../components/HintCard.jsx";

export function MapStep({ headers, rows, fileName, onConfirm, initialState, suggestion }) {
  const C = useC();
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
      <HintCard id="map-columns" title="Match your columns">
        Tell OrderGen which column in your file represents each field.
        <strong> Location</strong>, <strong>Product</strong>, <strong>On Hand</strong>, and <strong>Lead Time</strong> are required.
        If your file has a <em>Daily Usage</em> column, map it — otherwise you can enter a manual usage rate on the next screen.
      </HintCard>
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
              <div style={{ color: C.muted, fontSize: 12 }}>Formula: <span style={{ color: C.purple, fontWeight: 700 }}>[{salesCol}] ÷ {salesDays}</span> = daily usage per row</div>)}
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
