// ── Brand utility — logo, palette, and per-theme colour overrides ─────────────

const LOGO_KEY    = "ordergen_brand_logo";
const DARK_KEY    = "ordergen_brand_dark";
const LIGHT_KEY   = "ordergen_brand_light";
const PALETTE_KEY = "ordergen_brand_palette";

// ── Storage ───────────────────────────────────────────────────────────────────
export const loadBrandLogo = () => { try { return localStorage.getItem(LOGO_KEY) || null; } catch { return null; } };
export const saveBrandLogo = (v) => { try { v ? localStorage.setItem(LOGO_KEY, v) : localStorage.removeItem(LOGO_KEY); } catch {} };

export function loadBrandDarkColors() {
  try {
    const v = localStorage.getItem(DARK_KEY);
    if (v) return JSON.parse(v);
    // Migrate from old single key
    const old = localStorage.getItem("ordergen_brand_colors");
    if (old) { localStorage.setItem(DARK_KEY, old); localStorage.removeItem("ordergen_brand_colors"); return JSON.parse(old); }
    return {};
  } catch { return {}; }
}
export const saveBrandDarkColors  = (v) => { try { v && Object.keys(v).length ? localStorage.setItem(DARK_KEY, JSON.stringify(v))  : localStorage.removeItem(DARK_KEY);  } catch {} };
export const loadBrandLightColors = ()  => { try { const s = localStorage.getItem(LIGHT_KEY); return s ? JSON.parse(s) : {}; } catch { return {}; } };
export const saveBrandLightColors = (v) => { try { v && Object.keys(v).length ? localStorage.setItem(LIGHT_KEY, JSON.stringify(v)) : localStorage.removeItem(LIGHT_KEY); } catch {} };
export const loadBrandPalette     = ()  => { try { const s = localStorage.getItem(PALETTE_KEY); return s ? JSON.parse(s) : []; } catch { return []; } };
export const saveBrandPalette     = (v) => { try { v?.length ? localStorage.setItem(PALETTE_KEY, JSON.stringify(v)) : localStorage.removeItem(PALETTE_KEY); } catch {} };

// ── Colour math ───────────────────────────────────────────────────────────────
export function hexToRgb(hex) {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return [128, 128, 128];
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

// Accept: #rrggbb · #rgb · rgb(r,g,b) · rgba(r,g,b,a) · "r, g, b" bare
export function parseColorInput(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return "#" + [s[1]+s[1], s[2]+s[2], s[3]+s[3]].join("").toLowerCase();
  const rm = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rm) return "#" + [rm[1],rm[2],rm[3]].map(n => Math.min(255,+n).toString(16).padStart(2,"0")).join("");
  const bm = s.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (bm) return "#" + [bm[1],bm[2],bm[3]].map(n => Math.min(255,+n).toString(16).padStart(2,"0")).join("");
  return null;
}

// Return display-friendly hex string (uppercase, with #)
export const fmtHex = (hex) => (hex || "").toUpperCase();

function toLinear(c) { const s=c/255; return s<=0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055,2.4); }

export function luminance(hex) {
  try { const [r,g,b] = hexToRgb(hex); return 0.2126*toLinear(r)+0.7152*toLinear(g)+0.0722*toLinear(b); }
  catch { return 0; }
}

export function hexToHsl(hex) {
  const [r,g,b] = hexToRgb(hex).map(c => c/255);
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  const l=(max+min)/2;
  if (d===0) return [0,0,l];
  const s = l>0.5 ? d/(2-max-min) : d/(max+min);
  let h=0;
  if (max===r) h=((g-b)/d+(g<b?6:0))/6;
  else if (max===g) h=((b-r)/d+2)/6;
  else h=((r-g)/d+4)/6;
  return [h,s,l];
}

export function contrastRatio(hex1, hex2) {
  try { const l1=luminance(hex1),l2=luminance(hex2),hi=Math.max(l1,l2),lo=Math.min(l1,l2); return (hi+0.05)/(lo+0.05); }
  catch { return 1; }
}

export function wcagRating(ratio) {
  if (ratio>=7)   return { label:"AAA",      color:"#22c55e", ok:true  };
  if (ratio>=4.5) return { label:"AA",        color:"#22c55e", ok:true  };
  if (ratio>=3)   return { label:"AA Large",  color:"#f59e0b", ok:false };
  return            { label:"Fails",       color:"#ef4444", ok:false };
}

