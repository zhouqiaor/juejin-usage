// SPDX-License-Identifier: MIT
// shared/desktop-pet-layout.test.ts — 桌面宠物气泡尺寸区间与窗口几何纯逻辑（node:test）
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DESKTOP_PET_HORIZONTAL_GUTTER,
  DESKTOP_PET_POPOVER_MAX_WIDTH,
  DESKTOP_PET_POPOVER_MIN_WIDTH,
  DESKTOP_PET_POPOVER_WIDTH,
  DESKTOP_PET_SCREEN_MARGIN_PX,
  clampBubbleWidth,
  getDesktopPetLayout,
  resolveBubbleBodyClip,
  resolveBubbleWindowBounds,
  type BubbleBoundsRequest,
  type DesktopPetRectangle,
} from './desktop-pet-layout.js';

const workArea1080: DesktopPetRectangle = { x: 0, y: 0, width: 1920, height: 1040 };
const SCALE = 0.5;

function baseRequest(overrides: Partial<BubbleBoundsRequest> = {}): BubbleBoundsRequest {
  const layout = getDesktopPetLayout(SCALE);
  return {
    base: { width: layout.hostWidth, height: layout.hostHeight },
    workArea: workArea1080,
    bounds: { x: 1500, y: 800, width: layout.hostWidth, height: layout.hostHeight },
    bubbleWidth: null,
    bubbleHeightPx: 0,
    popoverTop: layout.popoverTop,
    gapPx: 8,
    screenMarginPx: DESKTOP_PET_SCREEN_MARGIN_PX,
    ...overrides,
  };
}

test('clampBubbleWidth: min floor / max cap / passthrough / bogus fallback', () => {
  assert.equal(clampBubbleWidth(100), DESKTOP_PET_POPOVER_MIN_WIDTH);
  assert.equal(clampBubbleWidth(-5), DESKTOP_PET_POPOVER_WIDTH);
  assert.equal(Number.isNaN(clampBubbleWidth(Number.NaN)), false);
  assert.equal(clampBubbleWidth(Number.NaN), DESKTOP_PET_POPOVER_WIDTH);
  assert.equal(clampBubbleWidth(0), DESKTOP_PET_POPOVER_WIDTH);
  assert.equal(clampBubbleWidth(210.4), 210);
  assert.equal(clampBubbleWidth(389.6), 390);
  assert.equal(clampBubbleWidth(9999), DESKTOP_PET_POPOVER_MAX_WIDTH);
});

test('closed bubble keeps the base footprint', () => {
  const req = baseRequest();
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.width, req.base.width);
  assert.equal(resolved.height, req.base.height);
  assert.equal(resolved.grantedHeightExtra, 0);
  // Center stays on the current window center.
  const center = req.bounds.x + req.bounds.width / 2;
  assert.equal(resolved.x + resolved.width / 2, center);
});

test('narrow content does not force the width past the base host width', () => {
  const req = baseRequest({
    bubbleWidth: clampBubbleWidth(60),
    bubbleHeightPx: 40,
  });
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.width, req.base.width);
});

test('width growth is symmetric around the sprite centerline', () => {
  const req = baseRequest({
    bubbleWidth: 360,
    bubbleHeightPx: 40,
  });
  const centerBefore = req.bounds.x + req.bounds.width / 2;
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.width, 360 + DESKTOP_PET_HORIZONTAL_GUTTER * 2);
  assert.equal(resolved.x + resolved.width / 2, centerBefore);
  // y/height untouched when content fits in the reserved head space.
  assert.equal(resolved.y, req.bounds.y);
  assert.equal(resolved.height, req.base.height);
  assert.equal(resolved.grantedHeightExtra, 0);
});

test('width shrink after wide content collapses symmetrically', () => {
  const grownWidth = 390 + DESKTOP_PET_HORIZONTAL_GUTTER * 2;
  const centerX = 900;
  const wideBounds = {
    x: centerX - grownWidth / 2,
    y: 700,
    width: grownWidth,
    height: getDesktopPetLayout(SCALE).hostHeight,
  };
  const req = baseRequest({ bounds: wideBounds, bubbleWidth: 250, bubbleHeightPx: 40 });
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.x + resolved.width / 2, centerX);
  assert.equal(resolved.width, Math.max(req.base.width, 250 + DESKTOP_PET_HORIZONTAL_GUTTER * 2));
});

