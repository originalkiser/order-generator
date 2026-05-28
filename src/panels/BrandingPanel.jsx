import { useState, useRef, useCallback } from "react";
import { useTheme } from "../context/theme.jsx";
import {
  BRAND_COLOR_DEFS,
  contrastRatio, wcagRating, mixColors,
  parseColorInput, fmtHex,
  autoAssignColors, removeBackground,
  saveBrandDarkColors, saveBrandLightColors, saveBrandLogo, saveBrandPalette,
} from "../utils/brand.js";

const MAX_PALETTE = 8;

// ── Slot names shown in assignment preview ────────────────────────────────────
const SLOT_LABELS = { accent:"Accent", purple:"Secondary", bg:"BG", surface:"Surface", card:"Card", text:"Text", muted:"Muted", border:"Border" };

// ── One entry in the user's brand palette ─────────────────────────────────────
function PaletteEntry({ hex, index, onChange, onRemove, C }) {
  const [raw, setRaw] = useState(fmtHex(hex));

  // Sync when parent resets
  const prevHex = useRef(hex);
  if (hex !== prevHex.current) { prevHex.current = hex; setRaw(fmtHex(hex)); }

  const commit = () => {
    const parsed = parseColorInput(raw);
    if (parsed) { onChange(parsed); setRaw(fmtHex(parsed)); }
    else setRaw(fmtHex(hex)); // revert invalid
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* Native colour picker hidden behind the swatch */}
      <label style={{ cursor: "pointer", flexShrink: 0, position: "relative", width: 32, height: 32 }}>
        <input type="color" value={hex}
          onChange={e => { onChange(e.target.value); setRaw(fmtHex(e.target.value)); }}
          style={{ opacity: 0, position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "pointer" }} />
        <div style={{ width: 32, height: 32, borderRadius: 8, background: hex, border: `2px solid ${C.border}`, boxShadow: "0 2px 6px #0005" }} />
      </label>

      {/* Hex / RGB text input */}
      <input
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === "Enter" && commit()}
        placeholder="#RRGGBB or r, g, b"
        style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "monospace", fontSize: 12, fontWeight: 700, padding: "5px 9px", outline: "none" }}
      />

      {/* Saturation indicator */}
      <div style={{ width: 8, height: 32, borderRadius: 4, background: `linear-gradient(to top, ${C.border}, ${hex})`, flexShrink: 0 }} title="Colour intensity" />

      <button onClick={onRemove}
        style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
    </div>
  );
}

// ── Fine-tune: per-slot colour row with contrast badges ───────────────────────
function SlotRow({ def, palette, value, onChange, C }) {
  const [raw, setRaw] = useState(fmtHex(value));
  const prev = useRef(value);
  if (value !== prev.current) { prev.current = value; setRaw(fmtHex(value)); }

  const commit = () => {
    const p = parseColorInput(raw);
    if (p) { onChange(p); setRaw(fmtHex(p)); } else setRaw(fmtHex(value));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, background: C.card, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ cursor: "pointer", flexShrink: 0, position: "relative", width: 28, height: 28 }}>
          <input type="color" value={value} onChange={e => { onChange(e.target.value); setRaw(fmtHex(e.target.value)); }}
            style={{ opacity:0, position:"absolute", inset:0, width:"100%", height:"100%", cursor:"pointer" }} />
          <div style={{ width:28, height:28, borderRadius:6, background:value, border:`2px solid ${C.border}` }} />
        </label>
        <div style={{ flex:1 }}>
          <span style={{ color:C.text, fontWeight:700, fontSize:12 }}>{def.label}</span>
          <span style={{ color:C.muted, fontSize:11, marginLeft:8 }}>{def.desc}</span>
        </div>
        <input value={raw} onChange={e=>setRaw(e.target.value)} onBlur={commit} onKeyDown={e=>e.key==="Enter"&&commit()}
          style={{ width:90, background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, color:C.accent, fontFamily:"monospace", fontSize:11, fontWeight:700, padding:"3px 7px", outline:"none" }} />
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
        {def.checkAgainst.map(([bgKey, bgLabel]) => {
          const bg = palette[bgKey]; if (!bg) return null;
          const ratio = contrastRatio(value, bg);
          const { label, color } = wcagRating(ratio);
          return (
            <span key={bgKey} style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:20, background:color+"18", border:`1px solid ${color}44`, color }}>
              {bgLabel} · {ratio.toFixed(1)}:1 {label}
            </span>
          );
        })}
      </div>
      <div style={{ color:C.muted, fontSize:10, fontStyle:"italic" }}>{def.lightNote}</div>
    </div>
  );
}

