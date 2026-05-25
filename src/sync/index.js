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
    anonKey: config.supabase_anon_key || null,
    syncEnabled: config.sync_enabled || false,
    syncToken: config.sync_token || null,
  };
}

export async function syncToCloud() {
  const config = getConfig();
  const { url, anonKey } = getSupabaseConfig();

  if (!url || !anonKey) {
    throw new Error('Supabase not configured. Run: wtclaude sync --configure');
  }

  const anonymousId = getOrCreateAnonymousId();
  const lastSync = config.last_sync_at || '1970-01-01T00:00:00Z';

  const sessionIds = listSessions();
  const payload = [];

  for (const id of sessionIds) {
    const turns = readSession(id);
    if (turns.length === 0) continue;

    const newTurns = turns.filter(t => t.ts > lastSync);
    if (newTurns.length === 0) continue;

    const summary = summarizeTurns(turns);

    payload.push({
      session_id: id,
      turns: newTurns,
      summary: {
        ...summary,
        started_at: turns[0].ts,
        ended_at: turns[turns.length - 1].ts,
      },
    });
  }

  if (payload.length === 0) {
    return { synced: 0, message: 'Nothing new to sync' };
  }

  const response = await fetch(`${url}/functions/v1/sync-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${anonKey}`,
      'x-anonymous-id': anonymousId,
    },
    body: JSON.stringify({ sessions: payload }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sync failed (${response.status}): ${text}`);
  }

  const result = await response.json();

  config.last_sync_at = new Date().toISOString();
  config.sync_enabled = true;
  saveConfig(config);

  return result;
}
