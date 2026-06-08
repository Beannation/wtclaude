import { useEffect, useState } from 'react';
import { fetchDashboard, isLinked } from './api';

// Module-level cache so navigating between pages doesn't refetch the payload.
let cache = null;
let inflight = null;

export function invalidateDashboard() { cache = null; inflight = null; }

export function useDashboard() {
  const [state, setState] = useState(() => {
    if (cache) return { data: cache, loading: false, error: null, linked: true };
    if (!isLinked()) return { data: null, loading: false, error: null, linked: false };
    return { data: null, loading: true, error: null, linked: true };
  });

  useEffect(() => {
    if (cache || !isLinked()) return undefined;
    let alive = true;
    if (!inflight) inflight = fetchDashboard().then((d) => { cache = d; return d; });
    inflight
      .then((d) => { if (alive) setState({ data: d, loading: false, error: null, linked: true }); })
      .catch((err) => { if (alive) { inflight = null; setState({ data: null, loading: false, error: err.message, linked: true }); } });

    return () => { alive = false; };
  }, []);

  return state;
}