export function mixColors(hex1, hex2, ratio=0.3) {
  const [r1,g1,b1]=hexToRgb(hex1), [r2,g2,b2]=hexToRgb(hex2);
  const clamp=v=>Math.min(255,Math.max(0,Math.round(v)));
  return "#"+[clamp(r1*ratio+r2*(1-ratio)),clamp(g1*ratio+g2*(1-ratio)),clamp(b1*ratio+b2*(1-ratio))].map(c=>c.toString(16).padStart(2,"0")).join("");
}

function deriveDim(vivid, surface) {
  return mixColors(vivid, surface, luminance(surface)<0.1 ? 0.42 : 0.14);
}

// Merge user overrides into base palette, re-deriving dim colours
export function applyBrand(base, overrides) {
  if (!overrides || !Object.keys(overrides).length) return base;
  const m = { ...base, ...overrides };
  m.accentDim = deriveDim(m.accent, m.surface);
  m.purpleDim = deriveDim(m.purple, m.surface);
  return m;
}

// ── Auto-assign palette → theme slots ────────────────────────────────────────
export function autoAssignColors(paletteHexes, isDark) {
  const valid = (paletteHexes||[]).filter(h => /^#[0-9a-fA-F]{6}$/.test(h));
  if (!valid.length) return {};

  const items = valid.map(hex => ({ hex, lum:luminance(hex), sat:hexToHsl(hex)[1] }));
  const byLum = [...items].sort((a,b)=>a.lum-b.lum); // darkest→lightest
  const n = byLum.length;
  // Vivid = saturated (brand colours → best for accent/secondary)
  const vivids = items.filter(c=>c.sat>0.2).sort((a,b)=>b.sat-a.sat);
  const result = {};

  if (isDark) {
    // Backgrounds: darkest
    result.bg      = byLum[0]?.hex;
    if (n>=2) result.surface = byLum[1].hex;
    if (n>=3) result.card    = byLum[2].hex;
    // Text: lightest
    result.text  = byLum[n-1]?.hex;
    if (n>=2) result.muted = byLum[Math.max(0,n-2)].hex;
  } else {
    // Backgrounds: lightest
    result.bg      = byLum[n-1]?.hex;
    if (n>=2) result.surface = byLum[n-2].hex;
    if (n>=3) result.card    = byLum[n-3].hex;
    // Text: darkest
    result.text  = byLum[0]?.hex;
    if (n>=2) result.muted = byLum[Math.min(1,n-1)].hex;
  }

  // Accents: most saturated vivid colours
  if (vivids[0]) result.accent = vivids[0].hex;
  if (vivids[1]) result.purple = vivids[1].hex;

  // Border: blend between surface and bg
  const surf = result.surface || result.bg;
  const bg   = result.bg;
  if (surf && bg && surf!==bg) result.border = mixColors(surf, bg, isDark?0.6:0.5);
  else if (surf) result.border = mixColors(surf, isDark?"#ffffff":"#000000", 0.12);

  // Sanity: remove slots where fg===bg
  if (result.text===result.bg)         delete result.text;
  if (result.muted===result.surface)   delete result.muted;
  if (result.accent===result.bg || result.accent===result.surface) delete result.accent;
  // Remove undefined
  Object.keys(result).forEach(k => { if (!result[k]) delete result[k]; });
  return result;
}

// ── Background removal (canvas BFS flood-fill from edges) ────────────────────
export function removeBackground(dataUrl, mimeType="") {
  return new Promise(resolve => {
    if (mimeType.includes("svg") || dataUrl.startsWith("data:image/svg")) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      const w=img.width, h=img.height;
      if (!w||!h) { resolve(dataUrl); return; }
      const canvas=document.createElement("canvas");
      canvas.width=w; canvas.height=h;
      const ctx=canvas.getContext("2d");
      ctx.drawImage(img,0,0);
      const imgData=ctx.getImageData(0,0,w,h), d=imgData.data;

      // Sample 12 edge points to detect background colour
      const pts=[[0,0],[w-1,0],[0,h-1],[w-1,h-1],[Math.floor(w/4),0],[Math.floor(w*3/4),0],[Math.floor(w/4),h-1],[Math.floor(w*3/4),h-1],[0,Math.floor(h/4)],[0,Math.floor(h*3/4)],[w-1,Math.floor(h/4)],[w-1,Math.floor(h*3/4)]];
      const opaque = pts.filter(([x,y])=>d[(y*w+x)*4+3]>200);
      if (!opaque.length) { resolve(dataUrl); return; }
      let sR=0,sG=0,sB=0;
      opaque.forEach(([x,y])=>{ const i=(y*w+x)*4; sR+=d[i];sG+=d[i+1];sB+=d[i+2]; });
      const bgR=sR/opaque.length, bgG=sG/opaque.length, bgB=sB/opaque.length;

      // Only proceed for clearly white or clearly black backgrounds
      const isWhite = bgR>200&&bgG>200&&bgB>200;
      const isBlack = bgR<55 &&bgG<55 &&bgB<55;
      if (!isWhite&&!isBlack) { resolve(dataUrl); return; }

      const TOL=40;
      const isBg=i => Math.abs(d[i]-bgR)<=TOL && Math.abs(d[i+1]-bgG)<=TOL && Math.abs(d[i+2]-bgB)<=TOL;

      // BFS flood-fill from all edge pixels
      const visited=new Uint8Array(w*h);
      const queue=[]; let qi=0;

      const enq = pos => {
        if (pos<0||pos>=w*h||visited[pos]) return;
        const i=pos*4;
        if (d[i+3]===0||isBg(i)) { visited[pos]=1; d[i+3]=0; queue.push(pos); }
        else { visited[pos]=2; }
      };
      for (let x=0;x<w;x++) { enq(x); enq((h-1)*w+x); }
      for (let y=1;y<h-1;y++) { enq(y*w); enq(y*w+(w-1)); }
      while (qi<queue.length) {
        const pos=queue[qi++]; const x=pos%w, y=Math.floor(pos/w);
        if (x>0)   enq(pos-1);
        if (x<w-1) enq(pos+1);
        if (y>0)   enq(pos-w);
        if (y<h-1) enq(pos+w);
      }

      ctx.putImageData(imgData,0,0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror=()=>resolve(dataUrl);
    img.src=dataUrl;
  });
}

// ── Slot definitions for fine-tune section ────────────────────────────────────
export const BRAND_COLOR_DEFS = [
  { key:"accent",  label:"Accent — Primary",  desc:"Buttons, links, active states",          checkAgainst:[["surface","on panels"],["card","on cards"]], lightNote:"Vivid and clearly visible against panel/card backgrounds." },
  { key:"purple",  label:"Secondary",          desc:"Status badges, secondary highlights",    checkAgainst:[["surface","on panels"]],                     lightNote:"Distinct from Accent — used for auto-refresh and Signed-auth labels." },
  { key:"bg",      label:"Background",         desc:"Outermost page — darkest / lightest",    checkAgainst:[["surface","vs Surface"]],                    lightNote:"Dark theme → very dark. Light theme → near-white." },
  { key:"surface", label:"Surface",            desc:"Panels, drawers, form backgrounds",      checkAgainst:[["bg","vs Bg"],["card","vs Card"]],            lightNote:"Should sit between Background and Card in perceived brightness." },
  { key:"card",    label:"Card",               desc:"Table rows, inner cards, inputs",        checkAgainst:[["surface","vs Surface"]],                    lightNote:"Slightly lighter (dark) or tinted (light) vs Surface." },
  { key:"text",    label:"Text — Primary",     desc:"Body copy and column values",            checkAgainst:[["bg","on bg"],["surface","on panels"]],       lightNote:"Must meet AA (4.5:1) against backgrounds — go as high as possible." },
  { key:"muted",   label:"Text — Muted",       desc:"Labels, hints, secondary info",          checkAgainst:[["surface","on panels"]],                     lightNote:"AA-Large (3:1) minimum — some contrast loss is intentional." },
  { key:"border",  label:"Border",             desc:"Dividers and input outlines",            checkAgainst:[["surface","vs surface"]],                    lightNote:"Borders are subtle — 1.5–3:1 is typically ideal." },
];
