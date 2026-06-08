// ─────────────────────────────────────────────────────────────────────────────
// Dashboard data layer — the ONLY module that talks to the backend.
//
// SEC Phase C contract: there are NO direct table reads here. Every cloud call
// hits an edge function (running as service_role server-side) authenticated with
// the browser-safe PUBLISHABLE key + an x-anonymous-id header. The previous
// direct supabase.from('…') reads only worked under the leaked service_role key
// and are deliberately gone.
//
// In DATA_MODE='mock' (default until Phase C is deployed) every function returns
// local fixtures, so the whole dashboard is demoable offline and the live path
// is a drop-in once VITE_DATA_MODE='live'.
// ─────────────────────────────────────────────────────────────────────────────

import {
  IS_MOCK, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ANON_ID_KEY,
} from './config';
import {
  mockDashboard, mockSession, mockLeaderboard,
} from './fixtures';

export function getAnonId() {
  try { return localStorage.getItem(ANON_ID_KEY) || ''; } catch { return ''; }
}

export function setAnonId(id) {
  try { localStorage.setItem(ANON_ID_KEY, String(id || '').trim()); } catch { /* private mode */ }
}

export function isLinked() {
  return IS_MOCK || !!getAnonId();
}

async function callEdge(fnName, { query = {}, anon = true } = {}) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Cloud not configured (dashboard sync is gated on SEC Phase C deploy).');
  }
  const qs = new URLSearchParams(query).toString();
  const headers = { Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` };
  if (anon) {
    const id = getAnonId();
    if (!id) throw new Error('Not linked. Run `wtclaude dashboard` to link your CLI.');
    headers['x-anonymous-id'] = id;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}${qs ? `?${qs}` : ''}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${fnName} failed (${res.status})${text ? `: ${text}` : ''}`);
  }
  return res.json();
}

// Full dashboard payload: daily_summaries + sessions + badges + devices +
// rate_limits. One round-trip powers Overview, Devices, Badges, WhatIf.
export async function fetchDashboard({ days = 30 } = {}) {
  if (IS_MOCK) return mockDashboard();
  return callEdge('get-dashboard', { query: { days } });
}

// Per-session turn detail (replaces the old direct .from('turns') read).
export async function fetchSession(sessionId) {
  if (IS_MOCK) return mockSession(sessionId);
  return callEdge('get-session', { query: { session_id: sessionId } });
}

export async function fetchLeaderboard(period = 'weekly') {
  if (IS_MOCK) return mockLeaderboard();
  // Leaderboard is opt-in aggregate data — no anon id required.
  return callEdge('get-leaderboard', { query: { period }, anon: false });
}
