import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAnonId, setAnonId } from '../lib/api';
import { invalidateDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { FX_RATES, FX_SNAPSHOT_DATE, IS_MOCK } from '../lib/config';

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const { currency, setCurrency } = useApp();
  // `wtclaude dashboard` opens /settings?link=<anonymous-id>. Consume it once in
  // the initializer (persist + cache-bust) so there's no setState-in-effect.
  const [anonymousId, setId] = useState(() => {
    const linkParam = params.get('link');
    if (linkParam) { setAnonId(linkParam); invalidateDashboard(); return linkParam; }
    return getAnonId();
  });
  const [saved, setSaved] = useState(false);

  // Strip the consumed ?link= param from the URL (router navigation only).
  useEffect(() => {
    if (params.get('link')) {
      const next = new URLSearchParams(params);
      next.delete('link');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLink() {
    setAnonId(anonymousId);
    invalidateDashboard();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-[var(--text-strong)]">Settings</h2>

      {IS_MOCK && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted)]">
          Dashboard is in <span className="text-[var(--text)]">demo mode</span> — sample data only. Live cloud data turns on
          once SEC Phase C (edge functions + deny-anon migration) is deployed and <code className="text-[var(--accent)]">VITE_DATA_MODE=live</code> is set.
        </div>
      )}

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-[var(--text-strong)] font-semibold mb-3">Link your account</h3>
        <p className="text-[var(--muted)] text-sm mb-4">
          Run <code className="text-[var(--accent)]">wtclaude dashboard</code> in your terminal — it opens this page pre-linked.
          Or paste your anonymous ID (<code className="text-[var(--accent)]">wtclaude sync --status</code>):
        </p>
        <div className="flex gap-3 flex-wrap">
          <input type="text" value={anonymousId} onChange={(e) => setId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="flex-1 min-w-[16rem] bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--text)] font-mono text-sm focus:border-[var(--accent)]" />
          <button onClick={handleLink}
            className="bg-[var(--accent)] text-black font-semibold px-6 py-2 rounded-lg hover:opacity-90 transition-opacity">
            {saved ? 'Saved!' : 'Link'}
          </button>
        </div>
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-[var(--text-strong)] font-semibold mb-3">Display currency</h3>
        <p className="text-[var(--muted)] text-sm mb-4">
          Conversion is <span className="text-[var(--text)]">display-only</span> — cost is always stored in USD (billing-grade).
          Rates are a cached snapshot ({FX_SNAPSHOT_DATE}), labeled approximate.
        </p>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}
          className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--text)]">
          {Object.entries(FX_RATES).map(([code, fx]) => (
            <option key={code} value={code}>{code} — {fx.label}</option>
          ))}
        </select>
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-[var(--text-strong)] font-semibold mb-3">CLI setup</h3>
        <div className="space-y-4 text-sm">
          <Step n="1" label="Install and configure the collector:" cmd="npx wtclaude setup" />
          <Step n="2" label="Enable cloud sync:" cmd="wtclaude sync --configure" />
          <Step n="3" label="After using Claude Code, sync your data:" cmd="wtclaude sync" />
        </div>
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-[var(--text-strong)] font-semibold mb-3">Data sharing</h3>
        <p className="text-[var(--muted)] text-sm mb-3">Control what's shared for the leaderboard and community benchmarks. Manage in your terminal:</p>
        <div className="space-y-2">
          <code className="block bg-[var(--bg)] text-[var(--accent)] px-4 py-2 rounded-lg text-sm">wtclaude share --preview</code>
          <code className="block bg-[var(--bg)] text-[var(--accent)] px-4 py-2 rounded-lg text-sm">wtclaude share --enable</code>
        </div>
      </div>
    </div>
  );
}

function Step({ n, label, cmd }) {
  return (
    <div>
      <p className="text-[var(--muted)] mb-2">{n}. {label}</p>
      <code className="block bg-[var(--bg)] text-[var(--accent)] px-4 py-2 rounded-lg">{cmd}</code>
    </div>
  );
}
