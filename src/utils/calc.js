export function calcOrder(row, targetDays, onHandToOrderFactor = 1, onHandOverride = null) {
  const usage = parseFloat(row.daily_usage);
  const onHand = onHandOverride ?? parseFloat(row.on_hand);
  const lead = parseFloat(row.leadtime);
  if (isNaN(usage) || isNaN(onHand) || isNaN(lead)) return null;
  return Math.ceil(Math.max(0, (usage * (lead + targetDays) - onHand) * onHandToOrderFactor));
}

export function calcDaysOnHand(row) {
  const usage = parseFloat(row.daily_usage);
  const onHand = parseFloat(row.on_hand);
  if (isNaN(usage) || isNaN(onHand) || usage === 0) return null;
  return onHand / usage;
}

export function isTotalRow(row) {
  const val = String(row.product ?? "").trim().toLowerCase().replace(/[:\s*.-]+$/, "").trim();
  if (!val) return false;
  return /^(grand\s+)?(sub[-\s]?)?totals?(\s+(items?|products?|rows?|units?|qty|quantity|amount|value|cost|price))?$/.test(val)
    || val === "order total" || val === "order totals";
}

export function buildPendingIndex(po) {
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

export function autoPendingColMap(headers) {
  const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, "");
  const loc = headers.find(h => ["location","loc","store","site","warehouse"].includes(norm(h))) || "";
  const prod = headers.find(h => ["product","productid","item","itemid","sku","productname","prodid","itemno"].includes(norm(h))) || "";
  const qty = headers.find(h => ["quantity","qty","qtyordered","orderqty","units","ordered","qtyorder"].includes(norm(h))) || "";
  return { location: loc, product: prod, qty };
}

export function detectPrefixSuffixPatterns(productIds, ignoredKeys = new Set()) {
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
export function applyProductRule(rule, suggestedQty, onHand) {
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
export function computeSuggested(row, effectiveOnHand, targetDays, uomConv, orderMode, zeroUsageFill) {
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
export function applyOnHandConstraints(order, row, effectiveOnHand, uomConv, ignoreMax) {
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

export function getUomConversion(row, productRules, categoryUomSettings, uomMappings, prefixSuffixRules = []) {
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

export function getUsageMultiplier(productId, category, adjustments) {
  if (!adjustments) return 1;
  if (adjustments.products?.[productId] != null) return 1 + (adjustments.products[productId] / 100);
  if (category && adjustments.categories?.[category] != null) return 1 + (adjustments.categories[category] / 100);
  if (adjustments.global != null) return 1 + (adjustments.global / 100);
  return 1;
}
