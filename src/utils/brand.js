// ── Brand utility — logo + color overrides ────────────────────────────────────
const LOGO_KEY   = "ordergen_brand_logo";
const COLORS_KEY = "ordergen_brand_colors";

export function loadBrandLogo()  { try { return localStorage.getItem(LOGO_KEY)   || null; } catch { return null; } }
export function loadBrandColors(){ try { const s = localStorage.getItem(COLORS_KEY); return s ? JSON.parse(s) : {}; } catch { return {}; } }
export function saveBrandLogo(v)   { try { v ? localStorage.setItem(LOGO_KEY, v)   : localStorage.removeItem(LOGO_KEY);   } catch {} }
export function saveBrandColors(v) { try { v && Object.keys(v).length ? localStorage.setItem(COLORS_KEY, JSON.stringify(v)) : localStorage.removeItem(COLORS_KEY); } catch {} }

// ── Color math ────────────────────────────────────────────────────────────────
export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return [128, 128, 128];
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function toLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex) {
  try {
    const [r,g,b] = hexToRgb(hex);
    return 0.2126*toLinear(r) + 0.7152*toLinear(g) + 0.0722*toLinear(b);
  } catch { return 0; }
}

export function contrastRatio(hex1, hex2) {
  try {
    const l1 = luminance(hex1), l2 = luminance(hex2);
    const hi = Math.max(l1,l2), lo = Math.min(l1,l2);
    return (hi + 0.05) / (lo + 0.05);
  } catch { return 1; }
}

export function wcagRating(ratio) {
  if (ratio >= 7)   return { label: "AAA",      color: "#22c55e", ok: true  };
  if (ratio >= 4.5) return { label: "AA",        color: "#22c55e", ok: true  };
  if (ratio >= 3)   return { label: "AA Large",  color: "#f59e0b", ok: false };
  return              { label: "Fails",       color: "#ef4444", ok: false };
}

export function mixColors(hex1, hex2, ratio = 0.3) {
  const [r1,g1,b1] = hexToRgb(hex1);
  const [r2,g2,b2] = hexToRgb(hex2);
  const r = (v) => Math.min(255, Math.max(0, Math.round(v)));
  return "#" + [
    r(r1*ratio + r2*(1-ratio)),
    r(g1*ratio + g2*(1-ratio)),
    r(b1*ratio + b2*(1-ratio)),
  ].map(c => c.toString(16).padStart(2,"0")).join("");
}

// Derive a dim color (used for subtle backgrounds) from a vivid color + surface
function deriveDim(vivid, surface) {
  // Dark surface → high blend ratio (keep more of the vivid color) for richness
  // Light surface → low blend ratio (fade into white)
  const lum = luminance(surface);
  const ratio = lum < 0.1 ? 0.42 : 0.14;
  return mixColors(vivid, surface, ratio);
}

// Merge user overrides into the base palette and re-derive dim colors
export function applyBrand(base, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return base;
  const m = { ...base, ...overrides };
  // Always re-derive dim colours so they stay in harmony with whatever accent/surface was chosen
  m.accentDim = deriveDim(m.accent, m.surface);
  m.purpleDim = deriveDim(m.purple, m.surface);
  return m;
}

// ── Brand color definitions (shown in BrandingPanel) ─────────────────────────
export const BRAND_COLOR_DEFS = [
  {
    key: "accent",
    label: "Accent — Primary",
    desc: "Buttons, links, active tabs, callout numbers",
    checkAgainst: [["surface","on panels"], ["card","on cards"]],
    suggestLight: true,
    lightNote: "Should be vivid and clearly visible on dark/mid-tone backgrounds",
  },
  {
    key: "purple",
    label: "Secondary",
    desc: "Status badges, auto-refresh labels, Signed-auth highlights",
    checkAgainst: [["surface","on panels"]],
    suggestLight: true,
    lightNote: "Needs to read well on panel backgrounds — distinct from Accent",
  },
  {
    key: "bg",
    label: "Background",
    desc: "Outermost page background — the darkest layer in a dark theme",
    checkAgainst: [["surface","vs Surface (layers should differ)"]],
    suggestLight: false,
    lightNote: "Dark theme → very dark; light theme → near-white. High contrast with text.",
  },
  {
    key: "surface",
    label: "Surface",
    desc: "Panel, drawer, and form backgrounds",
    checkAgainst: [["bg","vs Background"], ["card","vs Card"]],
    suggestLight: false,
    lightNote: "Should sit between Background (darker) and Card (lighter) in perceived brightness.",
  },
  {
    key: "card",
    label: "Card",
    desc: "Table rows, inner cards, input fields",
    checkAgainst: [["surface","vs Surface"]],
    suggestLight: false,
    lightNote: "One step lighter (dark theme) or slightly tinted (light theme) from Surface.",
  },
  {
    key: "text",
    label: "Text — Primary",
    desc: "Body copy and column values — must have strong contrast",
    checkAgainst: [["bg","on background"], ["surface","on panels"]],
    suggestLight: true,
    minRatio: 4.5,
    lightNote: "AA standard requires 4.5:1 against backgrounds. Go as high as possible.",
  },
  {
    key: "muted",
    label: "Text — Muted",
    desc: "Column headers, labels, hints — intentionally lower contrast",
    checkAgainst: [["surface","on panels"]],
    suggestLight: true,
    minRatio: 3,
    lightNote: "AA-Large requires 3:1. Some contrast loss is fine — don't make it invisible.",
  },
  {
    key: "border",
    label: "Border",
    desc: "Dividers and input outlines — should be subtle",
    checkAgainst: [["bg","vs background"], ["surface","vs surface"]],
    suggestLight: false,
    lightNote: "Borders are intentionally subtle. 1.5–3:1 contrast is ideal — too vivid looks cluttered.",
  },
];
