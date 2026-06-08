// Small helper: distinct project hashes across a turn set, with turn counts and
// the most-recent branch seen. Used by `project` (list mode).

export function listProjectHashes(turns) {
  const byHash = new Map();
  for (const t of turns) {
    if (!t.project_hash) continue;
    if (!byHash.has(t.project_hash)) byHash.set(t.project_hash, { project_hash: t.project_hash, turns: 0, git_branch: null, last_ts: '' });
    const p = byHash.get(t.project_hash);
    p.turns++;
    if (t.ts > p.last_ts) { p.last_ts = t.ts; p.git_branch = t.git_branch ?? p.git_branch; }
  }
  return [...byHash.values()].sort((a, b) => b.turns - a.turns);
}
