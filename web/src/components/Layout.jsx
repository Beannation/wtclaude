import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { FX_RATES, IS_MOCK } from '../lib/config';
import Footer from './Footer';

const navItems = [
  { to: '/', label: 'Overview', end: true },
  { to: '/timeline', label: 'Timeline' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/devices', label: 'Devices' },
  { to: '/compare', label: 'Compare' },
  { to: '/whatif', label: 'What If' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/badges', label: 'Badges' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { theme, toggleTheme, currency, setCurrency } = useApp();

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] sticky top-0 z-10 bg-[var(--bg)]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold font-mono shrink-0">
            <span className="text-[var(--accent)]">WT</span><span className="text-[var(--text-strong)]">Claude</span>
          </h1>
          <nav className="flex gap-1 overflow-x-auto" aria-label="Primary">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-[var(--card-hover)] text-[var(--text-strong)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2 shrink-0">
            <label className="sr-only" htmlFor="currency-select">Display currency</label>
            <select
              id="currency-select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text)]"
              title="Display currency (conversion is display-only; cost is stored in USD)"
            >
              {Object.keys(FX_RATES).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={toggleTheme}
              className="bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text)] hover:border-[var(--faint)]"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </header>

      {IS_MOCK && (
        <div className="bg-[var(--accent-dim)] border-b border-[var(--accent)]/40 text-[var(--accent)] text-xs text-center py-1.5 px-4">
          Demo mode — showing sample data. Live numbers appear once cloud sync (SEC Phase C) is deployed.
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-6 w-full flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
