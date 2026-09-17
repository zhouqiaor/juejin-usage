// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStaleTooltip,
  formatHHmmss,
  formatMMddHHmm,
  formatRelativeUpdate,
  FRESHNESS_DANGER_COLOR,
  FRESHNESS_WARN_COLOR,
  freshnessAgeSec,
  freshnessColor,
  freshnessLevel,
  STALE_DANGER_AFTER_SEC,
} from './freshness.js';

const NOW = 1_758_000_000; // 固定 unix 秒，时间格式断言按本地时区换算

test('fresh snapshots stay at fresh level regardless of age', () => {
  assert.equal(freshnessLevel(false, NOW - 9_999, NOW), 'fresh');
  assert.equal(freshnessLevel(false, null, NOW), 'fresh');
  assert.equal(freshnessLevel(false, undefined, NOW), 'fresh');
  assert.equal(freshnessColor('fresh'), null);
});

test('stale under 5 minutes is amber warning', () => {
  assert.equal(freshnessLevel(true, NOW - 1, NOW), 'stale-warn');
  assert.equal(freshnessLevel(true, NOW - (STALE_DANGER_AFTER_SEC - 1), NOW), 'stale-warn');
  assert.equal(freshnessColor('stale-warn'), FRESHNESS_WARN_COLOR);
  assert.equal(FRESHNESS_WARN_COLOR, '#f59e0b');
});

test('stale at or over 5 minutes is red danger', () => {
  assert.equal(freshnessLevel(true, NOW - STALE_DANGER_AFTER_SEC, NOW), 'stale-danger');
  assert.equal(freshnessLevel(true, NOW - 1_800, NOW), 'stale-danger');
  assert.equal(freshnessColor('stale-danger'), FRESHNESS_DANGER_COLOR);
  assert.equal(FRESHNESS_DANGER_COLOR, '#f04142');
});

test('stale without fetchedAt degrades to warning, not danger', () => {
  assert.equal(freshnessLevel(true, null, NOW), 'stale-warn');
  assert.equal(freshnessLevel(true, undefined, NOW), 'stale-warn');
});

test('age is null without timestamp and clamps clock skew to zero', () => {
  assert.equal(freshnessAgeSec(null, NOW), null);
  assert.equal(freshnessAgeSec(undefined, NOW), null);
  assert.equal(freshnessAgeSec(NOW + 120, NOW), 0);
  assert.equal(freshnessAgeSec(NOW - 90, NOW), 90);
});

test('relative update text bucket boundaries', () => {
  assert.equal(formatRelativeUpdate(null, NOW), '');
  assert.equal(formatRelativeUpdate(undefined, NOW), '');
  assert.equal(formatRelativeUpdate(NOW, NOW), '刚刚更新');
  assert.equal(formatRelativeUpdate(NOW - 59, NOW), '刚刚更新');
  // 时钟漂移（未来时间戳）不当成过期
  assert.equal(formatRelativeUpdate(NOW + 30, NOW), '刚刚更新');
  assert.equal(formatRelativeUpdate(NOW - 60, NOW), '1 分钟前更新');
  assert.equal(formatRelativeUpdate(NOW - 119, NOW), '1 分钟前更新');
  assert.equal(formatRelativeUpdate(NOW - 3_599, NOW), '59 分钟前更新');
});

test('relative update falls back to absolute stamp after 60 minutes', () => {
  const text = formatRelativeUpdate(NOW - 3_600, NOW);
  assert.match(text, / 更新$/);
  assert.equal(text, `${formatMMddHHmm(NOW - 3_600)} 更新`);
  assert.equal(formatRelativeUpdate(NOW - 7_200, NOW), `${formatMMddHHmm(NOW - 7_200)} 更新`);
});

test('absolute formatters render local-time zero-padded strings', () => {
  const d = new Date((NOW - 5) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const wantHMS = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const wantMDHM = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  assert.equal(formatHHmmss(NOW - 5), wantHMS);
  assert.equal(formatMMddHHmm(NOW - 5), wantMDHM);
  assert.equal(formatHHmmss(null), '');
  assert.equal(formatMMddHHmm(undefined), '');
});

test('tooltip explains staleness, failure reason and retry hint', () => {
  const tip = buildStaleTooltip(NOW - 30, 'network timeout');
  assert.equal(
    tip,
    `数据更新于 ${formatMMddHHmm(NOW - 30)}，本次刷新失败：network timeout，点击重试`,
  );
});

test('tooltip omits failure clause when message missing or blank', () => {
  assert.equal(buildStaleTooltip(NOW, null), `数据更新于 ${formatMMddHHmm(NOW)}，点击重试`);
  assert.equal(buildStaleTooltip(NOW, '   '), `数据更新于 ${formatMMddHHmm(NOW)}，点击重试`);
});

test('tooltip falls back to unknown time without fetchedAt', () => {
  assert.equal(buildStaleTooltip(null, 'boom'), '数据更新时间未知，本次刷新失败：boom，点击重试');
});

test('tooltip omits retry hint when card does not expose retry', () => {
  assert.equal(
    buildStaleTooltip(NOW, 'network timeout', false),
    `数据更新于 ${formatMMddHHmm(NOW)}，本次刷新失败：network timeout`,
  );
});

test('tooltip truncates overlong failure messages', () => {
  const long = 'x'.repeat(80);
  const tip = buildStaleTooltip(NOW, long);
  assert.ok(tip.includes(`本次刷新失败：${'x'.repeat(40)}…`));
  assert.ok(!tip.includes('x'.repeat(41)));
});
