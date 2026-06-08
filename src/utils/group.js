// Shared grouping helper for --group-by, `project`, `tasks`, `devices`, and the
// cost-center `report`. Buckets a flat list of turn records by one of the
// day-one grouping fields and summarizes each bucket with the same engine the
// summary commands use, so grouped totals reconcile with ungrouped ones.

import { summarizeTurns } from './sessions.js';

// Logical dimension name -> the turn-record field it reads.
export const GROUP_FIELDS = {
  project: 'project_hash',
  branch: 'git_branch',
  cost_center: 'cost_center',
  task: 'task_category',
  device: 'device_id',
};

export function resolveDimension(name) {
  if (!name) return null;
  const key = String(name).toLowerCase().replace(/-/g, '_');
  return GROUP_FIELDS[key] ? key : null;
}

// Returns [{ key, field, summary }], sorted by cost desc. `key` is the raw field
// value (or null when the turn never carried it — rendered as "untagged").
export function groupTurns(turns, dimension) {
  const field = GROUP_FIELDS[dimension] || dimension;
  const buckets = new Map();
  for (const t of turns) {
    const key = t[field] ?? null;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  return [...buckets.entries()]
    .map(([key, ts]) => ({ key, field, summary: summarizeTurns(ts) }))
    .sort((a, b) => b.summary.cost - a.summary.cost);
}

// How many turns in the set actually carry a non-null value for the dimension.
// Powers the honest "coming soon / null on current payloads" state for `tasks`
// (task_category) and `quality` (edit_target_hash) without guessing.
export function coverage(turns, dimension) {
  const field = GROUP_FIELDS[dimension] || dimension;
  let withVal = 0;
  for (const t of turns) if (t[field] != null) withVal++;
  return { withVal, total: turns.length };
}

export function displayKey(key, dimension) {
  if (key != null && key !== '') return String(key);
  switch (dimension) {
    case 'cost_center': return '(untagged)';
    case 'branch': return '(no branch)';
    case 'task': return '(unclassified)';
    case 'device': return '(this device)';
    case 'project': return '(unknown)';
    default: return '(none)';
  }
}
