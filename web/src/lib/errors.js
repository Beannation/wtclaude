// Typed errors for the edge-function calls, and the friendly text the pages
// show for them (QA-0928-94 / 95 / 106 / 179). The raw status and response body
// used to go straight into Error.message, so every data route rendered
// 'get-dashboard failed (404): {"error":"User not found"}' for a brand-new id.

export class ApiError extends Error {
  // code: 'user-not-found' | 'not-found' | 'bad-request' | 'http' |
  //       'not-configured' | 'not-linked'
  constructor(code, message, { status = null, detail = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function serverMessage(text) {
  try { const j = JSON.parse(text); return typeof j?.error === 'string' ? j.error : null; } catch { return null; }
}

// Build the typed error for a non-2xx edge-function response.
export function edgeError(fnName, status, text = '') {
  const said = serverMessage(text);
  const detail = `${fnName} ${status}${said || text ? `: ${said || String(text).slice(0, 300)}` : ''}`;
  if (status === 404 && /user not found/i.test(said || '')) {
    return new ApiError('user-not-found', 'No synced data for this ID yet.', { status, detail });
  }
  if (status === 404) return new ApiError('not-found', 'Not found.', { status, detail });
  if (status === 400) return new ApiError('bad-request', 'The request was not accepted.', { status, detail });
  return new ApiError('http', 'The WTClaude cloud returned an error.', { status, detail });
}

const NETWORK = "Couldn't reach the WTClaude cloud — check your connection and try again; if it keeps failing, run wtclaude sync --status in your terminal.";

// → { code, title, message, body?, command, detail } for any thrown value.
// `code` is the ApiError code ('network' for anything else) for pages that
// branch on the kind of failure; `message` stands alone (pages that render a
// plain string use it); `body` is the shorter text under the title in
// ErrorState. `what` names the thing being loaded ('dashboard' by default,
// 'session' for session detail).
export function describeError(err, { what = 'dashboard' } = {}) {
  const code = err instanceof ApiError ? err.code : 'network';
  return { code, ...describe(code, err, what) };
}

function describe(code, err, what) {
  if (code === 'user-not-found') {
    return {
      title: 'No synced data for this ID yet',
      message: 'No synced data for this ID yet — run wtclaude sync --enable in your terminal (it shows a privacy preview first), then reload.',
      body: 'Run this in your terminal (it shows a privacy preview first), then reload:',
      command: 'wtclaude sync --enable',
      detail: null,
    };
  }
  if (code === 'not-linked') {
    return { title: 'Not linked', message: 'This browser is not linked yet — run wtclaude dashboard in your terminal to link it.', command: 'wtclaude dashboard', detail: null };
  }
  if (code === 'not-configured') {
    return { title: 'Cloud not configured', message: 'This dashboard build has no cloud address configured, so it cannot load live data.', command: null, detail: null };
  }
  if (what === 'session') {
    if (code === 'not-found') {
      return { title: 'Session not found', message: 'No session with this id is synced to this account. It may not have synced yet — run wtclaude sync, then reload.', command: 'wtclaude sync', detail: null };
    }
    return { title: "Couldn't load this session", message: code === 'network' ? NETWORK : 'The WTClaude cloud returned an error for this session. Try again in a moment.', command: null, detail: errDetail(err) };
  }
  if (code === 'network') return { title: "Couldn't reach the WTClaude cloud", message: NETWORK, command: 'wtclaude sync --status', detail: errDetail(err) };
  return {
    title: `Couldn't load your ${what}`,
    message: 'The WTClaude cloud returned an error. Try again in a moment; if it keeps failing, run wtclaude sync --status in your terminal.',
    command: 'wtclaude sync --status',
    detail: errDetail(err),
  };
}

function errDetail(err) {
  if (err instanceof ApiError) return err.detail || err.message;
  return err && err.message ? String(err.message) : String(err);
}
