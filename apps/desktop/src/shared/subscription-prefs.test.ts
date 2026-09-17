// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SUBSCRIPTION_PREFS,
  enabledSubscriptionKeys,
  patchSubscriptionPrefs,
  resolveSubscriptionPrefs,
  sanitizeSubscriptionPrefs,
} from './subscription-prefs.js';

const STAMP = '2026-09-17T00:00:00.000Z';
const ALL_AVAILABLE = { cursor: true, minimax: true, ark: true } as const;
const NONE_AVAILABLE = { cursor: false, minimax: false, ark: false } as const;

test('默认 prefs 三家全关且无迁移戳记', () => {
  assert.deepEqual(DEFAULT_SUBSCRIPTION_PREFS, {
    cursor: false,
    minimax: false,
    ark: false,
    migratedAt: null,
  });
});

test('无 stored 时按可用性探测迁移并落戳（探测到即开）', () => {
  assert.deepEqual(
    resolveSubscriptionPrefs(null, ALL_AVAILABLE, STAMP),
    { cursor: true, minimax: true, ark: true, migratedAt: STAMP },
  );
  assert.deepEqual(
    resolveSubscriptionPrefs(undefined, { cursor: true, minimax: false, ark: true }, STAMP),
    { cursor: true, minimax: false, ark: true, migratedAt: STAMP },
  );
  assert.deepEqual(
    resolveSubscriptionPrefs({}, NONE_AVAILABLE, STAMP),
    { cursor: false, minimax: false, ark: false, migratedAt: STAMP },
  );
});

test('已迁移后严格尊重用户选择，可用性变化不回灌', () => {
  const stored = { cursor: false, minimax: true, ark: false, migratedAt: STAMP };
  // 用户关掉了 cursor（即使本机仍有登录态）、开着 minimax（即使凭据后来没了）：
  // 重新探测的结果必须被忽略。
  assert.deepEqual(
    resolveSubscriptionPrefs(stored, ALL_AVAILABLE, '2027-01-01T00:00:00.000Z'),
    stored,
  );
  assert.deepEqual(
    resolveSubscriptionPrefs(stored, NONE_AVAILABLE, STAMP),
    stored,
  );
});

test('脏字段清洗：非布尔按 false，戳记只接受非空字符串', () => {
  assert.deepEqual(
    sanitizeSubscriptionPrefs({ cursor: 'yes', minimax: 1, ark: true, migratedAt: '' }),
    { cursor: false, minimax: false, ark: true, migratedAt: null },
  );
  assert.equal(sanitizeSubscriptionPrefs(null), null);
  assert.equal(sanitizeSubscriptionPrefs('nope'), null);
  assert.equal(sanitizeSubscriptionPrefs({}), null);
  // 只有戳记也算已迁移（全关是合法用户选择）。
  assert.deepEqual(
    sanitizeSubscriptionPrefs({ migratedAt: STAMP }),
    { cursor: false, minimax: false, ark: false, migratedAt: STAMP },
  );
});

test('patch 只接受布尔局部更新；无实际变化返回 null；戳记不被 renderer 改写', () => {
  const current = { cursor: true, minimax: false, ark: false, migratedAt: STAMP };
  assert.deepEqual(
    patchSubscriptionPrefs(current, { ark: true }),
    { cursor: true, minimax: false, ark: true, migratedAt: STAMP },
  );
  assert.equal(patchSubscriptionPrefs(current, { cursor: true }), null);
  assert.equal(patchSubscriptionPrefs(current, { cursor: 'nope' }), null);
  assert.equal(patchSubscriptionPrefs(current, null), null);
  const tampered = patchSubscriptionPrefs(current, {
    minimax: true,
    migratedAt: '1970-01-01T00:00:00.000Z',
  });
  assert.equal(tampered?.migratedAt, STAMP);
  assert.equal(tampered?.minimax, true);
});

test('enabledSubscriptionKeys 只收三家且随开关变化', () => {
  assert.deepEqual(
    [...enabledSubscriptionKeys(DEFAULT_SUBSCRIPTION_PREFS)],
    [],
  );
  assert.deepEqual(
    [...enabledSubscriptionKeys({ cursor: true, minimax: false, ark: true, migratedAt: STAMP })],
    ['cursor', 'ark'],
  );
});
