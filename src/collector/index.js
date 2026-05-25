#!/usr/bin/env node

// The statusline collector. Claude Code pipes JSON to this script on every
// status update. It computes per-turn deltas from cumulative totals and
// appends a record to ~/.wtclaude/sessions/{session_id}.ndjson.

import { readFileSync, appendFileSync } from 'node:fs';
import { ensureDataDirs, sessionPath } from '../utils/paths.js';
import { computeTurnCost, formatCost, formatTokens } from '../utils/cost.js';

function readStdin() {
  return readFileSync(0, 'utf8').trim();
}

function getLastRecord(sessionFile) {
  let data;
  try {
    data = readFileSync(sessionFile, 'utf8');
  } catch {
    return null;
  }

  const lines = data.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1]);
}

function run() {
  let raw;
  try {
    raw = readStdin();
  } catch {
    process.exit(0);
  }

  if (!raw) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const sessionId = payload.session_id;
  if (!sessionId) process.exit(0);

  ensureDataDirs();

  const file = sessionPath(sessionId);
  const prev = getLastRecord(file);

  const cumulativeInput = payload.total_input_tokens ?? 0;
  const cumulativeOutput = payload.total_output_tokens ?? 0;
  const cumulativeCacheRead = payload.cache_read_input_tokens ?? 0;
  const cumulativeCacheWrite = payload.cache_creation_input_tokens ?? 0;

  let deltaInput, deltaOutput, deltaCacheRead, deltaCacheWrite, turn;

  if (prev) {
    deltaInput = Math.max(0, cumulativeInput - prev.cumulative_input);
    deltaOutput = Math.max(0, cumulativeOutput - prev.cumulative_output);
    deltaCacheRead = Math.max(0, cumulativeCacheRead - prev.cumulative_cache_read);
    deltaCacheWrite = Math.max(0, cumulativeCacheWrite - prev.cumulative_cache_write);
    turn = prev.turn + 1;

    // Skip if nothing changed (duplicate status update)
    if (deltaInput === 0 && deltaOutput === 0 && deltaCacheRead === 0 && deltaCacheWrite === 0) {
      outputStatus(prev, cumulativeInput + cumulativeCacheRead + cumulativeCacheWrite);
      process.exit(0);
    }
  } else {
    // First update for this session — cumulative IS the first turn
    deltaInput = cumulativeInput;
    deltaOutput = cumulativeOutput;
    deltaCacheRead = cumulativeCacheRead;
    deltaCacheWrite = cumulativeCacheWrite;
    turn = 1;
  }

  const record = {
    ts: new Date().toISOString(),
    session_id: sessionId,
    turn,
    model: payload.model ?? 'unknown',
    input_tokens: deltaInput,
    output_tokens: deltaOutput,
    cache_read_tokens: deltaCacheRead,
    cache_write_tokens: deltaCacheWrite,
    cumulative_input: cumulativeInput,
    cumulative_output: cumulativeOutput,
    cumulative_cache_read: cumulativeCacheRead,
    cumulative_cache_write: cumulativeCacheWrite,
    used_percentage: payload.used_percentage ?? null,
  };

  appendFileSync(file, JSON.stringify(record) + '\n');

  const totalTokens = cumulativeInput + cumulativeOutput + cumulativeCacheRead + cumulativeCacheWrite;
  outputStatus(record, totalTokens);
}

function outputStatus(record, totalTokens) {
  const cost = computeSessionCost(record);
  process.stdout.write(`${formatCost(cost)} | ${formatTokens(totalTokens)} tok`);
}

function computeSessionCost(latestRecord) {
  let file;
  try {
    file = readFileSync(sessionPath(latestRecord.session_id), 'utf8');
  } catch {
    return 0;
  }

  let total = 0;
  for (const line of file.trim().split('\n')) {
    if (!line) continue;
    const rec = JSON.parse(line);
    total += computeTurnCost(rec);
  }
  return total;
}

run();