test('right screen edge clamps x inside the work area instead of overflowing', () => {
  const layout = getDesktopPetLayout(SCALE);
  // Pet parked flush against the right edge of the work area at base width.
  const bounds = {
    x: workArea1080.width - layout.hostWidth,
    y: 900,
    width: layout.hostWidth,
    height: layout.hostHeight,
  };
  const req = baseRequest({ bounds, bubbleWidth: 390, bubbleHeightPx: 40 });
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(
    resolved.x + resolved.width,
    workArea1080.width - DESKTOP_PET_SCREEN_MARGIN_PX,
  );
});

test('left screen edge clamps x inside the work area instead of overflowing', () => {
  const layout = getDesktopPetLayout(SCALE);
  const bounds = { x: 0, y: 900, width: layout.hostWidth, height: layout.hostHeight };
  const req = baseRequest({ bounds, bubbleWidth: 390, bubbleHeightPx: 40 });
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.x, workArea1080.x + DESKTOP_PET_SCREEN_MARGIN_PX);
});

test('secondary display with a non-zero workArea origin is clamped against its own edges', () => {
  const workArea: DesktopPetRectangle = { x: 1920, y: 0, width: 1366, height: 728 };
  const req = baseRequest({
    workArea,
    bounds: { x: 1920, y: 600, width: getDesktopPetLayout(SCALE).hostWidth, height: getDesktopPetLayout(SCALE).hostHeight },
    bubbleWidth: 390,
    bubbleHeightPx: 40,
  });
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.x, workArea.x + DESKTOP_PET_SCREEN_MARGIN_PX);
});

test('height grows upward: bottom edge fixed, top clamped by work area', () => {
  const req = baseRequest({ bubbleWidth: 240, bubbleHeightPx: 300 });
  const bottom = req.bounds.y + req.bounds.height;
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.y + resolved.height, bottom);
  assert.ok(resolved.y >= workArea1080.y + DESKTOP_PET_SCREEN_MARGIN_PX);
  assert.equal(
    resolved.grantedHeightExtra,
    resolved.height - req.base.height,
  );
});

test('height grant is capped at available headroom (renderer scrolls)', () => {
  const layout = getDesktopPetLayout(SCALE);
  // Park the sprite bottom near the top of the work area: almost no headroom.
  const bounds = { x: 400, y: 20, width: layout.hostWidth, height: layout.hostHeight };
  const req = baseRequest({ bounds, bubbleWidth: 240, bubbleHeightPx: 500 });
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.y, workArea1080.y + DESKTOP_PET_SCREEN_MARGIN_PX);
  assert.ok(resolved.grantedHeightExtra < 500 - (layout.popoverTop - 8));
});

test('closing releases width and height while keeping the current center', () => {
  const grown = resolveBubbleWindowBounds(
    baseRequest({ bubbleWidth: 250, bubbleHeightPx: 260 }),
  );
  const req = baseRequest({
    bounds: { x: grown.x, y: grown.y, width: grown.width, height: grown.height },
  });
  const closed = resolveBubbleWindowBounds(req);
  assert.equal(closed.width, req.base.width);
  assert.equal(closed.height, req.base.height);
  assert.equal(closed.grantedHeightExtra, 0);
  assert.equal(closed.x + closed.width / 2, grown.x + grown.width / 2);
  assert.equal(closed.y + closed.height, grown.y + grown.height);
});

test('stale bounds below the work area bottom are pulled back inside (taskbar/drag)', () => {
  const layout = getDesktopPetLayout(SCALE);
  // Bottom edge 40px below the work area (e.g. taskbar grew, cursor-drag
  // past the screen edge) and the bubble closed: sprite bottom must come
  // back to the work area bottom without crossing the top margin.
  const bounds = { x: 400, y: workArea1080.height - layout.hostHeight + 40, width: layout.hostWidth, height: layout.hostHeight };
  const resolved = resolveBubbleWindowBounds(baseRequest({ bounds }));
  assert.equal(resolved.y + resolved.height, workArea1080.height);
  assert.ok(resolved.y >= workArea1080.y + DESKTOP_PET_SCREEN_MARGIN_PX - 1);
});

