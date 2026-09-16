import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateQuotaAlerts,
  isQuotaAlertThreshold,
  quotaKey,
  type QuotaAlertStateEntry,
  type QuotaAlertThreshold,
  type QuotaWindow,
} from './pet-quota-alert.js';

const T0 = 1_000_000;
const COOLDOWN_MS = 30 * 60_000;

function window(
  usedPercent: number,
  resetsAt: number | null = null,
): QuotaWindow {
  return { provider: 'ark', id: 'plan-a', usedPercent, resetsAt };
}

function step(
  state: ReadonlyMap<string, QuotaAlertStateEntry>,
  usedPercent: number,
  nowMs: number,
  threshold: QuotaAlertThreshold = 90,
  cooldownMs = COOLDOWN_MS,
  resetsAt: number | null = null,
) {
  return evaluateQuotaAlerts(
    [{ provider: 'ark', id: 'plan-a', usedPercent, resetsAt }],
    { threshold, cooldownMs, nowMs, state },
  );
}

test('threshold value guard accepts only 80/90/95', () => {
  assert.equal(isQuotaAlertThreshold(80), true);
  assert.equal(isQuotaAlertThreshold(90), true);
  assert.equal(isQuotaAlertThreshold(95), true);
  assert.equal(isQuotaAlertThreshold(85), false);
  assert.equal(isQuotaAlertThreshold('90'), false);
});

test('first crossing at/over threshold fires exactly once', () => {
  let result = step(new Map(), 89, T0);
  assert.deepEqual(result.fired, []);
  assert.deepEqual(result.activeKeys, []);

  result = step(result.state, 90, T0 + 1000);
  assert.equal(result.fired.length, 1);
  assert.equal(result.fired[0]?.key, quotaKey('ark', 'plan-a'));
  assert.equal(result.fired[0]?.usedPercent, 90);
  assert.deepEqual(result.activeKeys, ['ark::plan-a']);

  // Still over threshold, later ticks must not re-fire.
  result = step(result.state, 94, T0 + 2000);
  assert.deepEqual(result.fired, []);
  assert.deepEqual(result.activeKeys, ['ark::plan-a']);
});

test('hysteresis band (threshold-5 .. threshold) never re-fires', () => {
  let result = step(new Map(), 95, T0);
  assert.equal(result.fired.length, 1);

  result = step(result.state, 87, T0 + 60_000);
  assert.deepEqual(result.fired, []);
  assert.deepEqual(result.activeKeys, ['ark::plan-a'], 'stays active inside the band');

  result = step(result.state, 92, T0 + 120_000);
  assert.deepEqual(result.fired, [], 'rising inside the band is not a new crossing');
});

test('release below the band re-arms and allows a later crossing to fire', () => {
  let result = step(new Map(), 95, T0);
  assert.equal(result.fired.length, 1);

  result = step(result.state, 84, T0 + 60_000);
  assert.deepEqual(result.fired, []);
  assert.deepEqual(result.activeKeys, [], 'released under 85');

  result = step(result.state, 91, T0 + COOLDOWN_MS + 1);
  assert.equal(result.fired.length, 1);
  assert.equal(result.fired[0]?.usedPercent, 91);
});

test('threshold 80 uses release band 75', () => {
  let result = step(new Map(), 80, T0, 80);
  assert.equal(result.fired.length, 1);

  result = step(result.state, 76, T0 + 1000, 80);
  assert.deepEqual(result.activeKeys, ['ark::plan-a'], '76 is inside the 75..80 band');

  result = step(result.state, 74, T0 + 2000, 80);
  assert.deepEqual(result.activeKeys, []);

  result = step(result.state, 81, T0 + COOLDOWN_MS + 1, 80);
  assert.equal(result.fired.length, 1);
});

test('cooldown blocks a re-cross that happens inside the cooldown window', () => {
  let result = step(new Map(), 95, T0);
  assert.equal(result.fired.length, 1);

  // Full release, then re-cross 10 minutes later (cooldown is 30).
  result = step(result.state, 80, T0 + 60_000);
  result = step(result.state, 93, T0 + 10 * 60_000);
  assert.deepEqual(result.fired, [], 'cooldown suppresses the re-cross');
  assert.deepEqual(result.activeKeys, ['ark::plan-a'], 'level is still active');

  // Once cooldown elapses while remaining high, the pending alert fires.
  result = step(result.state, 93, T0 + 31 * 60_000);
  assert.equal(result.fired.length, 1);
});

test('plan reset re-arms even without a percent release', () => {
  const resetAt = T0 + 60 * 60_000;
  let result = step(new Map(), 96, T0, 90, COOLDOWN_MS, resetAt);
  assert.equal(result.fired.length, 1);

  // New period began; percent still reported high by the feed, reset wins.
  result = step(result.state, 96, resetAt + 1000, 90, COOLDOWN_MS, resetAt);
  assert.equal(result.fired.length, 1);
  assert.equal(result.fired[0]?.resetsAt, resetAt);
});

