import { useEffect, useState } from 'react';
import { fetchDashboard, isLinked, getAnonId } from './api.js';
import { describeError } from './errors.js';
import { useApp } from '../context/AppContext';

// Module-level cache so navigating between pages doesn't refetch the payload.
// Keyed by linked id + window (QA-0928-92: the window is now selectable), so
// relinking or widening the window can never show another key's data.
const cache = new Map();
const inflight = new Map();

export function invalidateDashboard() { cache.clear(); inflight.clear(); }

function load(key, days) {
  if (!inflight.has(key)) {
    inflight.set(key, fetchDashboard({ days }).then((d) => { cache.set(key, d); return d; }));
  }
  return inflight.get(key);
}

// → { data, loading, error, errorInfo, linked, days }. `error` stays a plain,
// friendly string (pages render it as-is); `errorInfo` is the structured form
// (title / message / command / detail) for the shared ErrorState (QA-0928-94).
export function useDashboard() {
  const { windowDays } = useApp();
  const linked = isLinked();
  const key = linked ? `${getAnonId()}|${windowDays}` : null;
  const [failed, setFailed] = useState(null); // { key, err }
  const [, setLoadedKey] = useState(null);
  // A failure belongs to the key it came from. When the key changes (another
  // window, a new link) it is dropped, so coming back to a key that failed
  // reads "Loading…" while the effect fetches it again, not the old error.
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setFailed(null);
  }

  useEffect(() => {
    if (!key || cache.has(key)) return undefined;
    let alive = true;
    load(key, windowDays)
      .then(() => { if (alive) setLoadedKey(key); })
      .catch((err) => { if (alive) { inflight.delete(key); setFailed({ key, err }); } });
    return () => { alive = false; };
  }, [key, windowDays]);

  if (!linked) return { data: null, loading: false, error: null, errorInfo: null, linked: false, days: windowDays };
  if (cache.has(key)) return { data: cache.get(key), loading: false, error: null, errorInfo: null, linked: true, days: windowDays };
  if (failed && failed.key === key) {
    const info = describeError(failed.err);
    return { data: null, loading: false, error: info.message, errorInfo: info, linked: true, days: windowDays };
  }
  return { data: null, loading: true, error: null, errorInfo: null, linked: true, days: windowDays };
}
