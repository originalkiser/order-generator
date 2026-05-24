import { useState } from "react";
import { useC } from "../context/theme.jsx";
import { Btn, Input } from "../components/ui.jsx";
import { trimVal, saveUomMappings, saveCategoryUom, savePrefixSuffixRules } from "../utils/storage.js";
import { getUomConversion, detectPrefixSuffixPatterns } from "../utils/calc.js";

export function UomStep({ rawRows, headers, mapping, usageConfig, manualEntry, hasCategory, hasUom, productRules, initialUomMappings, initialCategoryUomSettings, initialPrefixSuffixRules, onBack, onConfirm }) {
  const C = useC();
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
