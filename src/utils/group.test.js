import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayKey, deviceLabel } from './group.js';

// ── QA-0928-158: one label per device bucket, in every view ──────────────────

const CFG = { device_id: '11111111-1111-4111-8111-111111111111', device_label: 'laptop' };

test('deviceLabel: this machine by its label, others by id prefix, null as "(no device id)"', () => {
  assert.equal(deviceLabel(CFG.device_id, CFG), 'laptop (this device)');
  assert.equal(deviceLabel('22222222-2222-4222-8222-222222222222', CFG), 'device 22222222');
  assert.equal(deviceLabel(null, CFG), '(no device id)');
  assert.equal(deviceLabel(CFG.device_id, { device_id: CFG.device_id }), 'device 11111111 (this device)', 'no label configured');
});

test('displayKey(device) uses the same labels; never calls the null bucket "(this device)"', () => {
  assert.equal(displayKey(null, 'device', CFG), '(no device id)');
  assert.equal(displayKey(CFG.device_id, 'device', CFG), 'laptop (this device)');
  assert.equal(displayKey(null, 'branch', CFG), '(no branch)');
  assert.equal(displayKey('main', 'branch', CFG), 'main');
});
