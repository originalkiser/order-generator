import { createContext, useContext, useState } from "react";
import { DARK, LIGHT } from "../constants.js";

const ThemeCtx = createContext({ C: DARK, theme: "dark", toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("ordergen_theme_v1") || "dark"; } catch { return "dark"; }
  });

  const C = theme === "light" ? LIGHT : DARK;

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("ordergen_theme_v1", next); } catch {}
  };

  return (
    <ThemeCtx.Provider value={{ C, theme, toggleTheme }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useC() { return useContext(ThemeCtx).C; }
export function useTheme() { return useContext(ThemeCtx); }
