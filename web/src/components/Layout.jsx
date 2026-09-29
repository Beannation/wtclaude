import { useEffect, useState, useSyncExternalStore } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { FX_RATES, IS_MOCK, WINDOW_OPTIONS } from '../lib/config';
import { NAV_ITEMS, SETTINGS_ITEM, pageLabel, isDataRoute, normalizePath } from '../lib/routes';
import { peekPendingLink, pendingLinkSeq, subscribePendingLink } from '../lib/link';
import Footer from './Footer';

// REWORKED 2026-09-28 (QA-0928-100): eleven items in one overflow-x row hid
// Settings (and half of Badges) at every desktop width behind an invisible
// scrollbar, and showed two items on a phone. The nav now has its own row
// (wrapping) from lg up and a menu below lg; Settings — where linking and
// unlinking live — sits with the header controls.

const navCls = ({ isActive }) =>
  `px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
    isActive
      ? 'bg-[var(--card-hover)] text-[var(--text-strong)]'
      : 'text-[var(--muted)] hover:text-[var(--text)]'
  }`;

const controlCls = 'bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text)]';

export default function Layout() {
  const { theme, toggleTheme, currency, setCurrency, windowDays, setWindowDays } = useApp();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = pageLabel(pathname);

  // Per-route tab title (QA-0928-176: every route used to be titled "web").
  useEffect(() => {
    document.title = current ? `${current} · WTClaude Dashboard` : 'WTClaude Dashboard';
  }, [current]);

  // A #link= id always lands on Settings, where it is confirmed (contract D).
  // Subscribed so a #link= that arrives without a reload is routed there too.
  useSyncExternalStore(subscribePendingLink, pendingLinkSeq);
  const pending = peekPendingLink();
  useEffect(() => {
    if (pending && normalizePath(pathname) !== '/settings') navigate('/settings', { replace: true });
  }, [pending, pathname, navigate]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] sticky top-0 z-10 bg-[var(--bg)]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 pt-3 pb-2 lg:pb-1 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold font-mono shrink-0">
            <span className="text-[var(--accent)]">WT</span><span className="text-[var(--text-strong)]">Claude</span>
          </h1>
          <div className="flex items-center gap-2 min-w-0">
            {isDataRoute(pathname) && (
              <>
                <label className="sr-only" htmlFor="window-select">Dashboard window</label>
                <select
                  id="window-select"
                  value={windowDays}
                  onChange={(e) => setWindowDays(Number(e.target.value))}
                  className={controlCls}
                  title="How many days of synced data to show"
                >
                  {WINDOW_OPTIONS.map((d) => (
                    <option key={d} value={d}>{d} days</option>
                  ))}
                </select>
              </>
            )}
            <label className="sr-only" htmlFor="currency-select">Display currency</label>
            <select
              id="currency-select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={controlCls}
              title="Display currency (converted figures are approximate; cost is stored in USD)"
            >
              {Object.keys(FX_RATES).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={toggleTheme}
              className={`${controlCls} hover:border-[var(--faint)]`}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <NavLink
              to={SETTINGS_ITEM.to}
              className={({ isActive }) => `${controlCls} hover:border-[var(--faint)] ${isActive ? 'border-[var(--faint)] text-[var(--text-strong)]' : ''}`}
              aria-label="Settings"
              title="Settings — link or unlink this browser"
            >
              <span aria-hidden="true">⚙</span><span className="hidden sm:inline"> Settings</span>
            </NavLink>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 pb-2">
          {/* lg and up: every page, wrapping if it ever has to. */}
          <nav className="hidden lg:flex flex-wrap gap-1" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navCls}>{item.label}</NavLink>
            ))}
          </nav>
          {/* Below lg: a menu that names the current page. */}
          <div className="lg:hidden">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              className="w-full flex items-center justify-between rounded border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--text)]"
            >
              <span>{current || 'Pages'}</span>
              <span className="text-[var(--muted)]"><span aria-hidden="true">{menuOpen ? '▴' : '▾'}</span> Menu</span>
            </button>
            {menuOpen && (
              <nav id="mobile-nav" className="grid grid-cols-2 gap-1 mt-2" aria-label="Primary">
                {NAV_ITEMS.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={navCls} onClick={() => setMenuOpen(false)}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            )}
          </div>
        </div>
      </header>

      {IS_MOCK && (
        <div className="bg-[var(--accent-dim)] border-b border-[var(--accent)]/40 text-[var(--accent)] text-xs text-center py-1.5 px-4">
          Demo mode — sample data, not your usage.
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-6 w-full flex-1 min-w-0">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
