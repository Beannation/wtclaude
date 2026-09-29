import { useState, useEffect, useSyncExternalStore } from 'react';
import { getAnonId, getStoredAnonId, setAnonId, removeAnonId } from '../lib/api';
import { invalidateDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { FX_RATES, FX_SNAPSHOT_DATE, IS_MOCK } from '../lib/config';
import {
  isValidAnonId, decideLink, maskId, peekPendingLink, clearPendingLink, pendingLinkSeq, subscribePendingLink,
} from '../lib/link';

// Linking (contract D; QA-0928-09 / 43 / 102). `wtclaude dashboard` opens
// /settings#link=<anonymous-id> (legacy: ?link=). public/boot.js has already
// taken the id out of the address bar; here it is validated, stored — or, when
// this browser is linked to a DIFFERENT id, held until the user confirms. The
// id is a password equivalent, so it is masked on screen (reveal on click) and
// the browser can be unlinked.

function resolveIncoming() {
  const pending = peekPendingLink();
  if (!pending) return null;
  const current = getAnonId();
  const action = decideLink(pending.id, current);
  if (action === 'store') { setAnonId(pending.id); invalidateDashboard(); }
  return { id: pending.id, action };
}

function noticeFor(incoming) {
  if (incoming?.action === 'store') return 'Linked ✓ — this browser now shows your synced data.';
  if (incoming?.action === 'same') return 'Already linked to this ID ✓';
  return '';
}

export default function Settings() {
  const { currency, setCurrency } = useApp();
  // Consumed once in the initializer (persist + cache-bust) so there's no
  // setState-in-effect; storing is idempotent under StrictMode's double call.
  // `seq` is the capture (public/boot.js counts them) this state settled.
  const [linkState, setLinkState] = useState(() => ({ incoming: resolveIncoming(), seq: pendingLinkSeq() }));
  const [linkedId, setLinkedId] = useState(getAnonId);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState(() => noticeFor(linkState.incoming));
  const storedInvalid = !linkedId && !!getStoredAnonId();

  // A #link= that arrives while this page is already open (a same-document
  // navigation, which boot.js strips and counts) is settled at once, the same
  // way — it used to wait for the next navigation.
  const linkSeq = useSyncExternalStore(subscribePendingLink, pendingLinkSeq);
  if (linkSeq !== linkState.seq) {
    const next = resolveIncoming();
    setLinkState({ incoming: next, seq: linkSeq });
    setLinkedId(getAnonId());
    setRevealed(false);
    setNotice(noticeFor(next));
  }
  const incoming = linkState.incoming;

  // Once this page holds the incoming id (settled, or waiting on the
  // confirmation below) the global copy is cleared, so the layout stops
  // sending every page here. Leaving without choosing keeps the current link.
  useEffect(() => {
    if (linkState.incoming) clearPendingLink();
  }, [linkState]);

  function link(id) {
    setAnonId(id);
    invalidateDashboard();
    setLinkedId(getAnonId());
    setRevealed(false);
  }

  function handleLink() {
    const id = draft.trim();
    if (!isValidAnonId(id)) {
      // `wtclaude sync --status` shows only the id's first 8 characters now
      // (QA-0928-41), so it is no longer where to read the id.
      setDraftError('That is not a WTClaude ID. It looks like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx — or skip pasting: run wtclaude dashboard in your terminal to link this browser.');
      return;
    }
    link(id);
    setDraft('');
    setDraftError('');
    setNotice('Linked ✓');
  }

  function confirmSwitch(accept) {
    if (accept) { link(incoming.id); setNotice('Switched ✓ — this browser now shows the newly linked ID.'); }
    else setNotice('Kept the ID this browser was already linked to.');
    clearPendingLink();
    setLinkState((s) => ({ ...s, incoming: null }));
  }

  function handleUnlink() {
    removeAnonId();
    invalidateDashboard();
    setLinkedId('');
    setRevealed(false);
    setNotice('Unlinked — this browser no longer holds your ID.');
  }

  async function copyId() {
    try { await navigator.clipboard.writeText(linkedId); setNotice('ID copied.'); } catch { /* clipboard blocked */ }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-[var(--text-strong)]">Settings</h2>

      {IS_MOCK && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted)]">
          Demo mode — sample data, not your usage.
        </div>
      )}

      {incoming?.action === 'confirm' && (
        <div role="alertdialog" aria-labelledby="switch-title" className="border border-[var(--amber)] rounded-xl p-5 space-y-3">
          <h3 id="switch-title" className="text-[var(--text-strong)] font-semibold">Switch this browser to a different ID?</h3>
          <p className="text-sm text-[var(--muted)]">
            This link carries the ID ending <span className="font-mono text-[var(--text)]">{incoming.id.trim().slice(-4)}</span>, but this browser is
            linked to the ID ending <span className="font-mono text-[var(--text)]">{linkedId.slice(-4)}</span>. Switching shows the new ID's data here
            instead. If you didn't just run <code className="text-[var(--accent)]">wtclaude dashboard</code> yourself, keep your current link.
            Leaving this page without choosing also keeps it.
          </p>
          <div className="flex gap-3 flex-wrap">
            <button onClick={() => confirmSwitch(false)}
              className="bg-[var(--accent)] text-black font-semibold px-4 py-2 rounded-lg hover:opacity-90">Keep current link</button>
            <button onClick={() => confirmSwitch(true)}
              className="border border-[var(--border)] text-[var(--text)] px-4 py-2 rounded-lg hover:border-[var(--amber)]">Switch to the new ID</button>
          </div>
        </div>
      )}

      {incoming?.action === 'invalid' && (
        <div role="alert" className="border border-[var(--rose)] rounded-xl p-4 text-sm text-[var(--text)]">
          That link didn't contain a valid WTClaude ID, so nothing was changed. Run <code className="text-[var(--accent)]">wtclaude dashboard</code> again.
        </div>
      )}

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-[var(--text-strong)] font-semibold mb-3">Link your account</h3>
        {notice && <p role="status" className="text-sm text-[var(--accent)] mb-3">{notice}</p>}
        {linkedId ? (
          <div className="space-y-3">
            <p className="text-[var(--muted)] text-sm">
              This browser is linked. Your anonymous ID works like a password — anyone who has it can read this dashboard.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="font-mono text-sm bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text)] break-all">
                {revealed ? linkedId : maskId(linkedId)}
              </code>
              <button onClick={() => setRevealed((r) => !r)} className="text-xs border border-[var(--border)] rounded px-3 py-1.5 text-[var(--text)] hover:border-[var(--faint)]">
                {revealed ? 'Hide' : 'Reveal'}
              </button>
              <button onClick={copyId} className="text-xs border border-[var(--border)] rounded px-3 py-1.5 text-[var(--text)] hover:border-[var(--faint)]">Copy</button>
              <button onClick={handleUnlink} className="text-xs border border-[var(--rose)] rounded px-3 py-1.5 text-[var(--rose)] hover:opacity-90">
                Unlink this browser
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[var(--muted)] text-sm mb-4">
              Run <code className="text-[var(--accent)]">wtclaude dashboard</code> in your terminal — it opens this page pre-linked.
              Or paste your anonymous ID: in a browser that is already linked, this page shows it with Reveal and Copy
              (it is also <code className="text-[var(--accent)]">anonymous_id</code> in <code className="text-[var(--accent)]">~/.wtclaude/config.json</code>).
            </p>
            {storedInvalid && (
              <p className="text-sm text-[var(--amber)] mb-3">The ID saved in this browser isn't a valid WTClaude ID, so it is being ignored. Link again below.</p>
            )}
            <div className="flex gap-3 flex-wrap">
              <label className="sr-only" htmlFor="anon-id">Anonymous ID</label>
              <input id="anon-id" type="password" autoComplete="off" spellCheck={false} value={draft}
                onChange={(e) => { setDraft(e.target.value); setDraftError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleLink(); }}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-invalid={!!draftError} aria-describedby={draftError ? 'anon-id-error' : undefined}
                className="flex-1 min-w-0 sm:min-w-[16rem] bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--text)] font-mono text-sm focus:border-[var(--accent)]" />
              <button onClick={handleLink}
                className="bg-[var(--accent)] text-black font-semibold px-6 py-2 rounded-lg hover:opacity-90 transition-opacity">
                Link
              </button>
            </div>
            {draftError && <p id="anon-id-error" className="text-sm text-[var(--rose)] mt-2">{draftError}</p>}
          </>
        )}
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-[var(--text-strong)] font-semibold mb-3">Display currency</h3>
        <p className="text-[var(--muted)] text-sm mb-4">
          Conversion is <span className="text-[var(--text)]">display-only</span> — cost is always stored in USD (billing-grade).
          Converted figures are marked ≈: they use the CLI's fixed rate table (last updated {FX_SNAPSHOT_DATE}), not live
          exchange rates. A rate you override in the CLI's config (<code className="text-[var(--accent)]">fx_rates</code>) applies only in your terminal.
        </p>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}
          className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2 text-[var(--text)] max-w-full">
          {Object.entries(FX_RATES).map(([code, fx]) => (
            <option key={code} value={code}>{code} — {fx.label}{code === 'USD' ? '' : ` (≈ ${fx.rate} per USD)`}</option>
          ))}
        </select>
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-[var(--text-strong)] font-semibold mb-3">CLI setup</h3>
        <div className="space-y-4 text-sm">
          <Step n="1" label="Install and configure the collector:" cmd="npm i -g wtclaude && wtclaude setup" />
          <Step n="2" label="Turn on cloud sync (shows a privacy preview first):" cmd="wtclaude sync --enable" />
          <Step n="3" label="After using Claude Code, sync your data:" cmd="wtclaude sync" />
        </div>
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-[var(--text-strong)] font-semibold mb-3">Data sharing</h3>
        <p className="text-[var(--muted)] text-sm mb-3">
          Control whether your totals appear on the leaderboard. Opting in takes effect with your next <code className="text-[var(--accent)]">wtclaude sync</code>. Manage in your terminal:
        </p>
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
