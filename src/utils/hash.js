import { createHash, randomBytes, randomUUID } from 'node:crypto';

// Single source of truth for the salted project/edit hashing (BUILD-025 / R-14).
// The collector salts project_hash (and would salt edit_target_hash) with this;
// `setup` generates and persists the per-install salt the collector reads. The
// algorithm is byte-identical to the collector's original inline version so
// existing per-install hashes are stable.
//
// PRIVACY: the salted hash is one-way and the raw value (a cwd) is NEVER stored.
// A per-install random salt (not the global 'wtclaude' fallback) makes the hash
// non-correlatable across users — the reason this is a hard gate before sync.
export function saltedHash(salt, value) {
  return createHash('sha256')
    .update(String(salt || '') + ' ' + String(value))
    .digest('hex')
    .slice(0, 12);
}

// A cryptographically-random per-install salt (32 hex chars / 16 bytes).
export function generateSalt() {
  return randomBytes(16).toString('hex');
}

// Per-install identifiers.
export function newId() {
  return randomUUID();
}
