import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { C } from "../constants.js";
import { fmtNum, fmtUsage, fmtCurrency } from "../utils/format.js";
import { trimVal, loadProductRules, saveProductRules, loadIgnoreMax, saveIgnoreMax, loadUsageAdjustments, saveUsageAdjustments, loadTablePrefs, saveTablePrefs } from "../utils/storage.js";
import { calcOrder, calcDaysOnHand, applyProductRule, computeSuggested, applyOnHandConstraints, getUomConversion, getUsageMultiplier, isTotalRow, buildPendingIndex, autoPendingColMap, detectPrefixSuffixPatterns } from "../utils/calc.js";
import { Btn, DraftInput, Badge, Input, Select, OrderCalloutCard } from "../components/ui.jsx";
import { ColumnFilter } from "../components/ColumnFilter.jsx";

export function ReviewStep({ rawRows, headers, mapping, targetDays, usageConfig, manualEntry, orderLimits, uomMappings, categoryUomSettings, prefixSuffixRules, onConfirm, onBack, initialPendingOrders = [], isManualBuild = false, initialRows = null, manualLocations = [] }) {
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
  const [effMinDays, setEffMinDays] = useState(() => targetDays || 7);
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

      {/* ── Efficiency & Days-of-Supply Panel ────────────────────────────────── */}
      {(() => {
        const usageRows = rows.filter(r => !r._isTotal && parseFloat(r.daily_usage) > 0);
        if (usageRows.length === 0) return null;
        const effData = usageRows.map(r => {
          const usage   = parseFloat(r.daily_usage);
          const lead    = parseFloat(r.leadtime) || 0;
          const onHand  = parseFloat(r.on_hand) || 0;
          const order   = Number(r.order) || 0;
          const maxOH   = parseFloat(r.max_on_hand);
          const recommended = !isNaN(maxOH) && maxOH > 0
            ? Math.max(0, maxOH - onHand)
            : Math.max(0, usage * (lead + effMinDays) - onHand);
          const orderDays = usage > 0 ? order / usage : 0;
          const eff = recommended <= 0 ? (order > 0 ? 50 : 100)
            : order <= 0 ? 0
            : Math.min(100, Math.round(Math.min(order, recommended) / recommended * 100));
          return { recommended, orderDays, eff };
        });
        const avgDays = effData.reduce((s, d) => s + d.orderDays, 0) / effData.length;
        const avgEff  = Math.round(effData.reduce((s, d) => s + d.eff, 0) / effData.length);
        const effColor = avgEff >= 85 ? C.green : avgEff >= 60 ? C.orange : C.red;
        const totalRec = usageRows.reduce((s, r, i) => s + effData[i].recommended, 0);
        const totalOrd = usageRows.reduce((s, r) => s + (Number(r.order) || 0), 0);
        const leadBasedDays = (() => {
          const leaded = usageRows.filter(r => parseFloat(r.leadtime) > 0);
          if (!leaded.length) return null;
          return Math.round(leaded.reduce((s, r) => s + parseFloat(r.leadtime), 0) / leaded.length + effMinDays);
        })();
        return (
          <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${effColor}44`, padding: "16px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
              <div>
                <span style={{ color: C.text, fontWeight: 800, fontSize: 14 }}>📊 Order Efficiency</span>
                <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>{usageRows.length} product{usageRows.length !== 1 ? "s" : ""} with usage data</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: C.muted, fontSize: 12 }}>Target days:</span>
                <input type="number" min={1} max={365} value={effMinDays} onChange={e => setEffMinDays(Math.max(1, Number(e.target.value)))}
                  style={{ width: 56, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "3px 7px", outline: "none", textAlign: "center" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {/* Efficiency % */}
              <div style={{ flex: "1 1 130px", background: C.surface, borderRadius: 10, padding: "12px 16px", border: `1px solid ${effColor}66` }}>
                <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>ORDER EFFICIENCY</div>
                <div style={{ color: effColor, fontWeight: 800, fontSize: 28 }}>{avgEff}%</div>
                <div style={{ marginTop: 6, height: 5, background: C.border, borderRadius: 3 }}>
                  <div style={{ width: `${avgEff}%`, height: "100%", background: effColor, borderRadius: 3, transition: "width .3s" }} />
                </div>
                <div style={{ color: C.muted, fontSize: 10, marginTop: 5 }}>
                  {avgEff >= 85 ? "Optimal" : avgEff >= 60 ? "Acceptable — consider adjusting qty" : "Under-supplied — review quantities"}
                </div>
              </div>
              {/* Avg days covered */}
              <div style={{ flex: "1 1 130px", background: C.surface, borderRadius: 10, padding: "12px 16px", border: `1px solid ${C.border}` }}>
                <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>AVG DAYS COVERED</div>
                <div style={{ color: C.accent, fontWeight: 800, fontSize: 28 }}>{avgDays.toFixed(1)}</div>
                <div style={{ color: C.muted, fontSize: 10, marginTop: 5 }}>days of supply per product</div>
              </div>
              {/* Recommended total */}
              <div style={{ flex: "1 1 130px", background: C.surface, borderRadius: 10, padding: "12px 16px", border: `1px solid ${C.border}` }}>
                <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>CURRENT vs RECOMMENDED</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ color: C.text, fontWeight: 800, fontSize: 22 }}>{Math.round(totalOrd).toLocaleString()}</span>
                  <span style={{ color: C.muted, fontSize: 11 }}>/ {Math.round(totalRec).toLocaleString()} rec.</span>
                </div>
                <div style={{ color: C.muted, fontSize: 10, marginTop: 5 }}>total units · based on {effMinDays}d target</div>
              </div>
              {/* Lead-time recommendation */}
              {leadBasedDays && (
                <div style={{ flex: "1 1 130px", background: C.surface, borderRadius: 10, padding: "12px 16px", border: `1px solid ${C.purple}44` }}>
                  <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 4 }}>LEAD-TIME OPTIMAL</div>
                  <div style={{ color: C.purple, fontWeight: 800, fontSize: 22 }}>{leadBasedDays}d</div>
                  <div style={{ color: C.muted, fontSize: 10, marginTop: 5 }}>recommended coverage based on avg lead time + {effMinDays}d buffer</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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
