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
  IS_MOCK, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ANON_ID_KEY, DEFAULT_WINDOW_DAYS,
} from './config.js';
import {
  mockDashboard, mockSession, mockLeaderboard,
} from './fixtures.js';
import { ApiError, edgeError } from './errors.js';
import { isValidAnonId } from './link.js';
import { browserTimeZone } from './dates.js';

// The stored id, or '' when there is none or it is not a UUID (QA-0928-102:
// anything typed used to be stored, and every page then showed a 404 dump).
export function getAnonId() {
  const raw = getStoredAnonId();
  return isValidAnonId(raw) ? raw.trim() : '';
}

// Whatever is stored, valid or not (Settings explains an invalid one).
export function getStoredAnonId() {
  try { return localStorage.getItem(ANON_ID_KEY) || ''; } catch { return ''; }
}

export function setAnonId(id) {
  try { localStorage.setItem(ANON_ID_KEY, String(id || '').trim()); } catch { /* private mode */ }
}

// "Unlink this browser" (QA-0928-102): the id is a key; shared machines need a
// way to forget it.
export function removeAnonId() {
  try { localStorage.removeItem(ANON_ID_KEY); } catch { /* private mode */ }
}

export function isLinked() {
  return IS_MOCK || !!getAnonId();
}

async function callEdge(fnName, { query = {}, anon = true } = {}) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new ApiError('not-configured', 'Cloud not configured for this dashboard build.');
  }
  const qs = new URLSearchParams(query).toString();
  const headers = { Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` };
  if (anon) {
    const id = getAnonId();
    if (!id) throw new ApiError('not-linked', 'Not linked. Run `wtclaude dashboard` to link your CLI.');
    headers['x-anonymous-id'] = id;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}${qs ? `?${qs}` : ''}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw edgeError(fnName, res.status, text);
  }
  return res.json();
}

// get-dashboard query (contract B): the window in days and the browser's IANA
// zone, so the server can bucket days and hours on the viewer's local calendar.
export function dashboardQuery({ days = DEFAULT_WINDOW_DAYS, tz = browserTimeZone() } = {}) {
  const d = parseInt(days, 10);
  return {
    days: String(Number.isInteger(d) && d >= 1 && d <= 365 ? d : DEFAULT_WINDOW_DAYS),
    tz: tz || 'UTC',
  };
}

// Full dashboard payload: daily rows + sessions + badges + devices +
// rate_limits. One round-trip powers Overview, Devices, Badges, WhatIf.
export async function fetchDashboard(opts = {}) {
  const query = dashboardQuery(opts);
  if (IS_MOCK) return mockDashboard({ days: Number(query.days), tz: query.tz });
  return callEdge('get-dashboard', { query });
}

// Per-session turn detail (replaces the old direct .from('turns') read).
export async function fetchSession(sessionId) {
  if (IS_MOCK) {
    const s = mockSession(sessionId);
    if (!s) throw edgeError('get-session', 404, '{"error":"Session not found"}');
    return s;
  }
  return callEdge('get-session', { query: { session_id: sessionId } });
}

export async function fetchLeaderboard(period = 'weekly') {
  if (IS_MOCK) return mockLeaderboard(period);
  // Leaderboard is opt-in aggregate data — no anon id required.
  return callEdge('get-leaderboard', { query: { period }, anon: false });
}
