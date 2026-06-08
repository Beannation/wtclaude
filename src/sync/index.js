import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CONFIG_FILE } from '../utils/paths.js';
import { listSessions, readSession, summarizeTurns } from '../utils/sessions.js';

export function getConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

// QA-BUG-08 hygiene: the CLI never uses a privileged service/secret key (all
// privileged writes happen server-side in the sync-data edge function under the
// publishable key + x-anonymous-id). A pre-Phase-C config may still carry the
// now-disabled legacy `service_role` JWT in plaintext. Strip any such dead secret
// key on setup/sync. The publishable key (sb_publishable_…) is browser-safe and
// is explicitly preserved.
const LEGACY_SECRET_KEYS = ['supabase_service_key', 'supabase_service_role_key', 'supabase_secret_key'];

// Remove legacy secret keys from a config object in place. Returns the list of
// keys actually removed (empty when there was nothing to strip).
export function stripLegacySecrets(config) {
  const removed = [];
  for (const k of LEGACY_SECRET_KEYS) {
    if (config[k] !== undefined) { delete config[k]; removed.push(k); }
  }
  return removed;
}

// Load → strip → save (only if something changed). Returns the removed keys so
// the caller can surface a one-line hygiene note. Never throws.
export function pruneLegacySecrets() {
  try {
    const config = getConfig();
    const removed = stripLegacySecrets(config);
    if (removed.length) saveConfig(config);
    return removed;
  } catch {
    return [];
  }
}

export function getOrCreateAnonymousId() {
  const config = getConfig();
  if (config.anonymous_id) return config.anonymous_id;

  config.anonymous_id = randomUUID();
  saveConfig(config);
  return config.anonymous_id;
}

export function getSupabaseConfig() {
  const config = getConfig();
  return {
    url: config.supabase_url || null,
    // Browser-safe PUBLISHABLE key (sb_publishable_…). The legacy
    // `supabase_anon_key` name is still accepted for backward compatibility,
    // but a privileged service/secret key must NEVER live in the CLI path —
    // all privileged writes happen server-side in the sync-data edge function.
    publishableKey: config.supabase_publishable_key || config.supabase_anon_key || null,
    syncEnabled: config.sync_enabled || false,
  };
}

// SEC Phase C: the CLI no longer talks to the REST table API with a service
// key. It POSTs a batch to the `sync-data` edge function, which holds the
// service-role key ONLY as a Supabase function secret and performs every
// privileged write. The CLI authenticates with the public publishable key
// plus the anonymous id — neither of which can bypass RLS.
export async function syncToCloud() {
  const config = getConfig();
  const sbConfig = getSupabaseConfig();

  if (!sbConfig.url || !sbConfig.publishableKey) {
    throw new Error('Supabase not configured. Run: wtclaude sync --configure');
  }

  const anonymousId = getOrCreateAnonymousId();
  const lastSync = config.last_sync_at || '1970-01-01T00:00:00Z';

  // Build the batch of sessions that have new turns since the last sync.
  // Session summary is computed over ALL turns (full running totals); only the
  // new turns are sent (the edge function ignores duplicate turn numbers).
  const sessionIds = listSessions();
  const sessionsPayload = [];

  for (const id of sessionIds) {
    const turns = readSession(id);
    if (turns.length === 0) continue;

    const newTurns = turns.filter((t) => t.ts > lastSync);
    if (newTurns.length === 0) continue;

    const summary = summarizeTurns(turns);
    summary.started_at = turns[0].ts;
    summary.ended_at = turns[turns.length - 1].ts;

    sessionsPayload.push({ session_id: id, summary, turns: newTurns });
  }

  if (sessionsPayload.length === 0) {
    config.last_sync_at = new Date().toISOString();
    config.sync_enabled = true;
    saveConfig(config);
    return { synced: 0, turns_synced: 0, message: 'Nothing new to sync' };
  }

  const response = await fetch(`${sbConfig.url}/functions/v1/sync-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sbConfig.publishableKey}`,
      'x-anonymous-id': anonymousId,
    },
    body: JSON.stringify({ sessions: sessionsPayload }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Sync failed (${response.status}): ${text}`);
  }

  const result = await response.json();

  config.last_sync_at = new Date().toISOString();
  config.sync_enabled = true;
  saveConfig(config);

  return {
    synced: result.synced ?? sessionsPayload.length,
    turns_synced: result.turns_synced ?? 0,
    message: result.message || `Synced ${sessionsPayload.length} session(s)`,
  };
}
