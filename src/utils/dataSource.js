import * as XLSX from "xlsx";

// ── Data Source utilities ─────────────────────────────────────────────────────
export async function fetchDataSource(conn) {
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

export function applyConnectionFilters(data, filters) {
  if (!filters || filters.length === 0) return data;
  const active = filters.filter(f => f.values && f.values.length > 0);
  if (active.length === 0) return data;
  const colIdxs = active.map(f => ({ idx: data.headers.indexOf(f.column), vals: new Set(f.values) }));
  return { ...data, rows: data.rows.filter(row => colIdxs.every(({ idx, vals }) => idx < 0 || vals.has(String(row[idx] ?? "")))) };
}

export function buildFetchUrl(conn) {
  const params = (conn.queryParams || []).filter(p => p.key.trim());
  if (!params.length) return conn.url;
  const base = conn.url.includes("?") ? conn.url : conn.url;
  const sep = conn.url.includes("?") ? "&" : "?";
  return base + sep + params.map(p => `${encodeURIComponent(p.key.trim())}=${encodeURIComponent(p.value)}`).join("&");
}

// Parses a curl command and returns partial connection fields
export function parseCurl(cmd) {
  const result = { url: "", queryParams: [], authType: "none", authHeader: "X-API-Key", authValue: "" };
  // Strip line continuations and normalise
  const flat = cmd.replace(/\\\s*\n/g, " ").replace(/\s+/g, " ").trim();

  // Extract URL — first bare https?:// or value after -X METHOD
  const urlMatch = flat.match(/['"]?(https?:\/\/[^\s'"]+)['"]?/);
  if (urlMatch) {
    try {
      const parsed = new URL(urlMatch[1]);
      parsed.searchParams.forEach((v, k) => result.queryParams.push({ key: k, value: v }));
      parsed.search = "";
      result.url = parsed.toString();
    } catch { result.url = urlMatch[1].split("?")[0]; }
  }

  // Extract headers
  const headerRe = /-H\s+['"]([^'"]+)['"]/g;
  let hm;
  while ((hm = headerRe.exec(flat)) !== null) {
    const [name, ...rest] = hm[1].split(":");
    const value = rest.join(":").trim();
    const nameLower = name.trim().toLowerCase();
    if (nameLower === "authorization") {
      if (value.toLowerCase().startsWith("bearer ")) {
        result.authType = "bearer";
        result.authValue = value.slice(7).trim();
      } else if (value.toLowerCase().startsWith("basic ")) {
        result.authType = "bearer"; // treat basic as bearer fallback
        result.authValue = value.slice(6).trim();
      }
    } else if (nameLower === "x-api-key" || nameLower.includes("api-key") || nameLower.includes("apikey")) {
      result.authType = "apikey";
      result.authHeader = name.trim();
      result.authValue = value;
    }
  }
  return result;
}

export function newConnection() {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: "", url: "", queryParams: [], authType: "none", authHeader: "X-API-Key", authValue: "", dataFormat: "auto", jsonPath: "", refreshPolicy: "manual", lastFetched: null, lastFetchOk: false, filters: [] };
}
