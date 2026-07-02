import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { estimateTokens } from './tokens.js';

// Inventory of ALWAYS-LOADED prose Claude injects every session — skill and subagent
// DESCRIPTIONS and prose rule files (CLAUDE.md). We deliberately do NOT count tool /
// function DECLARATIONS: Anthropic already defers those (the "deferred tools" fetched
// via ToolSearch), so counting them would claim credit for a cost Anthropic already
// removed. Claude-only. Reads defensively (missing dir / new format => skip), since
// config-format churn is an ongoing reality.

function readText(p) { try { return readFileSync(p, 'utf8'); } catch { return null; } }

// Minimal YAML-frontmatter reader — pulls `name:` and `description:` (the injected
// advertising prose). No YAML dep; tolerant of missing fields.
function frontmatter(text) {
  const out = {};
  if (!text || !text.startsWith('---')) return out;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return out;
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^(name|description)\s*:\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

// The always-injected prose for a skill/agent = its name + description (what advertises
// it to the model every session), NOT its body or any tool schema.
function advertise(name, fm) { return `${fm.name || name}: ${fm.description || ''}`.trim(); }

function skillItems(dir, sourceLabel) {
  const items = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return items; }
  for (const e of entries) {
    let file = null;
    const rawName = e.name.replace(/\.md$/, '');
    if (e.isDirectory()) {
      file = [join(dir, e.name, 'SKILL.md'), join(dir, e.name, 'skill.md')].find(p => existsSync(p)) || null;
    } else if (e.name.endsWith('.md')) {
      file = join(dir, e.name);
    }
    if (!file) continue;
    const text = readText(file);
    if (text == null) continue;
    const fm = frontmatter(text);
    const name = fm.name || rawName;
    const prose = advertise(name, fm);
    items.push({ id: `skill:${name}`, type: 'skill', name, source: sourceLabel, text: prose, chars: prose.length, tokens: estimateTokens(prose) });
  }
  return items;
}

function agentItems(dir, sourceLabel) {
  const items = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return items; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const text = readText(join(dir, e.name));
    if (text == null) continue;
    const fm = frontmatter(text);
    const name = fm.name || e.name.replace(/\.md$/, '');
    const prose = advertise(name, fm);
    items.push({ id: `agent:${name}`, type: 'agent', name, source: sourceLabel, text: prose, chars: prose.length, tokens: estimateTokens(prose) });
  }
  return items;
}

// Plugins install their skills under ~/.claude/plugins/**/SKILL.md — those
// descriptions are injected every session just like top-level skills, so they are
// legitimate always-loaded prose. Walk defensively (bounded depth; skip node_modules
// /.git) so a big or oddly-shaped plugin tree can't stall or crash the scan.
function findSkillFiles(root, out, depth = 0) {
  if (depth > 6) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      findSkillFiles(join(root, e.name), out, depth + 1);
    } else if (/^skill\.md$/i.test(e.name)) {
      out.push(join(root, e.name));
    }
  }
}

function pluginSkillItems(pluginsDir, sourceLabel) {
  const files = [];
  findSkillFiles(pluginsDir, files);
  const items = [];
  for (const file of files) {
    const text = readText(file);
    if (text == null) continue;
    const fm = frontmatter(text);
    // Fall back to the containing folder name when frontmatter has no name.
    const folder = file.split('/').slice(-2, -1)[0] || 'skill';
    const name = fm.name || folder;
    const prose = advertise(name, fm);
    items.push({ id: `skill:${name}`, type: 'skill', name, source: sourceLabel, text: prose, chars: prose.length, tokens: estimateTokens(prose) });
  }
  return items;
}

function ruleItem(path, name, sourceLabel) {
  const text = readText(path);
  if (text == null || !text.trim()) return null;
  return { id: `rule:${name}`, type: 'rule', name, source: sourceLabel, text, chars: text.length, tokens: estimateTokens(text) };
}

// Scan the always-loaded prose inventory. `baseDir`/`projectDir` are injectable for
// tests (default: ~/.claude and the current project).
export function scanInventory({ baseDir, projectDir } = {}) {
  const base = baseDir || join(homedir(), '.claude');
  const proj = projectDir || process.cwd();
  const items = [];

  items.push(...skillItems(join(base, 'skills'), '~/.claude/skills'));
  items.push(...skillItems(join(proj, '.claude', 'skills'), './.claude/skills'));
  items.push(...pluginSkillItems(join(base, 'plugins'), '~/.claude/plugins'));
  items.push(...agentItems(join(base, 'agents'), '~/.claude/agents'));
  items.push(...agentItems(join(proj, '.claude', 'agents'), './.claude/agents'));

  const userRule = ruleItem(join(base, 'CLAUDE.md'), 'CLAUDE.md (user)', '~/.claude');
  if (userRule) items.push(userRule);
  const projRule = ruleItem(join(proj, 'CLAUDE.md'), 'CLAUDE.md (project)', './');
  if (projRule) items.push(projRule);

  // De-dupe by id (a project item can shadow a user item of the same name).
  const seen = new Set();
  return items.filter(it => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}
