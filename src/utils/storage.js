// ── localStorage mapping memory ───────────────────────────────────────────────
export const LS_KEY = "ordergen_mappings_v1";

export function loadSavedMappings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}

export function saveMappingToStorage(headers, mapState) {
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
export const LS_RULES_KEY = "ordergen_product_rules_v1";

export function loadProductRules() {
  try { return JSON.parse(localStorage.getItem(LS_RULES_KEY) || "[]"); } catch { return []; }
}

export function saveProductRules(rules) {
  try { localStorage.setItem(LS_RULES_KEY, JSON.stringify(rules)); } catch {}
}

export const LS_UOM_KEY = "ordergen_uom_v1";
export const LS_CATEGORY_UOM_KEY = "ordergen_category_uom_v1";

export function loadUomMappings() {
  try { return JSON.parse(localStorage.getItem(LS_UOM_KEY) || "[]"); } catch { return []; }
}
export function saveUomMappings(m) {
  try { localStorage.setItem(LS_UOM_KEY, JSON.stringify(m)); } catch {}
}
export function loadCategoryUom() {
  try { return JSON.parse(localStorage.getItem(LS_CATEGORY_UOM_KEY) || "{}"); } catch { return {}; }
}
export function saveCategoryUom(s) {
  try { localStorage.setItem(LS_CATEGORY_UOM_KEY, JSON.stringify(s)); } catch {}
}

export const LS_PS_KEY = "ordergen_prefix_suffix_v1";
export function loadPrefixSuffixRules() {
  try { return JSON.parse(localStorage.getItem(LS_PS_KEY) || "[]"); } catch { return []; }
}
export function savePrefixSuffixRules(r) {
  try { localStorage.setItem(LS_PS_KEY, JSON.stringify(r)); } catch {}
}

export const LS_CONNECTIONS_KEY = "ordergen_connections_v1";
export function loadConnections() {
  try { return JSON.parse(localStorage.getItem(LS_CONNECTIONS_KEY) || "[]"); } catch { return []; }
}
export function saveConnections(conns) {
  try { localStorage.setItem(LS_CONNECTIONS_KEY, JSON.stringify(conns)); } catch {}
}

export const LS_IGNORE_MAX_KEY = "ordergen_ignore_max_v1";
export function loadIgnoreMax() {
  try { return JSON.parse(localStorage.getItem(LS_IGNORE_MAX_KEY) || "null") || { categories: [], products: [] }; } catch { return { categories: [], products: [] }; }
}
export function saveIgnoreMax(v) {
  try { localStorage.setItem(LS_IGNORE_MAX_KEY, JSON.stringify(v)); } catch {}
}

export const LS_USAGE_ADJ_KEY = "ordergen_usage_adj_v1";
export function loadUsageAdjustments() {
  try { return JSON.parse(localStorage.getItem(LS_USAGE_ADJ_KEY) || "null") || { global: null, categories: {}, products: {} }; } catch { return { global: null, categories: {}, products: {} }; }
}
export function saveUsageAdjustments(a) {
  try { localStorage.setItem(LS_USAGE_ADJ_KEY, JSON.stringify(a)); } catch {}
}

export const LS_TABLE_PREFS_KEY = "ordergen_table_prefs_v1";
export function loadTablePrefs() {
  try { return JSON.parse(localStorage.getItem(LS_TABLE_PREFS_KEY) || "{}"); } catch { return {}; }
}
export function saveTablePrefs(p) {
  try { localStorage.setItem(LS_TABLE_PREFS_KEY, JSON.stringify(p)); } catch {}
}

// ── helpers ──────────────────────────────────────────────────────────────────
export const trimVal = (v) => typeof v === "string" ? v.trim() : v;

// Score a saved mapping against current headers: count matching column values
export function scoreSavedMapping(saved, currentHeaders) {
  const headerSet = new Set(currentHeaders);
  const m = saved.mapState.mapping || {};
  let matches = 0;
  Object.values(m).forEach(v => { if (v && headerSet.has(v)) matches++; });
  if (saved.mapState.usageMode === "calculated" && headerSet.has(saved.mapState.salesCol)) matches++;
  return matches;
}

// Find best matching saved mapping for current headers (needs ≥2 column matches)
export function findBestSavedMapping(headers) {
  const saved = loadSavedMappings();
  if (!saved.length) return null;
  const scored = saved.map(s => ({ s, score: scoreSavedMapping(s, headers) }))
                       .filter(x => x.score >= 2)
                       .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].s : null;
}

// ── Session (survives refresh, cleared on new order) ──────────────────────────
const SS_SESSION_KEY = "ordergen_session_v1";

export function saveSession(blob) {
  try { sessionStorage.setItem(SS_SESSION_KEY, JSON.stringify(blob)); } catch {}
}
export function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SS_SESSION_KEY) || "null"); } catch { return null; }
}
export function clearSession() {
  try { sessionStorage.removeItem(SS_SESSION_KEY); } catch {}
}