test('work area narrower than the footprint falls back without inverted ranges', () => {
  const req = baseRequest({
    workArea: { x: 0, y: 0, width: 100, height: 700 },
    bounds: { x: 0, y: 600, width: 264, height: 220 },
    bubbleWidth: 390,
    bubbleHeightPx: 300,
  });
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.x, 0);
  assert.ok(resolved.width > 0);
  assert.ok(resolved.height > 0);
});

// ---- 高度反馈环：自然高度（scrollHeight）→ main 准予 → max-height 解除 ----

const CLIP_BASE = {
  popoverTop: getDesktopPetLayout(SCALE).popoverTop, // 116
  gapPx: 8,
  verticalPaddingPx: 16,
};
// base body capacity = 116 - 8 - 16 = 92px; reserved bubble box = 116 - 8 = 108px.

test('body clip: content taller than the grant scrolls at the granted capacity', () => {
  const before = resolveBubbleBodyClip({
    ...CLIP_BASE,
    naturalBodyHeightPx: 616,
    grantedHeightExtra: 0,
  });
  assert.equal(before.needsScroll, true);
  assert.equal(before.maxHeightPx, 92);
  // workArea physically too small: partial grant still clips (16 providers × 2
  // lines parked near the screen top on a 768p display).
  const partial = resolveBubbleBodyClip({
    ...CLIP_BASE,
    naturalBodyHeightPx: 616,
    grantedHeightExtra: 300,
  });
  assert.equal(partial.needsScroll, true);
  assert.equal(partial.maxHeightPx, 392);
});

test('height feedback loop: natural content > window → grant grows → clamp removed → no scroll', () => {
  // 16 providers × 2 lines worst case: body natural 616px, bubble outer 632px.
  const naturalBody = 616;
  const wantedBubble = naturalBody + CLIP_BASE.verticalPaddingPx; // 632
  // First report lands against the default bounds on a 1080p work area.
  const req = baseRequest({ bubbleWidth: 240, bubbleHeightPx: wantedBubble });
  const resolved = resolveBubbleWindowBounds(req);
  // main grants the full ask (headroom above the sprite is sufficient).
  assert.equal(
    resolved.grantedHeightExtra,
    wantedBubble - (CLIP_BASE.popoverTop - CLIP_BASE.gapPx),
  );
  // Renderer re-evaluates with the grant: the clamp must disappear entirely.
  const after = resolveBubbleBodyClip({
    ...CLIP_BASE,
    naturalBodyHeightPx: naturalBody,
    grantedHeightExtra: resolved.grantedHeightExtra,
  });
  assert.equal(after.needsScroll, false);
  assert.equal(after.maxHeightPx, null);
});

test('body clip: 1px rounding slop does not leave a phantom scrollbar', () => {
  const exact = resolveBubbleBodyClip({
    ...CLIP_BASE,
    naturalBodyHeightPx: 93,
    grantedHeightExtra: 0, // capacity 92, scrollHeight integer-ceils to 93
  });
  assert.equal(exact.needsScroll, false);
  assert.equal(exact.maxHeightPx, null);
  const overflow = resolveBubbleBodyClip({
    ...CLIP_BASE,
    naturalBodyHeightPx: 94,
    grantedHeightExtra: 0,
  });
  assert.equal(overflow.needsScroll, true);
});

test('width constants widened 1.5x: 210 / 240 / 390 and base host width follows', () => {
  assert.equal(DESKTOP_PET_POPOVER_MIN_WIDTH, 210);
  assert.equal(DESKTOP_PET_POPOVER_WIDTH, 240);
  assert.equal(DESKTOP_PET_POPOVER_MAX_WIDTH, 390);
  const layout = getDesktopPetLayout(SCALE);
  assert.equal(layout.hostWidth, 240 + DESKTOP_PET_HORIZONTAL_GUTTER * 2);
});
