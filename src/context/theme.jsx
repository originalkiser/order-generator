import { createContext, useContext, useState } from "react";
import { DARK, LIGHT } from "../constants.js";
import { loadBrandLogo, loadBrandDarkColors, loadBrandLightColors, loadBrandPalette, applyBrand } from "../utils/brand.js";

const ThemeCtx = createContext({
  C: DARK, theme: "dark", toggleTheme: () => {},
  brandDarkColors: {}, setBrandDarkColors: () => {},
  brandLightColors: {}, setBrandLightColors: () => {},
  brandLogo: null, setBrandLogo: () => {},
  brandPalette: [], setBrandPalette: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("ordergen_theme_v1") || "dark"; } catch { return "dark"; }
  });

  const [brandDarkColors,  setBrandDarkColors]  = useState(() => loadBrandDarkColors());
  const [brandLightColors, setBrandLightColors] = useState(() => loadBrandLightColors());
  const [brandLogo,        setBrandLogo]        = useState(() => loadBrandLogo());
  const [brandPalette,     setBrandPalette]     = useState(() => loadBrandPalette());

  const baseC = theme === "light" ? LIGHT : DARK;
  // Apply the theme-appropriate overrides
  const C = applyBrand(baseC, theme === "dark" ? brandDarkColors : brandLightColors);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("ordergen_theme_v1", next); } catch {}
  };

  return (
    <ThemeCtx.Provider value={{ C, theme, toggleTheme, brandDarkColors, setBrandDarkColors, brandLightColors, setBrandLightColors, brandLogo, setBrandLogo, brandPalette, setBrandPalette }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useC()     { return useContext(ThemeCtx).C; }
export function useTheme() { return useContext(ThemeCtx); }
