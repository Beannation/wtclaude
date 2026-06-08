import { writeFileSync } from 'node:fs';
import { listSessions, readSession } from '../utils/sessions.js';
import { getConfig } from '../sync/index.js';

// `wtclaude export` — dump everything wtclaude holds locally about you, in one
// JSON bundle (good-faith privacy posture; pairs with anonymous-by-default). The
// stored data is already counts/flags + salted hashes only — no prompts, code,
// file names, or paths — so the export is safe to read. Secret credentials are
// redacted so a shared export can't leak keys.

const SECRET_KEYS = ['supabase_service_key', 'supabase_secret_key', 'supabase_anon_key', 'supabase_publishable_key'];

function sanitizeConfig(config) {
  const out = { ...config };
  for (const k of SECRET_KEYS) if (k in out) out[k] = '[redacted]';
  return out;
}

export function registerExport(program) {
  program
    .command('export')
    .description('Dump all local wtclaude data to JSON (everything we store about you)')
    .option('--out <file>', 'Write to a file instead of stdout')
    .option('--pretty', 'Pretty-print the JSON')
    .action((opts) => {
      const o = opts || {};
      const sessions = listSessions()
        .map(id => ({ session_id: id, turns: readSession(id) }))
        .filter(s => s.turns.length > 0);

      const bundle = {
        exported_at: new Date().toISOString(),
        tool: 'wtclaude',
        note: 'Local data only. Stored fields are counts/flags + salted hashes — no prompts, code, file names, or paths. Secrets redacted.',
        config: sanitizeConfig(getConfig()),
        session_count: sessions.length,
        turn_count: sessions.reduce((n, s) => n + s.turns.length, 0),
        sessions,
      };

      const json = JSON.stringify(bundle, null, o.pretty ? 2 : 0);
      if (o.out) {
        writeFileSync(o.out, json + '\n');
        console.log(`\n  Exported ${bundle.session_count} session(s) / ${bundle.turn_count} turn(s) to ${o.out}\n`);
      } else {
        console.log(json);
      }
    });
}
