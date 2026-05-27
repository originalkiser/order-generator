import { useState } from "react";
import * as XLSX from "xlsx";
import { useC } from "../context/theme.jsx";
import { Btn, Input, Select, DataPreview, Badge } from "../components/ui.jsx";
import { buildFetchUrl, fetchDataSource, applyConnectionFilters, parseCurl, newConnection, computeSig } from "../utils/dataSource.js";
import { loadConnections, saveConnections } from "../utils/storage.js";

// ── Data Source Panel ─────────────────────────────────────────────────────────
export function DataSourcePanel({ onLoadData, onClose }) {
  const C = useC();
  const [connections, setConnections] = useState(() => loadConnections());
  const [view, setView] = useState("list"); // "list" | "edit"
  const [editConn, setEditConn] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchedData, setFetchedData] = useState(null);
  const [fetchError, setFetchError] = useState("");
  const [filters, setFilters] = useState([]);
  const [newFilterCol, setNewFilterCol] = useState("");
  const [curlInput, setCurlInput] = useState("");
  const [curlOpen, setCurlOpen] = useState(false);

  const saveConns = (c) => { setConnections(c); saveConnections(c); };

  const openNew = () => {
    const c = newConnection();
    setEditConn(c);
    setFetchedData(null);
    setFetchError("");
    setFilters([]);
    setNewFilterCol("");
    setView("edit");
  };

  const openEdit = (conn) => {
    setEditConn({ ...conn });
    setFetchedData(null);
    setFetchError("");
    setFilters(conn.filters || []);
    setNewFilterCol("");
    setView("edit");
  };

  const setField = (k, v) => setEditConn(c => ({ ...c, [k]: v }));

  const handleFetch = async () => {
    if (!editConn.url) return;
    setFetching(true); setFetchError(""); setFetchedData(null);
    try {
      const data = await fetchDataSource(editConn);
      setFetchedData(data);
    } catch (e) {
      setFetchError(e.message || "Fetch failed");
    } finally {
      setFetching(false);
    }
  };

  const handleSave = () => {
    const conn = { ...editConn, filters, lastFetched: fetchedData ? Date.now() : editConn.lastFetched, lastFetchOk: fetchedData ? true : editConn.lastFetchOk };
    const existing = connections.find(c => c.id === conn.id);
    const next = existing ? connections.map(c => c.id === conn.id ? conn : c) : [...connections, conn];
    saveConns(next);
    setView("list");
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete connection "${editConn.name || "Untitled"}"?`)) return;
    saveConns(connections.filter(c => c.id !== editConn.id));
    setView("list");
  };

  const handleLoad = (conn, data) => {
    const toLoad = data || fetchedData;
    if (!toLoad) return;
    const filtered = applyConnectionFilters(toLoad, filters);
    onLoadData({ headers: filtered.headers, rows: filtered.rows, fileName: conn.name || conn.url }, conn.name || "Data Source");
  };

  const handleQuickLoad = async (conn) => {
    setFetching(true);
    try {
      const data = await fetchDataSource(conn);
      const filtered = applyConnectionFilters(data, conn.filters || []);
      // Update lastFetched
      const next = connections.map(c => c.id === conn.id ? { ...c, lastFetched: Date.now(), lastFetchOk: true } : c);
      saveConns(next);
      onLoadData({ headers: filtered.headers, rows: filtered.rows, fileName: conn.name || conn.url }, conn.name);
    } catch (e) {
      alert(`Failed to load "${conn.name}": ${e.message}`);
    } finally {
      setFetching(false);
    }
  };

  // Filter helpers
  const addFilter = () => {
    if (!newFilterCol || filters.find(f => f.column === newFilterCol)) return;
    setFilters(f => [...f, { column: newFilterCol, values: [] }]);
    setNewFilterCol("");
  };
  const removeFilter = (col) => setFilters(f => f.filter(x => x.column !== col));
  const toggleFilterValue = (col, val) => setFilters(f => f.map(x => x.column !== col ? x : {
    ...x, values: x.values.includes(val) ? x.values.filter(v => v !== val) : [...x.values, val]
  }));
  const selectAllFilter = (col) => {
    if (!fetchedData) return;
    const idx = fetchedData.headers.indexOf(col);
    if (idx < 0) return;
    setFilters(f => f.map(x => x.column !== col ? x : { ...x, values: [] })); // empty = "all"
  };

  const filteredCount = fetchedData ? applyConnectionFilters(fetchedData, filters).rows.length : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: Math.min(620, window.innerWidth), height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Panel header */}
        <div style={{ padding: "18px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          {view === "edit" && (
            <button onClick={() => setView("list")} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>←</button>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>
              {view === "list" ? "Data Sources" : (editConn?.id && connections.find(c => c.id === editConn.id) ? "Edit Connection" : "New Connection")}
            </div>
            <div style={{ color: C.muted, fontSize: 11 }}>Connect to APIs, spreadsheet URLs, or JSON endpoints</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>

          {/* LIST VIEW */}
          {view === "list" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Btn small variant="ghost" onClick={openNew} style={{ alignSelf: "flex-start" }}>+ New Connection</Btn>
              {connections.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: C.muted, fontSize: 13 }}>
                  No connections yet. Add one to pull data from a URL or API.
                </div>
              )}
              {connections.map(conn => (
                <div key={conn.id} style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${conn.lastFetchOk ? C.green + "44" : C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, color: C.text, fontSize: 14, flex: 1 }}>{conn.name || "Untitled Connection"}</span>
                    {conn.lastFetchOk && <Badge color={C.green}>✓ connected</Badge>}
                    {conn.refreshPolicy === "on_open" && <Badge color={C.purple}>auto</Badge>}
                  </div>
                  <div style={{ color: C.muted, fontSize: 11, marginBottom: 10, wordBreak: "break-all" }}>{conn.url || "No URL set"}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {conn.lastFetched && <span style={{ color: C.muted, fontSize: 11 }}>Last fetched: {new Date(conn.lastFetched).toLocaleString()}</span>}
                    <div style={{ flex: 1 }} />
                    <Btn small variant="ghost" onClick={() => openEdit(conn)}>Edit</Btn>
                    <Btn small variant="success" disabled={!conn.url || fetching} onClick={() => handleQuickLoad(conn)}>
                      {fetching ? "Loading…" : "Load →"}
                    </Btn>
                  </div>
                </div>
              ))}

              {/* Info box */}
              <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}`, marginTop: 8 }}>
                <p style={{ color: C.muted, fontSize: 11, margin: "0 0 6px", fontWeight: 700 }}>SUPPORTED SOURCES</p>
                <ul style={{ color: C.muted, fontSize: 11, margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                  <li><strong style={{ color: C.text }}>Spreadsheet URL</strong> — Google Sheets (published CSV), SharePoint, Dropbox, OneDrive direct links</li>
                  <li><strong style={{ color: C.text }}>REST API</strong> — any JSON endpoint returning an array or nested array, with optional Bearer / API key auth</li>
                  <li><strong style={{ color: C.text }}>Power Query</strong> — publish your query to SharePoint or export to a URL-accessible file</li>
                </ul>
                <p style={{ color: C.muted, fontSize: 10, margin: "8px 0 0" }}>Note: the server must allow browser requests (CORS). SQL and direct database connections require a local desktop app (planned).</p>
              </div>
            </div>
          )}

          {/* EDIT VIEW */}
          {view === "edit" && editConn && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* cURL importer */}
              <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <button onClick={() => setCurlOpen(v => !v)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", padding: "11px 14px", cursor: "pointer", color: C.text, fontFamily: "inherit" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, background: C.surface, color: C.accent, padding: "2px 7px", borderRadius: 4, border: `1px solid ${C.border}` }}>curl</span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>Import from cURL</span>
                    <span style={{ color: C.muted, fontSize: 11 }}>Paste a cURL command from API docs to auto-fill this form</span>
                  </span>
                  <span style={{ color: C.muted, fontSize: 12 }}>{curlOpen ? "▲" : "▼"}</span>
                </button>
                {curlOpen && (
                  <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                      value={curlInput}
                      onChange={e => setCurlInput(e.target.value)}
                      placeholder={`curl -X GET "https://api.example.com/v1/inventory?location=WH1" \\\n  -H "Authorization: Bearer YOUR_TOKEN"`}
                      rows={5}
                      style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "monospace", fontSize: 11, padding: "8px 10px", resize: "vertical", outline: "none", lineHeight: 1.6 }}
                    />
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Btn small onClick={() => {
                        const parsed = parseCurl(curlInput);
                        setEditConn(prev => ({ ...prev, url: parsed.url || prev.url, queryParams: parsed.queryParams.length ? parsed.queryParams : prev.queryParams, authType: parsed.authType !== "none" ? parsed.authType : prev.authType, authHeader: parsed.authHeader || prev.authHeader, authValue: parsed.authValue || prev.authValue }));
                        setCurlOpen(false); setCurlInput("");
                      }} disabled={!curlInput.trim()}>Apply</Btn>
                      <span style={{ color: C.muted, fontSize: 11 }}>Fills URL, query params, and auth — review before fetching</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Name */}
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>CONNECTION NAME</label>
                <Input value={editConn.name} onChange={e => setField("name", e.target.value)} placeholder="e.g. ERP Inventory Export" style={{ width: "100%" }} />
              </div>

              {/* URL + Method */}
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>BASE URL</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {["GET","POST","PUT"].map(m => (
                    <button key={m} onClick={() => setField("method", m)} style={{
                      padding: "6px 12px", borderRadius: 6, fontFamily: "monospace", fontWeight: 700, fontSize: 12, cursor: "pointer", flexShrink: 0,
                      border: `1px solid ${(editConn.method || "GET") === m ? C.accent : C.border}`,
                      background: (editConn.method || "GET") === m ? C.accentDim : "transparent",
                      color: (editConn.method || "GET") === m ? C.accent : C.muted,
                    }}>{m}</button>
                  ))}
                  <Input value={editConn.url} onChange={e => setField("url", e.target.value)} placeholder="https://..." style={{ flex: 1 }} />
                </div>
                <p style={{ color: C.muted, fontSize: 11, margin: "5px 0 0" }}>Paste the endpoint URL without query parameters. Add query params or body params below.</p>
              </div>

              {/* Query Parameters */}
              <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 10 }}>QUERY PARAMETERS</label>
                {(editConn.queryParams || []).map((p, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <Input value={p.key} onChange={e => setField("queryParams", editConn.queryParams.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                      placeholder="parameter name" style={{ width: "100%" }} />
                    <Input value={p.value} onChange={e => setField("queryParams", editConn.queryParams.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                      placeholder="value" style={{ width: "100%" }} />
                    <button onClick={() => setField("queryParams", editConn.queryParams.filter((_, j) => j !== i))}
                      style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "6px 10px" }}>×</button>
                  </div>
                ))}
                <Btn small variant="ghost" onClick={() => setField("queryParams", [...(editConn.queryParams || []), { key: "", value: "" }])}>+ Add Parameter</Btn>
                {editConn.url && (editConn.queryParams || []).some(p => p.key.trim()) && (
                  <div style={{ marginTop: 10, padding: "8px 10px", background: C.surface, borderRadius: 6, border: `1px solid ${C.border}` }}>
                    <p style={{ color: C.muted, fontSize: 10, fontWeight: 700, margin: "0 0 3px" }}>FULL REQUEST URL</p>
                    <p style={{ color: C.accent, fontSize: 11, margin: 0, wordBreak: "break-all", fontFamily: "monospace" }}>{buildFetchUrl(editConn)}</p>
                  </div>
                )}
              </div>

              {/* Body Parameters */}
              <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <label style={{ color: C.muted, fontSize: 11, fontWeight: 700 }}>BODY PARAMETERS <span style={{ color: C.muted, fontWeight: 400 }}>({editConn.method || "GET"} request body)</span></label>
                  {editConn.authType === "signed" && (
                    <span style={{ color: C.purple, fontSize: 10, fontWeight: 700 }}>sig auto-injected</span>
                  )}
                </div>

                {(editConn.bodyParams || []).map((p, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <Input value={p.key} onChange={e => setField("bodyParams", editConn.bodyParams.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                      placeholder="parameter name" style={{ width: "100%" }} />
                    <Input value={p.value} onChange={e => setField("bodyParams", editConn.bodyParams.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                      placeholder="value" style={{ width: "100%" }} />
                    <button onClick={() => setField("bodyParams", editConn.bodyParams.filter((_, j) => j !== i))}
                      style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "6px 10px" }}>×</button>
                  </div>
                ))}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Btn small variant="ghost" onClick={() => setField("bodyParams", [...(editConn.bodyParams || []), { key: "", value: "" }])}>+ Add Parameter</Btn>
                  {!(editConn.bodyParams || []).find(p => p.key === "operation_ids") && (
                    <Btn small variant="ghost" onClick={() => setField("bodyParams", [...(editConn.bodyParams || []), { key: "operation_ids", value: "" }])}
                      style={{ color: C.purple, borderColor: C.purple + "55" }}>+ operation_ids</Btn>
                  )}
                </div>

                {editConn.authType === "signed" && (editConn.bodyParams || []).length === 0 && (
                  <p style={{ color: C.muted, fontSize: 11, margin: "8px 0 0" }}>
                    Add <strong>operation_ids</strong> and any other params your API requires.
                    The <strong>sig</strong> param will be added automatically.
                  </p>
                )}
              </div>

              {/* Auth */}
              <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${editConn.authType === "signed" ? C.purple + "66" : C.border}` }}>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 8 }}>AUTHENTICATION</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {[["none", "None"], ["bearer", "Bearer Token"], ["apikey", "API Key"], ["signed", "Signed (AES-256-ECB)"]].map(([val, lbl]) => (
                    <button key={val} onClick={() => setField("authType", val)} style={{
                      padding: "5px 12px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                      border: `1px solid ${editConn.authType === val ? (val === "signed" ? C.purple : C.accent) : C.border}`,
                      background: editConn.authType === val ? (val === "signed" ? C.purpleDim : C.accentDim) : "transparent",
                      color: editConn.authType === val ? (val === "signed" ? C.purple : C.accent) : C.muted,
                    }}>{lbl}</button>
                  ))}
                </div>

                {editConn.authType === "bearer" && (
                  <Input value={editConn.authValue} onChange={e => setField("authValue", e.target.value)} placeholder="your-token-here" style={{ width: "100%" }} />
                )}

                {editConn.authType === "apikey" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                    <div>
                      <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>HEADER NAME</label>
                      <Input value={editConn.authHeader} onChange={e => setField("authHeader", e.target.value)} placeholder="X-API-Key" style={{ width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>KEY VALUE</label>
                      <Input value={editConn.authValue} onChange={e => setField("authValue", e.target.value)} placeholder="your-api-key" style={{ width: "100%" }} />
                    </div>
                  </div>
                )}

                {editConn.authType === "signed" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Formula reference */}
                    <div style={{ background: C.surface, borderRadius: 7, padding: "8px 12px", fontFamily: "monospace", fontSize: 11, color: C.purple, border: `1px solid ${C.border}` }}>
                      sig = base64( AES-256-ECB( publicKey | method | unixTimestamp, privateKey ) )
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>PUBLIC KEY</label>
                        <Input value={editConn.sigPublicKey || ""} onChange={e => setField("sigPublicKey", e.target.value)} placeholder="your-public-key" style={{ width: "100%" }} />
                      </div>
                      <div>
                        <label style={{ color: C.muted, fontSize: 10, fontWeight: 700, display: "block", marginBottom: 4 }}>PRIVATE KEY</label>
                        <input
                          type="password"
                          value={editConn.sigPrivateKey || ""}
                          onChange={e => setField("sigPrivateKey", e.target.value)}
                          placeholder="your-private-key (32 chars for AES-256)"
                          style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "7px 10px", outline: "none", boxSizing: "border-box" }}
                        />
                      </div>
                    </div>

                    {/* Live preview */}
                    {editConn.sigPublicKey && editConn.sigPrivateKey && (() => {
                      try {
                        const preview = computeSig(editConn.sigPublicKey, editConn.sigPrivateKey, editConn.method || "GET");
                        return (
                          <div style={{ background: C.surface, borderRadius: 7, padding: "8px 12px", border: `1px solid ${C.purple}44` }}>
                            <p style={{ color: C.muted, fontSize: 10, fontWeight: 700, margin: "0 0 4px" }}>LIVE SIG PREVIEW (changes each second)</p>
                            <p style={{ color: C.purple, fontSize: 10, fontFamily: "monospace", margin: 0, wordBreak: "break-all" }}>{preview}</p>
                          </div>
                        );
                      } catch { return null; }
                    })()}

                    <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.muted, flexWrap: "wrap" }}>
                      <span>✓ <strong style={{ color: C.text }}>x-api-key</strong> header auto-added (= public key)</span>
                      <span>✓ <strong style={{ color: C.text }}>sig</strong> body param auto-computed on every request</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Format + JSON path */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>DATA FORMAT</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {[["auto", "Auto"], ["csv", "CSV"], ["json", "JSON"], ["xlsx", "XLSX"]].map(([val, lbl]) => (
                      <button key={val} onClick={() => setField("dataFormat", val)} style={{
                        padding: "5px 10px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                        border: `1px solid ${editConn.dataFormat === val ? C.accent : C.border}`,
                        background: editConn.dataFormat === val ? C.accentDim : "transparent",
                        color: editConn.dataFormat === val ? C.accent : C.muted,
                      }}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>JSON ARRAY PATH <span style={{ color: C.muted, fontWeight: 400 }}>(optional)</span></label>
                  <Input value={editConn.jsonPath} onChange={e => setField("jsonPath", e.target.value)}
                    placeholder="e.g. data.rows" style={{ width: "100%" }}
                    disabled={editConn.dataFormat !== "json" && editConn.dataFormat !== "auto"} />
                  <p style={{ color: C.muted, fontSize: 10, margin: "4px 0 0" }}>Dot path to the array inside the JSON response</p>
                </div>
              </div>

              {/* Refresh policy */}
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, display: "block", marginBottom: 6 }}>REFRESH POLICY</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {[["manual", "Manual only"], ["on_open", "Auto on app open"]].map(([val, lbl]) => (
                    <button key={val} onClick={() => setField("refreshPolicy", val)} style={{
                      padding: "5px 12px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                      border: `1px solid ${editConn.refreshPolicy === val ? C.purple : C.border}`,
                      background: editConn.refreshPolicy === val ? C.purpleDim : "transparent",
                      color: editConn.refreshPolicy === val ? C.purple : C.muted,
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>

              {/* Fetch button */}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Btn onClick={handleFetch} disabled={!editConn.url || fetching} variant={fetchedData ? "success" : "primary"}>
                  {fetching ? "Fetching…" : fetchedData ? "✓ Re-fetch" : "Test & Fetch"}
                </Btn>
                {fetchError && <span style={{ color: C.red, fontSize: 12 }}>⚠ {fetchError}</span>}
                {fetchedData && <span style={{ color: C.green, fontSize: 12 }}>✓ {fetchedData.rows.length} rows, {fetchedData.headers.length} columns</span>}
              </div>

              {/* Preview + filters (shown after successful fetch) */}
              {fetchedData && (
                <>
                  <div>
                    <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 8px" }}>DATA PREVIEW</p>
                    <DataPreview headers={fetchedData.headers} rows={fetchedData.rows} maxRows={8} />
                  </div>

                  {/* Row Filters */}
                  <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
                    <p style={{ color: C.muted, fontSize: 11, fontWeight: 700, margin: "0 0 10px" }}>ROW FILTERS <span style={{ color: C.muted, fontWeight: 400 }}>(optional — limit which rows load into the app)</span></p>

                    {filters.map(f => {
                      const idx = fetchedData.headers.indexOf(f.column);
                      const allVals = idx >= 0 ? [...new Set(fetchedData.rows.map(r => String(r[idx] ?? "")))].sort() : [];
                      const noneSelected = f.values.length === 0;
                      return (
                        <div key={f.column} style={{ background: C.surface, borderRadius: 8, padding: "10px 12px", marginBottom: 8, border: `1px solid ${C.border}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span style={{ color: C.text, fontWeight: 700, fontSize: 12, flex: 1 }}>{f.column}</span>
                            <span style={{ color: C.muted, fontSize: 11 }}>{noneSelected ? "all values" : `${f.values.length} selected`}</span>
                            <button onClick={() => removeFilter(f.column)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 120, overflowY: "auto" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", color: C.muted, padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.border}`, background: noneSelected ? C.accentDim : "transparent" }}>
                              <input type="checkbox" checked={noneSelected} onChange={() => selectAllFilter(f.column)}
                                style={{ accentColor: C.accent, width: 11, height: 11 }} />
                              (All)
                            </label>
                            {allVals.map(v => (
                              <label key={v} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", color: f.values.includes(v) ? C.text : C.muted, padding: "2px 6px", borderRadius: 4, border: `1px solid ${f.values.includes(v) ? C.accentDim : C.border}`, background: f.values.includes(v) ? C.accentDim : "transparent" }}>
                                <input type="checkbox" checked={f.values.includes(v)} onChange={() => toggleFilterValue(f.column, v)}
                                  style={{ accentColor: C.accent, width: 11, height: 11 }} />
                                {v === "" ? <em>(blank)</em> : v}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Add filter */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Select value={newFilterCol} onChange={e => setNewFilterCol(e.target.value)} style={{ flex: 1 }}>
                        <option value="">+ Filter by column…</option>
                        {fetchedData.headers.filter(h => !filters.find(f => f.column === h)).map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </Select>
                      <Btn small variant="ghost" onClick={addFilter} disabled={!newFilterCol}>Add</Btn>
                    </div>
                  </div>

                  {/* Load to App */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 4 }}>
                    <Btn onClick={() => handleLoad(editConn, fetchedData)} variant="primary">
                      Load {filteredCount} rows → App
                    </Btn>
                    <span style={{ color: C.muted, fontSize: 12 }}>
                      {filters.filter(f => f.values.length > 0).length > 0 && `${fetchedData.rows.length - filteredCount} rows filtered out`}
                    </span>
                  </div>
                </>
              )}

              {/* Save / Delete */}
              <div style={{ display: "flex", gap: 10, paddingTop: 4, borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
                <Btn onClick={handleSave} disabled={!editConn.url}>Save Connection</Btn>
                {connections.find(c => c.id === editConn.id) && (
                  <Btn variant="danger" onClick={handleDelete}>Delete</Btn>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