test('stale feed repeating the same due resetsAt re-arms only once, past cooldown', () => {
  // Backend data lag: percent AND resetsAt never advance to the new window.
  const resetAt = T0 + 60 * 60_000;
  let result = step(new Map(), 96, T0, 90, COOLDOWN_MS, resetAt);
  assert.equal(result.fired.length, 1, 'crossing before the reset fires');

  // Reset becomes due; the one reset edge re-arms and fires a single time.
  result = step(result.state, 96, resetAt + 1000, 90, COOLDOWN_MS, resetAt);
  assert.equal(result.fired.length, 1, 'first sight of the due reset re-arms once');

  // Repeated 60s polls with the identical stale timestamp must stay silent…
  result = step(result.state, 96, resetAt + 60_000, 90, COOLDOWN_MS, resetAt);
  assert.deepEqual(result.fired, []);
  result = step(result.state, 96, resetAt + 2 * 60_000, 90, COOLDOWN_MS, resetAt);
  assert.deepEqual(result.fired, []);

  // …even long after the cooldown would have allowed a re-fire.
  result = step(
    result.state, 96, resetAt + COOLDOWN_MS + 60_000, 90, COOLDOWN_MS, resetAt,
  );
  assert.deepEqual(result.fired, [], 'stale reset must not punch through cooldown');
  assert.deepEqual(result.activeKeys, ['ark::plan-a'], 'level stays active');
});

test('a new distinct resetsAt value re-arms and may fire again for the next window', () => {
  const resetAt1 = T0 + 60 * 60_000;
  const resetAt2 = resetAt1 + 24 * 60 * 60_000;

  let result = step(new Map(), 96, T0, 90, COOLDOWN_MS, resetAt1);
  assert.equal(result.fired.length, 1);
  result = step(result.state, 96, resetAt1 + 1000, 90, COOLDOWN_MS, resetAt1);
  assert.equal(result.fired.length, 1);
  result = step(
    result.state, 96, resetAt1 + COOLDOWN_MS + 1, 90, COOLDOWN_MS, resetAt1,
  );
  assert.deepEqual(result.fired, [], 'old window stays quiet');

  // Feed catches up: a brand-new reset point becomes due → re-arm + fire.
  result = step(result.state, 96, resetAt2 + 1000, 90, COOLDOWN_MS, resetAt2);
  assert.equal(result.fired.length, 1, 'new window crossing fires');
  assert.equal(result.fired[0]?.resetsAt, resetAt2);

  // And the new timestamp is likewise single-shot under a stale feed.
  result = step(
    result.state, 96, resetAt2 + COOLDOWN_MS + 1, 90, COOLDOWN_MS, resetAt2,
  );
  assert.deepEqual(result.fired, []);
});

test('distinct provider:id windows are tracked independently', () => {
  const state = new Map();
  const result = evaluateQuotaAlerts(
    [
      { provider: 'ark', id: 'a', usedPercent: 92, resetsAt: null },
      { provider: 'ark', id: 'b', usedPercent: 40, resetsAt: null },
      { provider: 'kimi', id: 'a', usedPercent: 99, resetsAt: null },
    ],
    { threshold: 90, cooldownMs: COOLDOWN_MS, nowMs: T0, state },
  );
  assert.deepEqual(result.fired.map((item) => item.key).sort(), [
    'ark::a',
    'kimi::a',
  ]);
  assert.equal(result.state.size, 3);
});

test('invalid percent input: finite out-of-range clamps, non-finite is ignored', () => {
  const clamped = evaluateQuotaAlerts([window(102)], {
    threshold: 90, cooldownMs: COOLDOWN_MS, nowMs: T0, state: new Map(),
  });
  assert.equal(clamped.fired[0]?.usedPercent, 100);

  const negative = evaluateQuotaAlerts([window(-5)], {
    threshold: 90, cooldownMs: COOLDOWN_MS, nowMs: T0, state: new Map(),
  });
  assert.deepEqual(negative.fired, []);
  assert.deepEqual(negative.activeKeys, []);

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const ignored = evaluateQuotaAlerts([window(bad)], {
      threshold: 90, cooldownMs: COOLDOWN_MS, nowMs: T0, state: new Map(),
    });
    assert.deepEqual(ignored.fired, []);
    assert.equal(ignored.state.size, 0, `non-finite ${String(bad)} leaves no state`);
  }
});

test('windows absent from a batch drop out of state', () => {
  let result = step(new Map(), 95, T0);
  assert.equal(result.state.size, 1);
  result = evaluateQuotaAlerts([], {
    threshold: 90, cooldownMs: COOLDOWN_MS, nowMs: T0 + 1000, state: result.state,
  });
  assert.equal(result.state.size, 0);
});

test('invalid options throw', () => {
  assert.throws(() => evaluateQuotaAlerts([], {
    threshold: 85 as 90, cooldownMs: 1, nowMs: T0, state: new Map(),
  }), /threshold/);
  assert.throws(() => evaluateQuotaAlerts([], {
    threshold: 90, cooldownMs: -1, nowMs: T0, state: new Map(),
  }), /cooldownMs/);
});
