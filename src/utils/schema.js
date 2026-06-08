// Stable version marker stamped on every machine-readable (--json) output
// (QA-BUG-09 / SHOULD-PASS line 60). Scripts can branch on this without sniffing
// keys. Bump only on a breaking change to a --json shape; additive fields don't.
//
//   1.0  — first published CLI --json contract (today/week/month/session/blocks/
//          project/report/forecast/readiness/credits/quality/leaderboard/devices),
//          incl. the cost_basis honesty block.
export const SCHEMA_VERSION = '1.0';

// Convenience wrapper: stamp schema_version FIRST so it's the leading key.
export function withSchema(obj) {
  return { schema_version: SCHEMA_VERSION, ...obj };
}
