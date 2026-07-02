// Token-size estimator for always-loaded prose (feature D). Deliberately NOT the
// crude chars/3.7 constant other tools use — it is word-aware (English BPE averages
// ~1.3 tokens/word) with a char-density floor for dense/non-spaced text. It is
// LABELED an estimate everywhere it surfaces. The dead-weight COST built on it is
// grounded in billing-grade inputs (your real per-turn cache-read count, the model's
// real input rate, and the exact 10% cache-read multiplier); only the per-item token
// SIZE is estimated. We never parade the size as exact.
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text).trim();
  if (!s) return 0;
  const words = s.split(/\s+/).filter(Boolean).length;
  return Math.max(Math.ceil(words * 1.3), Math.ceil(s.length / 4));
}
