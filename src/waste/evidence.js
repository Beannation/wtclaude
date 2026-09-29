import { scanAssistantEntries } from '../compare/jsonl-reader.js';
import { localDateOf } from '../utils/time.js';

// Evidence of what was actually INVOKED, read from the transcript STRUCTURE (tool_use
// / skill / subagent events) — never from token-count guesses (scope §2). Also returns
// the real turn count per model, which anchors the billing-grade side of the
// dead-weight cost.
//
// `sessions` ([{ session_id, entries }]) is the test seam. Without it the
// transcripts are STREAMED — one entry at a time, nothing retained but the
// counters below — because holding every entry of a 30-day window ran out of
// heap on real transcript volume (QA-0928-15).
//
// QA-0928-70 (2026-09-28): this used to pour every tool name (Skill, Write, …),
// every Bash command string and every `name` input into ONE pool that
// usedIdsFor() then matched by two-way substrings, so a skill named beta-skill
// was "used" because the Skill tool was called and canon-writer because Write
// was (on real data most "used" items matched only by substring). Evidence is now
// structural: a skill is used when the Skill tool was called with it (or a turn
// is attributed to it); a subagent when the Agent/Task tool named it as
// subagent_type.
//
// RC 2026-09-28: also returns what a /mo projection needs to know about the
// window's coverage — `firstDate`, the earliest local date of any transcript
// entry read (up to the window's end), and `olderData`, true when a transcript
// was last written before the window (so tracking began before it).
export function gatherEvidence({ sessions, dateFilter } = {}) {
  const skills = new Set();
  const agents = new Set();
  // QA-0928-20: turns PER MODEL. Reducing the window to one dominant model
  // priced every turn — unknown and partner-served ones included — at that
  // model's rate.
  const modelTurns = {};
  const seenTurns = new Set();
  let turns = 0;

  const visit = (entry, sessionId) => {
    const msg = entry.message && typeof entry.message === 'object' ? entry.message : null;
    if (!msg) return;

    // `<synthetic>` placeholders are not model turns (no API call, zero usage).
    if (msg.role === 'assistant' && msg.model !== '<synthetic>') {
      const key = msg.id != null ? String(msg.id) : `${sessionId}:${entry.timestamp}`;
      if (!seenTurns.has(key)) {
        seenTurns.add(key);
        turns++;
        if (msg.model) modelTurns[msg.model] = (modelTurns[msg.model] || 0) + 1;
      }
    }

    // Claude Code stamps a turn run under a skill with the skill's name.
    collect(skills, entry.attributionSkill);

    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      const inp = block.input || {};
      if (block.name === 'Skill') collect(skills, inp.skill);
      collect(agents, inp.subagent_type);   // the Agent (formerly Task) tool
    }
  };

  let firstDate = null, olderData = false;
  if (sessions) {
    for (const s of sessions) {
      for (const entry of s.entries || []) {
        const d = entry && entry.timestamp ? localDateOf(entry.timestamp) : null;
        if (d && (!dateFilter || d <= dateFilter.end) && (!firstDate || d < firstDate)) firstDate = d;
        visit(entry, s.session_id);
      }
    }
  } else {
    const scan = scanAssistantEntries(dateFilter, visit);
    firstDate = scan.firstDate || null;
    olderData = (scan.skipped || 0) > 0;
  }

  let model = null, best = -1;
  for (const [m, c] of Object.entries(modelTurns)) if (c > best) { best = c; model = m; }
  return { skills, agents, turns, modelTurns, model, firstDate, olderData };
}

function collect(set, v) { if (typeof v === 'string' && v.trim()) set.add(v.trim().toLowerCase()); }

// Invoked as `name`, or as a plugin-namespaced `plugin:name`.
function invoked(pool, name) {
  if (pool.has(name)) return true;
  for (const u of pool) if (u.endsWith(':' + name)) return true;
  return false;
}

// Which inventory ids have evidence of use. Exact matching only (see QA-0928-70
// above): a skill against Skill invocations, a subagent against subagent_type.
// A bare Set (the old shape) is treated as both pools, still matched exactly.
// CLAUDE.md rules are never judged: they are read every turn and cannot be
// invoked, so there is no invocation to find (QA-0928-71). No evidence =>
// REVIEW (not a confident "unused"); "never used ≠ never useful".
export function usedIdsFor(items, evidence) {
  const legacy = evidence instanceof Set;
  const skills = legacy ? evidence : (evidence?.skills || new Set());
  const agents = legacy ? evidence : (evidence?.agents || new Set());
  const used = new Set();
  for (const it of items) {
    if (it.type === 'rule') continue;
    const n = String(it.name || '').trim().toLowerCase();
    if (!n) continue;
    if (invoked(it.type === 'agent' ? agents : skills, n)) used.add(it.id);
  }
  return used;
}
