import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

let _cached = null;

export function getLatestPricing() {
  if (_cached) return _cached;

  const files = readdirSync(CONFIG_DIR)
    .filter(f => f.startsWith('pricing-') && f.endsWith('.json'))
    .sort();

  const latest = files[files.length - 1];
  _cached = JSON.parse(readFileSync(join(CONFIG_DIR, latest), 'utf8'));
  return _cached;
}

export function getModelPricing(modelName) {
  const pricing = getLatestPricing();

  const normalized = modelName.toLowerCase().replace(/^claude-/, '');
  if (pricing.models[modelName]) return pricing.models[modelName];
  if (pricing.models[normalized]) return pricing.models[normalized];

  for (const key of Object.keys(pricing.models)) {
    if (modelName.includes(key) || key.includes(modelName)) {
      return pricing.models[key];
    }
  }

  return pricing.models['sonnet-4-6'];
}
