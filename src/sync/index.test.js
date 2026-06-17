import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate against a throwaway data dir — paths.js reads WTCLAUDE_DIR at module
// load, so set it BEFORE the first (dynamic) import of the sync module. Also
// neutralize any background-sync spawn just in case.
const DIR = mkdtempSync(join(tmpdir(), 'wtclaude-sync-'));
process.env.WTCLAUDE_DIR = DIR;
process.env.WTCLAUDE_AUTOSYNC_CHILD = '1';
const CONFIG = join(DIR, 'config.json');
const SESSIONS = join(DIR, 'sessions');

const {
  getSupabaseConfig,
  syncToCloud,
  pruneLegacySecrets,
  HOSTED_SUPABASE_URL,
  HOSTED_PUBLISHABLE_KEY,
} = await import('./index.js');

function writeConfig(obj) { writeFileSync(CONFIG, JSON.stringify(obj, null, 2)); }
function readConfig() { return existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {}; }

beforeEach(() => {
  rmSync(CONFIG, { force: true });
  rmSync(SESSIONS, { recursive: true, force: true });
});

after(() => rmSync(DIR, { recursive: true, force: true }));

// ── A1: hosted defaults shipped ──────────────────────────────────────────────

test('hosted defaults are present when config is empty', () => {
  const cfg = getSupabaseConfig();
  assert.equal(cfg.url, HOSTED_SUPABASE_URL);
  assert.equal(cfg.publishableKey, HOSTED_PUBLISHABLE_KEY);
  assert.equal(cfg.syncEnabled, false, 'shipping creds must NOT imply opt-in');
  assert.ok(HOSTED_SUPABASE_URL.startsWith('https://'), 'hosted URL is https');
});

test('the shipped key is a browser-safe PUBLISHABLE key, never a secret key', () => {
  // Ship-safety invariant: a secret/service key must never live in the CLI.
  assert.ok(HOSTED_PUBLISHABLE_KEY.startsWith('sb_publishable_'));
  assert.ok(!HOSTED_PUBLISHABLE_KEY.startsWith('sb_secret_'));
  assert.ok(!/service[_-]?role/i.test(HOSTED_PUBLISHABLE_KEY));
});

test('user config overrides the hosted defaults (advanced / self-host)', () => {
  writeConfig({ supabase_url: 'https://self.example.co', supabase_publishable_key: 'sb_publishable_self' });
  const cfg = getSupabaseConfig();
  assert.equal(cfg.url, 'https://self.example.co');
  assert.equal(cfg.publishableKey, 'sb_publishable_self');
});

test('the legacy supabase_anon_key name still maps to publishableKey', () => {
  writeConfig({ supabase_anon_key: 'sb_publishable_legacy' });
  assert.equal(getSupabaseConfig().publishableKey, 'sb_publishable_legacy');
});

// ── A3: syncToCloud() must never flip the opt-in (consent gap fix) ────────────

test('syncToCloud() does not flip sync_enabled (false stays false)', async () => {
  writeConfig({ sync_enabled: false });
  const res = await syncToCloud(); // no sessions → "Nothing new to sync", no network
  assert.equal(res.synced, 0);
  const cfg = readConfig();
  assert.equal(cfg.sync_enabled, false, 'sync must never silently enable itself');
  assert.ok(cfg.last_sync_at, 'last_sync_at is still recorded');
});

test('syncToCloud() leaves sync_enabled untouched (true stays true)', async () => {
  writeConfig({ sync_enabled: true });
  await syncToCloud();
  assert.equal(readConfig().sync_enabled, true);
});

test('syncToCloud() does not introduce sync_enabled when it is absent', async () => {
  writeConfig({}); // no sync_enabled key at all
  await syncToCloud();
  assert.equal(readConfig().sync_enabled, undefined, 'must not add sync_enabled as a side effect');
});

// ── hygiene preserved: legacy-secret pruning still strips, key still kept ─────

test('pruneLegacySecrets strips a legacy secret key but keeps the publishable key', () => {
  writeConfig({
    supabase_secret_key: 'sb_secret_should_be_gone',
    supabase_publishable_key: 'sb_publishable_keep',
    sync_enabled: true,
  });
  const removed = pruneLegacySecrets();
  assert.deepEqual(removed, ['supabase_secret_key']);
  const cfg = readConfig();
  assert.equal(cfg.supabase_secret_key, undefined);
  assert.equal(cfg.supabase_publishable_key, 'sb_publishable_keep');
  assert.equal(cfg.sync_enabled, true, 'pruning must not touch the opt-in flag');
});
