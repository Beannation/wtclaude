/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  THEME_KEY, CURRENCY_KEY, DEFAULT_CURRENCY, WINDOW_KEY, WINDOW_OPTIONS, DEFAULT_WINDOW_DAYS,
} from '../lib/config';

const AppContext = createContext(null);

// Set the attribute SYNCHRONOUSLY (QA-0928-97). It used to be set in an effect,
// after render — but useThemeColors reads the CSS tokens during render, so
// every chart painted with the previous theme's colours. public/boot.js sets it
// before first paint; this keeps it in step on every change.
function applyTheme(theme) {
  try { document.documentElement.setAttribute('data-theme', theme); } catch { /* no DOM */ }
}

function initialTheme() {
  let theme = 'dark'; // dark-mode DEFAULT
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch { /* ignore */ }
  applyTheme(theme);
  return theme;
}

function initialCurrency() {
  try { return localStorage.getItem(CURRENCY_KEY) || DEFAULT_CURRENCY; } catch { return DEFAULT_CURRENCY; }
}

function initialWindow() {
  try {
    const saved = parseInt(localStorage.getItem(WINDOW_KEY), 10);
    if (WINDOW_OPTIONS.includes(saved)) return saved;
  } catch { /* ignore */ }
  return DEFAULT_WINDOW_DAYS;
}

export function AppProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);
  const [currency, setCurrencyState] = useState(initialCurrency);
  const [windowDays, setWindowState] = useState(initialWindow);

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => {
    const next = t === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    return next;
  }), []);

  const setCurrency = useCallback((c) => {
    setCurrencyState(c);
    try { localStorage.setItem(CURRENCY_KEY, c); } catch { /* ignore */ }
  }, []);

  const setWindowDays = useCallback((d) => {
    setWindowState(d);
    try { localStorage.setItem(WINDOW_KEY, String(d)); } catch { /* ignore */ }
  }, []);

  return (
    <AppContext.Provider value={{ theme, toggleTheme, currency, setCurrency, windowDays, setWindowDays }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// recharts applies `fill` as an SVG presentation attribute, where CSS variables
// (var(--x)) do NOT resolve — so charts must be passed concrete hex. Resolve the
// theme tokens to hex here, recomputed whenever the theme flips (the attribute
// is already set by then — see applyTheme).
function readVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function useThemeColors() {
  const { theme } = useApp();
  return useMemo(() => ({
    accent: readVar('--accent', '#4ade80'),
    indigo: readVar('--indigo', '#818cf8'),
    border: readVar('--border', '#262633'),
    faint: readVar('--faint', '#818195'),
    surface: readVar('--surface', '#12121a'),
    text: readVar('--text', '#e5e7eb'),
    cardHover: readVar('--card-hover', '#1c1c28'),
  }), [theme]); // eslint-disable-line react-hooks/exhaustive-deps
}
