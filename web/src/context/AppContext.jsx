/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { THEME_KEY, CURRENCY_KEY, DEFAULT_CURRENCY } from '../lib/config';

const AppContext = createContext(null);

function initialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return 'dark'; // dark-mode DEFAULT
}

function initialCurrency() {
  try { return localStorage.getItem(CURRENCY_KEY) || DEFAULT_CURRENCY; } catch { return DEFAULT_CURRENCY; }
}

export function AppProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);
  const [currency, setCurrencyState] = useState(initialCurrency);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const setCurrency = useCallback((c) => {
    setCurrencyState(c);
    try { localStorage.setItem(CURRENCY_KEY, c); } catch { /* ignore */ }
  }, []);

  return (
    <AppContext.Provider value={{ theme, toggleTheme, currency, setCurrency }}>
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
// theme tokens to hex here, recomputed whenever the theme flips.
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
    faint: readVar('--faint', '#5c5c6e'),
    surface: readVar('--surface', '#12121a'),
    text: readVar('--text', '#e5e7eb'),
    cardHover: readVar('--card-hover', '#1c1c28'),
  }), [theme]); // eslint-disable-line react-hooks/exhaustive-deps
}
