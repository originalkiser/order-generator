import { useState, useRef, useCallback } from "react";
import { useTheme } from "../context/theme.jsx";
import { BRAND_COLOR_DEFS, contrastRatio, wcagRating, saveBrandColors, saveBrandLogo } from "../utils/brand.js";

// ── Small colour swatch + hex picker ─────────────────────────────────────────
function ColorRow({ def, currentPalette, value, onChange }) {
  const C = currentPalette;
  const [hexInput, setHexInput] = useState(value);

  // Sync hexInput when value prop changes externally (e.g. reset)
  if (hexInput !== value && !hexInput.startsWith("#")) setHexInput(value);

  const commitHex = () => {
    const clean = hexInput.startsWith("#") ? hexInput : "#" + hexInput;
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) { onChange(clean); setHexInput(clean); }
    else setHexInput(value); // revert invalid
  };

  return (
    <div style={{ background: C.card, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Colour picker */}
        <label style={{ cursor: "pointer", flexShrink: 0, position: "relative", width: 36, height: 36 }}>
          <input
            type="color"
            value={value}
            onChange={e => { onChange(e.target.value); setHexInput(e.target.value); }}
            style={{ opacity: 0, position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "pointer" }}
          />
          <div style={{ width: 36, height: 36, borderRadius: 8, background: value, border: `2px solid ${C.border}`, boxShadow: "0 2px 6px #0006", flexShrink: 0 }} />
        </label>

        {/* Labels + hex input */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>{def.label}</span>
            <input
              value={hexInput}
              onChange={e => setHexInput(e.target.value)}
              onBlur={commitHex}
              onKeyDown={e => e.key === "Enter" && commitHex()}
              maxLength={7}
              style={{
                width: 80, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5,
                color: C.accent, fontFamily: "monospace", fontSize: 11, fontWeight: 700,
                padding: "3px 7px", outline: "none", textTransform: "uppercase",
              }}
            />
          </div>
          <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{def.desc}</div>
        </div>
      </div>

      {/* Contrast badges */}
      {def.checkAgainst.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {def.checkAgainst.map(([bgKey, bgLabel]) => {
            const bgColor = currentPalette[bgKey];
            if (!bgColor) return null;
            const ratio = contrastRatio(value, bgColor);
            const { label: wcagLabel, color: wcagColor, ok } = wcagRating(ratio);
            return (
              <div key={bgKey} style={{
                display: "flex", alignItems: "center", gap: 5, padding: "3px 8px",
                borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: wcagColor + "18", border: `1px solid ${wcagColor}44`, color: wcagColor,
              }}>
                <span style={{ opacity: 0.7 }}>{bgLabel}</span>
                <span style={{ fontWeight: 800 }}>{ratio.toFixed(1)}:1</span>
                <span>{wcagLabel}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Contextual hint */}
      <div style={{ color: C.muted, fontSize: 10, fontStyle: "italic", lineHeight: 1.5 }}>
        {def.lightNote}
      </div>
    </div>
  );
}

// ── Branding Panel ────────────────────────────────────────────────────────────
export function BrandingPanel({ onClose }) {
  const { C, brandColors, setBrandColors, brandLogo, setBrandLogo } = useTheme();
  const logoFileRef = useRef();
  const [logoError, setLogoError] = useState("");

  // Live-edit local copy; committed to context (and localStorage) immediately for live preview
  const updateColor = useCallback((key, value) => {
    const next = { ...brandColors, [key]: value };
    setBrandColors(next);
    saveBrandColors(next);
  }, [brandColors, setBrandColors]);

  const handleLogoFile = (file) => {
    setLogoError("");
    if (file.size > 2 * 1024 * 1024) { setLogoError("Logo file must be under 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      setBrandLogo(dataUrl);
      saveBrandLogo(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setBrandLogo(null);
    saveBrandLogo(null);
  };

  const resetAll = () => {
    setBrandColors({});
    saveBrandColors({});
    setBrandLogo(null);
    saveBrandLogo(null);
  };

  const hasOverrides = Object.keys(brandColors).length > 0 || !!brandLogo;

  // Use the live (post-brand) palette for rendering the panel itself
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: Math.min(540, window.innerWidth), height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "18px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>🎨 Branding</div>
            <div style={{ color: C.muted, fontSize: 11 }}>Logo and colour overrides — preview updates live</div>
          </div>
          {hasOverrides && (
            <button onClick={resetAll} style={{ padding: "5px 12px", borderRadius: 6, fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer", border: `1px solid ${C.red}55`, background: C.red + "18", color: C.red }}>
              Reset to Default
            </button>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── Logo ─────────────────────────────────────────────────────── */}
          <input ref={logoFileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
            style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) { handleLogoFile(e.target.files[0]); e.target.value = ""; } }} />

          <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 10 }}>Logo</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {/* Preview */}
              <div style={{ width: 64, height: 64, borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                {brandLogo
                  ? <img src={brandLogo} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : <span style={{ color: C.muted, fontSize: 11, textAlign: "center", padding: 4 }}>Default</span>
                }
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button onClick={() => logoFileRef.current?.click()}
                  style={{ padding: "6px 14px", borderRadius: 7, fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer", border: `1px solid ${C.accent}66`, background: C.accentDim, color: C.accent }}>
                  📂 Upload Logo
                </button>
                {brandLogo && (
                  <button onClick={removeLogo}
                    style={{ padding: "6px 14px", borderRadius: 7, fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer", border: `1px solid ${C.border}`, background: "transparent", color: C.muted }}>
                    ✕ Remove
                  </button>
                )}
                <span style={{ color: C.muted, fontSize: 10 }}>PNG, SVG, JPG or WEBP · max 2 MB</span>
              </div>
            </div>
            {logoError && <p style={{ color: C.red, fontSize: 11, margin: "8px 0 0" }}>{logoError}</p>}
          </div>

          {/* ── Note about themes ─────────────────────────────────────────── */}
          <div style={{ background: C.accentDim + "88", borderRadius: 8, padding: "8px 12px", border: `1px solid ${C.accent}33`, color: C.muted, fontSize: 11, lineHeight: 1.5 }}>
            <strong style={{ color: C.accent }}>Note:</strong> Colour overrides apply on top of the currently active theme. Dark/light backgrounds (bg, surface, card) look best when matched to the theme — use the ☀/🌙 toggle in the header to switch, then set matching colours for each.
            <br />
            Accent and Secondary colours adapt well to either theme.
          </div>

          {/* ── Colour pickers ────────────────────────────────────────────── */}
          <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
            Colours <span style={{ color: C.muted, fontWeight: 400, fontSize: 11 }}>— {Object.keys(brandColors).length} of 8 customised</span>
          </div>

          {BRAND_COLOR_DEFS.map(def => (
            <ColorRow
              key={def.key}
              def={def}
              currentPalette={C}
              value={brandColors[def.key] || C[def.key] || "#000000"}
              onChange={v => updateColor(def.key, v)}
            />
          ))}

          {/* Reset footer */}
          {hasOverrides && (
            <div style={{ paddingTop: 8, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: C.muted, fontSize: 11 }}>
                {Object.keys(brandColors).length} colour{Object.keys(brandColors).length !== 1 ? "s" : ""} overridden{brandLogo ? " · custom logo" : ""}
              </span>
              <button onClick={resetAll}
                style={{ padding: "6px 14px", borderRadius: 7, fontFamily: "inherit", fontWeight: 700, fontSize: 12, cursor: "pointer", border: `1px solid ${C.red}55`, background: C.red + "18", color: C.red }}>
                ↩ Reset to Default
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
