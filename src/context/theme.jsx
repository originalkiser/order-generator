import { createContext, useContext, useState } from "react";
import { DARK, LIGHT } from "../constants.js";
import { loadBrandColors, loadBrandLogo, applyBrand } from "../utils/brand.js";

const ThemeCtx = createContext({ C: DARK, theme: "dark", toggleTheme: () => {}, brandColors: {}, setBrandColors: () => {}, brandLogo: null, setBrandLogo: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("ordergen_theme_v1") || "dark"; } catch { return "dark"; }
  });

  const [brandColors, setBrandColors] = useState(() => loadBrandColors());
  const [brandLogo,   setBrandLogo]   = useState(() => loadBrandLogo());

  const baseC = theme === "light" ? LIGHT : DARK;
  const C = applyBrand(baseC, brandColors);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("ordergen_theme_v1", next); } catch {}
  };

  return (
    <ThemeCtx.Provider value={{ C, theme, toggleTheme, brandColors, setBrandColors, brandLogo, setBrandLogo }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useC()     { return useContext(ThemeCtx).C; }
export function useTheme() { return useContext(ThemeCtx); }