// ── Assignment result mini-grid ───────────────────────────────────────────────
function AssignmentGrid({ assignments, baseC, label, C }) {
  const slots = Object.keys(SLOT_LABELS).filter(k => assignments[k]);
  if (!slots.length) return null;
  return (
    <div style={{ background: C.card, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {slots.map(k => {
          const hex = assignments[k];
          return (
            <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: hex, border: `2px solid ${C.border}`, boxShadow: "0 1px 4px #0004" }} title={hex} />
              <span style={{ color: C.muted, fontSize: 9, fontWeight: 700 }}>{SLOT_LABELS[k]}</span>
            </div>
          );
        })}
      </div>
      {/* Key contrast checks */}
      {assignments.text && assignments.bg && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
          {[["text","bg","Text/BG"],["accent","surface","Accent/Surface"],["muted","surface","Muted/Surface"]].map(([a,b,lbl]) => {
            if (!assignments[a] || !assignments[b]) return null;
            const r = contrastRatio(assignments[a], assignments[b]);
            const { label: wl, color: wc } = wcagRating(r);
            return <span key={lbl} style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:20, background:wc+"18", border:`1px solid ${wc}44`, color:wc }}>{lbl} · {r.toFixed(1)}:1 {wl}</span>;
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export function BrandingPanel({ onClose }) {
  const { C, theme, brandDarkColors, setBrandDarkColors, brandLightColors, setBrandLightColors, brandLogo, setBrandLogo, brandPalette, setBrandPalette } = useTheme();

  // Logo state
  const logoRef = useRef();
  const [removeBg, setRemoveBg] = useState(true);
  const [logoLoading, setLogoLoading] = useState(false);
  const [logoError, setLogoError] = useState("");

  // Palette state
  const [palette, setPaletteState] = useState(() => brandPalette.length ? brandPalette : []);

  // Last auto-assign results (shown after clicking)
  const [lastDark,  setLastDark]  = useState(null);
  const [lastLight, setLastLight] = useState(null);

  // Fine-tune panel open
  const [showFineTune, setShowFineTune] = useState(false);

  // ── Logo handlers ──────────────────────────────────────────────────────────
  const handleLogoFile = async (file) => {
    setLogoError(""); setLogoLoading(true);
    if (file.size > 2*1024*1024) { setLogoError("Logo must be under 2 MB."); setLogoLoading(false); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      let dataUrl = e.target.result;
      if (removeBg) {
        try { dataUrl = await removeBackground(dataUrl, file.type); } catch {}
      }
      setBrandLogo(dataUrl); saveBrandLogo(dataUrl);
      setLogoLoading(false);
    };
    reader.onerror = () => { setLogoError("Failed to read file."); setLogoLoading(false); };
    reader.readAsDataURL(file);
  };

  const handleRemoveBgNow = async () => {
    if (!brandLogo) return;
    setLogoLoading(true);
    try {
      const result = await removeBackground(brandLogo);
      setBrandLogo(result); saveBrandLogo(result);
    } catch {}
    setLogoLoading(false);
  };

  const removeLogo = () => { setBrandLogo(null); saveBrandLogo(null); };

  // ── Palette handlers ───────────────────────────────────────────────────────
  const updatePalette = (next) => {
    setPaletteState(next);
    setBrandPalette(next);
    saveBrandPalette(next);
  };

  const addColor = () => {
    if (palette.length >= MAX_PALETTE) return;
    updatePalette([...palette, "#4f8ef7"]);
  };

  const changeColor = (i, hex) => {
    const next = palette.map((c,j) => j===i ? hex : c);
    updatePalette(next);
  };

  const removeColor = (i) => updatePalette(palette.filter((_,j)=>j!==i));

  // ── Auto-assign ────────────────────────────────────────────────────────────
  const assignDark = useCallback(() => {
    const a = autoAssignColors(palette, true);
    setBrandDarkColors(a); saveBrandDarkColors(a);
    setLastDark(a);
  }, [palette, setBrandDarkColors]);

  const assignLight = useCallback(() => {
    const a = autoAssignColors(palette, false);
    setBrandLightColors(a); saveBrandLightColors(a);
    setLastLight(a);
  }, [palette, setBrandLightColors]);

  const assignBoth = useCallback(() => {
    const dark  = autoAssignColors(palette, true);
    const light = autoAssignColors(palette, false);
    setBrandDarkColors(dark);  saveBrandDarkColors(dark);
    setBrandLightColors(light); saveBrandLightColors(light);
    setLastDark(dark); setLastLight(light);
  }, [palette, setBrandDarkColors, setBrandLightColors]);

  // ── Fine-tune: current active overrides ───────────────────────────────────
  const activeColors = theme === "dark" ? brandDarkColors : brandLightColors;
  const setActiveColors = theme === "dark"
    ? (v) => { setBrandDarkColors(v);  saveBrandDarkColors(v);  }
    : (v) => { setBrandLightColors(v); saveBrandLightColors(v); };

  const updateSlot = (key, hex) => setActiveColors({ ...activeColors, [key]: hex });

  // Reset all
  const hasOverrides = Object.keys(brandDarkColors).length > 0 || Object.keys(brandLightColors).length > 0 || !!brandLogo || palette.length > 0;

  const resetAll = () => {
    setBrandDarkColors({});  saveBrandDarkColors({});
    setBrandLightColors({}); saveBrandLightColors({});
    setBrandLogo(null);      saveBrandLogo(null);
    updatePalette([]);
    setLastDark(null); setLastLight(null);
  };

  // Build the live palette object (base + active overrides) for contrast checks in fine-tune
  const livePalette = { ...C }; // C already has overrides applied

  return (
    <div style={{ position:"fixed", inset:0, background:"#000a", zIndex:1000, display:"flex", alignItems:"flex-start", justifyContent:"flex-end" }}
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ width:Math.min(560,window.innerWidth), height:"100vh", background:C.surface, borderLeft:`1px solid ${C.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ padding:"16px 20px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:800, fontSize:15, color:C.text }}>🎨 Branding</div>
            <div style={{ color:C.muted, fontSize:11 }}>Logo · palette · per-theme colour assignments</div>
          </div>
          {hasOverrides && (
            <button onClick={resetAll} style={{ padding:"5px 12px", borderRadius:6, fontFamily:"inherit", fontWeight:700, fontSize:11, cursor:"pointer", border:`1px solid ${C.red}55`, background:C.red+"18", color:C.red, flexShrink:0 }}>
              Reset All
            </button>
          )}
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:20, lineHeight:1, padding:0, flexShrink:0 }}>×</button>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:20, display:"flex", flexDirection:"column", gap:18 }}>

          {/* ── Logo ─────────────────────────────────────────────────── */}
          <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style={{ display:"none" }}
            onChange={e => { if (e.target.files[0]) { handleLogoFile(e.target.files[0]); e.target.value=""; } }} />

          <section style={{ background:C.card, borderRadius:12, padding:"14px 16px", border:`1px solid ${C.border}` }}>
            <div style={{ fontWeight:700, fontSize:13, color:C.text, marginBottom:10 }}>Company Logo</div>
            <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
              {/* Preview box */}
              <div style={{ width:72, height:72, borderRadius:12, background:C.surface, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", flexShrink:0 }}>
                {logoLoading
                  ? <span style={{ color:C.muted, fontSize:11 }}>…</span>
                  : brandLogo
                    ? <img src={brandLogo} alt="Logo" style={{ width:"100%", height:"100%", objectFit:"contain" }} />
                    : <span style={{ color:C.muted, fontSize:11, textAlign:"center", lineHeight:1.3 }}>No logo</span>
                }
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                  <button onClick={() => logoRef.current?.click()} disabled={logoLoading}
                    style={{ padding:"6px 12px", borderRadius:7, fontFamily:"inherit", fontWeight:700, fontSize:12, cursor:"pointer", border:`1px solid ${C.accent}66`, background:C.accentDim, color:C.accent, opacity:logoLoading?.6:1 }}>
                    📂 Upload
                  </button>
                  {brandLogo && (
                    <>
                      <button onClick={handleRemoveBgNow} disabled={logoLoading}
                        style={{ padding:"6px 12px", borderRadius:7, fontFamily:"inherit", fontWeight:700, fontSize:12, cursor:"pointer", border:`1px solid ${C.purple}55`, background:C.purpleDim, color:C.purple }}>
                        ✨ Remove BG
                      </button>
                      <button onClick={removeLogo}
                        style={{ padding:"6px 12px", borderRadius:7, fontFamily:"inherit", fontWeight:700, fontSize:12, cursor:"pointer", border:`1px solid ${C.border}`, background:"transparent", color:C.muted }}>
                        ✕ Remove
                      </button>
                    </>
                  )}
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", userSelect:"none" }}>
                  <input type="checkbox" checked={removeBg} onChange={e=>setRemoveBg(e.target.checked)}
                    style={{ accentColor:C.accent, width:13, height:13 }} />
                  <span style={{ color:C.muted, fontSize:11 }}>Auto-remove white/black background on upload</span>
                </label>
                <span style={{ color:C.muted, fontSize:10 }}>PNG · JPG · SVG · WEBP · max 2 MB · displayed bottom-right of the screen</span>
              </div>
            </div>
            {logoError && <p style={{ color:C.red, fontSize:11, margin:"8px 0 0" }}>{logoError}</p>}
          </section>

          {/* ── Brand Palette ─────────────────────────────────────────── */}
          <section style={{ background:C.card, borderRadius:12, padding:"14px 16px", border:`1px solid ${C.border}` }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
              <div style={{ fontWeight:700, fontSize:13, color:C.text }}>
                Brand Palette
                <span style={{ color:C.muted, fontWeight:400, fontSize:11, marginLeft:8 }}>({palette.length}/{MAX_PALETTE} colours)</span>
              </div>
              {palette.length < MAX_PALETTE && (
                <button onClick={addColor}
                  style={{ padding:"4px 10px", borderRadius:6, fontFamily:"inherit", fontWeight:700, fontSize:11, cursor:"pointer", border:`1px solid ${C.accent}55`, background:C.accentDim, color:C.accent }}>
                  + Add Colour
                </button>
              )}
            </div>
            <p style={{ color:C.muted, fontSize:11, margin:"0 0 12px" }}>
              Enter your brand colours — hex <span style={{ fontFamily:"monospace" }}>#RRGGBB</span>, RGB <span style={{ fontFamily:"monospace" }}>r, g, b</span>, or <span style={{ fontFamily:"monospace" }}>rgb(r,g,b)</span>. Then auto-assign them below.
            </p>

            {palette.length === 0 ? (
              <button onClick={addColor}
                style={{ width:"100%", padding:"18px", borderRadius:8, border:`2px dashed ${C.border}`, background:"transparent", color:C.muted, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                + Add your first brand colour
              </button>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {palette.map((hex, i) => (
                  <PaletteEntry key={i} hex={hex} index={i} C={C}
                    onChange={h => changeColor(i, h)}
                    onRemove={() => removeColor(i)} />
                ))}
              </div>
            )}

            {/* Auto-assign buttons */}
            {palette.length > 0 && (
              <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ color:C.muted, fontSize:11, fontWeight:700 }}>AUTO-ASSIGN TO THEME</div>
                <p style={{ color:C.muted, fontSize:11, margin:0 }}>
                  Analyses luminance and saturation to assign each colour to the best-fit slot (backgrounds, text, accents). Works independently for dark and light mode.
                </p>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button onClick={assignBoth}
                    style={{ padding:"8px 18px", borderRadius:8, fontFamily:"inherit", fontWeight:800, fontSize:12, cursor:"pointer", border:"none", background:C.accent, color:"#fff" }}>
                    ⚡ Assign Both Modes
                  </button>
                  <button onClick={assignDark}
                    style={{ padding:"8px 14px", borderRadius:8, fontFamily:"inherit", fontWeight:700, fontSize:12, cursor:"pointer", border:`1px solid ${C.border}`, background:"transparent", color:C.muted }}>
                    🌙 Dark Only
                  </button>
                  <button onClick={assignLight}
                    style={{ padding:"8px 14px", borderRadius:8, fontFamily:"inherit", fontWeight:700, fontSize:12, cursor:"pointer", border:`1px solid ${C.border}`, background:"transparent", color:C.muted }}>
                    ☀ Light Only
                  </button>
                </div>

                {/* Assignment result previews */}
                {(lastDark || lastLight) && (
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {lastDark  && <AssignmentGrid assignments={lastDark}  baseC={C} label="🌙 DARK MODE ASSIGNMENTS"  C={C} />}
                    {lastLight && <AssignmentGrid assignments={lastLight} baseC={C} label="☀ LIGHT MODE ASSIGNMENTS" C={C} />}
                    <p style={{ color:C.muted, fontSize:11, margin:0 }}>
                      Applied! Switch themes with the ☀/🌙 button in the header to see each mode. Fine-tune below if needed.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Fine-tune ─────────────────────────────────────────────── */}
          <section style={{ background:C.card, borderRadius:12, border:`1px solid ${C.border}`, overflow:"hidden" }}>
            <button onClick={() => setShowFineTune(v=>!v)}
              style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", background:"none", border:"none", padding:"12px 16px", cursor:"pointer", color:C.text, fontFamily:"inherit" }}>
              <span style={{ fontWeight:700, fontSize:13 }}>
                Fine-tune — {theme==="dark"?"Dark":"Light"} Mode
                {Object.keys(activeColors).length>0 && <span style={{ color:C.accent, fontSize:11, fontWeight:400, marginLeft:8 }}>{Object.keys(activeColors).length} slots customised</span>}
              </span>
              <span style={{ color:C.muted, fontSize:12 }}>{showFineTune?"▲":"▼"}</span>
            </button>
            {showFineTune && (
              <div style={{ padding:"0 14px 14px", display:"flex", flexDirection:"column", gap:8, borderTop:`1px solid ${C.border}` }}>
                <p style={{ color:C.muted, fontSize:11, margin:"10px 0 4px" }}>
                  Manually override individual slots for the current theme ({theme}). Pick from the colour picker or type hex/RGB.
                </p>
                {BRAND_COLOR_DEFS.map(def => (
                  <SlotRow key={def.key} def={def} palette={livePalette}
                    value={activeColors[def.key] || C[def.key] || "#000000"}
                    onChange={hex => updateSlot(def.key, hex)} C={C} />
                ))}
                {Object.keys(activeColors).length > 0 && (
                  <button onClick={() => setActiveColors({})}
                    style={{ alignSelf:"flex-end", padding:"5px 12px", borderRadius:6, fontFamily:"inherit", fontWeight:700, fontSize:11, cursor:"pointer", border:`1px solid ${C.red}55`, background:C.red+"18", color:C.red, marginTop:4 }}>
                    ↩ Clear {theme} overrides
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Current theme status */}
          <div style={{ color:C.muted, fontSize:11, textAlign:"center" }}>
            Active: <strong style={{ color:C.text }}>{theme}</strong> mode ·{" "}
            <span style={{ color:C.accent }}>{Object.keys(brandDarkColors).length} dark</span> ·{" "}
            <span style={{ color:C.purple }}>{Object.keys(brandLightColors).length} light</span> overrides
          </div>
        </div>
      </div>
    </div>
  );
}
