import { readJsonlSessions } from '../compare/jsonl-reader.js';

// Evidence of what was actually INVOKED, read from the transcript STRUCTURE (tool_use
// / skill / subagent events) — never from token-count guesses (scope §2). Also returns
// the real turn count + dominant model, which anchor the billing-grade side of the
// dead-weight cost.
export function gatherEvidence({ sessions, dateFilter } = {}) {
  const data = sessions || readJsonlSessions(dateFilter);
  const usedNames = new Set();
  const modelCounts = {};
  const seenTurns = new Set();
  let turns = 0;

  for (const s of data) {
    for (const entry of s.entries || []) {
      const msg = entry.message && typeof entry.message === 'object' ? entry.message : null;
      if (!msg) continue;

      // `<synthetic>` placeholders are not model turns (no API call, zero usage).
      if (msg.role === 'assistant' && msg.model !== '<synthetic>') {
        const key = msg.id != null ? String(msg.id) : `${s.session_id}:${entry.timestamp}`;
        if (!seenTurns.has(key)) {
          seenTurns.add(key);
          turns++;
          if (msg.model) modelCounts[msg.model] = (modelCounts[msg.model] || 0) + 1;
        }
      }

      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const block of content) {
        if (!block || block.type !== 'tool_use') continue;
        collect(usedNames, block.name);
        const inp = block.input || {};
        collect(usedNames, inp.skill);
        collect(usedNames, inp.subagent_type);
        collect(usedNames, inp.command);
        collect(usedNames, inp.name);
      }
    }
  }

  let model = null, best = -1;
  for (const [m, c] of Object.entries(modelCounts)) if (c > best) { best = c; model = m; }
  return { usedNames, turns, model };
}

function collect(set, v) { if (typeof v === 'string' && v.trim()) set.add(v.trim().toLowerCase()); }

// Which inventory ids have evidence of use. Cautious matching: an item counts as used
// if its name equals or (>=4 chars) is contained in an invoked name. No evidence =>
// REVIEW (not a confident "unused"); "never used ≠ never useful".
export function usedIdsFor(items, usedNames) {
  const used = new Set();
  for (const it of items) {
    const n = String(it.name || '').toLowerCase();
    if (!n) continue;
    for (const u of usedNames) {
      if (u === n) { used.add(it.id); break; }
      if (n.length >= 4 && u.includes(n)) { used.add(it.id); break; }
      if (u.length >= 4 && n.includes(u)) { used.add(it.id); break; }
    }
  }
  return used;
}
