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

// ---- 跨显示器 / 堆叠屏（非零 / 负 workArea 原点）----
// scale 0.5 layout: host 264x220, popoverTop 116, reserved bubble box 108.

const GROWN_WIDTH = 390 + DESKTOP_PET_HORIZONTAL_GUTTER * 2; // 414
const M = DESKTOP_PET_SCREEN_MARGIN_PX;

test('secondary display (+x origin): growth clamps against that display\'s right edge', () => {
  const workArea: DesktopPetRectangle = { x: 1920, y: 0, width: 1366, height: 728 };
  const layout = getDesktopPetLayout(SCALE);
  // Parked flush against the secondary display right edge at base width.
  const bounds = {
    x: workArea.x + workArea.width - layout.hostWidth,
    y: 600,
    width: layout.hostWidth,
    height: layout.hostHeight,
  };
  const resolved = resolveBubbleWindowBounds(
    baseRequest({ workArea, bounds, bubbleWidth: 390, bubbleHeightPx: 40 }),
  );
  assert.equal(resolved.x + resolved.width, workArea.x + workArea.width - M);
  assert.ok(resolved.x >= workArea.x + M);
});

test('secondary display (+x, +y origin): vertical top clamp uses the offset origin', () => {
  const workArea: DesktopPetRectangle = { x: 1920, y: 100, width: 1366, height: 628 };
  const layout = getDesktopPetLayout(SCALE);
  // Sprite parked near the offset top: only 12px headroom.
  const bounds = { x: 2200, y: workArea.y + 20, width: layout.hostWidth, height: layout.hostHeight };
  const resolved = resolveBubbleWindowBounds(
    baseRequest({ workArea, bounds, bubbleWidth: 240, bubbleHeightPx: 500 }),
  );
  assert.equal(resolved.y, workArea.y + M);
  assert.ok(resolved.grantedHeightExtra > 0);
  assert.ok(resolved.grantedHeightExtra < 500 - (layout.popoverTop - 8));
});

test('stacked display (-y origin): top clamp and bottom pull-back use negative coordinates', () => {
  // Monitor stacked above the primary: its bottom edge is y=0.
  const workArea: DesktopPetRectangle = { x: 0, y: -1080, width: 1920, height: 1080 };
  const layout = getDesktopPetLayout(SCALE);

  // Near the top edge: growth truncated to the 12px headroom, y pinned to -1072.
  const nearTop = { x: 400, y: -1060, width: layout.hostWidth, height: layout.hostHeight };
  const topResolved = resolveBubbleWindowBounds(
    baseRequest({ workArea, bounds: nearTop, bubbleWidth: 240, bubbleHeightPx: 300 }),
  );
  assert.equal(topResolved.y, workArea.y + M);
  assert.equal(topResolved.grantedHeightExtra, 12);
  assert.equal(topResolved.y + topResolved.height, nearTop.y + nearTop.height);

  // Near the bottom edge (y=0 seam): full grant, bottom stays fixed at 0.
  const nearBottom = { x: 400, y: -220, width: layout.hostWidth, height: layout.hostHeight };
  const bottomResolved = resolveBubbleWindowBounds(
    baseRequest({ workArea, bounds: nearBottom, bubbleWidth: 240, bubbleHeightPx: 300 }),
  );
  assert.equal(bottomResolved.grantedHeightExtra, 192);
  assert.equal(bottomResolved.y + bottomResolved.height, 0);
});

test('left-of-primary display (-x origin): left/right clamps stay on that display', () => {
  const workArea: DesktopPetRectangle = { x: -1920, y: 0, width: 1920, height: 1080 };
  const layout = getDesktopPetLayout(SCALE);

  const flushLeft = { x: workArea.x, y: 800, width: layout.hostWidth, height: layout.hostHeight };
  const leftResolved = resolveBubbleWindowBounds(
    baseRequest({ workArea, bounds: flushLeft, bubbleWidth: 390, bubbleHeightPx: 40 }),
  );
  assert.equal(leftResolved.x, workArea.x + M);

  const flushRight = {
    x: workArea.x + workArea.width - layout.hostWidth,
    y: 800,
    width: layout.hostWidth,
    height: layout.hostHeight,
  };
  const rightResolved = resolveBubbleWindowBounds(
    baseRequest({ workArea, bounds: flushRight, bubbleWidth: 390, bubbleHeightPx: 40 }),
  );
  assert.equal(rightResolved.x + rightResolved.width, workArea.x + workArea.width - M);
  assert.equal(rightResolved.x + rightResolved.width, -M);
});

test('diagonally stacked display (-x, -y origin): both axes clamp with negative origins', () => {
  const workArea: DesktopPetRectangle = { x: -1920, y: -1080, width: 1920, height: 1080 };
  const layout = getDesktopPetLayout(SCALE);
  // Upper-left corner of that display: base window parked flush on both edges.
  const bounds = { x: workArea.x, y: workArea.y, width: layout.hostWidth, height: layout.hostHeight };
  const resolved = resolveBubbleWindowBounds(
    baseRequest({ workArea, bounds, bubbleWidth: 390, bubbleHeightPx: 500 }),
  );
  assert.equal(resolved.x, workArea.x + M);
  assert.equal(resolved.y, workArea.y + M);
  assert.ok(resolved.x + resolved.width <= workArea.x + workArea.width - M);
});

// ---- 窗口中心恰在 workArea 边界：边界内外各 1px 不抖、不越界 ----

test('window center exactly at the horizontal clamp boundary is stable; +/-1px clamps', () => {
  const layout = getDesktopPetLayout(SCALE);
  // Centerline for which raw x lands exactly on minX=8: center = 8 + 414/2 = 215.
  const exactLeftBounds = {
    x: 8 + GROWN_WIDTH / 2 - layout.hostWidth / 2,
    y: 800,
    width: layout.hostWidth,
    height: layout.hostHeight,
  };
  const exact = resolveBubbleWindowBounds(
    baseRequest({ bounds: exactLeftBounds, bubbleWidth: 390, bubbleHeightPx: 40 }),
  );
  assert.equal(exact.x, M);
  const oneBeyond = { ...exactLeftBounds, x: exactLeftBounds.x - 1 };
  assert.equal(
    resolveBubbleWindowBounds(baseRequest({ bounds: oneBeyond, bubbleWidth: 390, bubbleHeightPx: 40 })).x,
    M,
  );

  // Exact right boundary: raw x == maxX = 1920-8-414 = 1498, center = 1705.
  const exactRightBounds = {
    x: 1498 + GROWN_WIDTH / 2 - layout.hostWidth / 2,
    y: 800,
    width: layout.hostWidth,
    height: layout.hostHeight,
  };
  const exactRight = resolveBubbleWindowBounds(
    baseRequest({ bounds: exactRightBounds, bubbleWidth: 390, bubbleHeightPx: 40 }),
  );
  assert.equal(exactRight.x, 1498);
  assert.equal(exactRight.x + exactRight.width, 1920 - M);
  const onePastRight = { ...exactRightBounds, x: exactRightBounds.x + 1 };
  const past = resolveBubbleWindowBounds(
    baseRequest({ bounds: onePastRight, bubbleWidth: 390, bubbleHeightPx: 40 }),
  );
  assert.equal(past.x + past.width, 1920 - M);
});

test('window growth exactly reaching the top/bottom margin is stable; 1px less is clamped', () => {
  // Bubble 300 -> wantedExtra 192 -> targetHeight 412.
  // Exact top: bottom = 8 + 412 = 420 -> bounds y = 200.
  const exactTopBounds = { x: 400, y: 200, width: 264, height: 220 };
  const exactTop = resolveBubbleWindowBounds(
    baseRequest({ bounds: exactTopBounds, bubbleWidth: 240, bubbleHeightPx: 300 }),
  );
  assert.equal(exactTop.y, M);
  assert.equal(exactTop.grantedHeightExtra, 192);
  // One px less headroom: grant is truncated rather than overflowing the margin.
  const tighter = { ...exactTopBounds, y: 199 };
  const tightResolved = resolveBubbleWindowBounds(
    baseRequest({ bounds: tighter, bubbleWidth: 240, bubbleHeightPx: 300 }),
  );
  assert.equal(tightResolved.y, M);
  assert.equal(tightResolved.grantedHeightExtra, 191);

  // Exact bottom: bottom = 1040 -> y = 1040-412 = 628 == bottomLimit.
  const exactBottomBounds = { x: 400, y: 820, width: 264, height: 220 };
  const exactBottom = resolveBubbleWindowBounds(
    baseRequest({ bounds: exactBottomBounds, bubbleWidth: 240, bubbleHeightPx: 300 }),
  );
  assert.equal(exactBottom.y, 628);
  assert.equal(exactBottom.y + exactBottom.height, 1040);
  const pastBottom = { ...exactBottomBounds, y: 821 };
  const past = resolveBubbleWindowBounds(
    baseRequest({ bounds: pastBottom, bubbleWidth: 240, bubbleHeightPx: 300 }),
  );
  assert.equal(past.y + past.height, 1040);
});

test('work area narrower than the target on a negative-x display pins x to its origin', () => {
  const workArea: DesktopPetRectangle = { x: -1920, y: 0, width: 200, height: 700 };
  const req = baseRequest({
    workArea,
    bounds: { x: -1850, y: 600, width: 264, height: 220 },
    bubbleWidth: 390,
    bubbleHeightPx: 300,
  });
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.x, workArea.x);
  assert.ok(resolved.width > 0);
});

test('work area shorter than the target window pins y to the work area top', () => {
  const workArea: DesktopPetRectangle = { x: 0, y: 0, width: 800, height: 200 };
  const req = baseRequest({
    workArea,
    bounds: { x: 300, y: 100, width: 264, height: 220 },
    bubbleWidth: 240,
    bubbleHeightPx: 500,
  });
  const resolved = resolveBubbleWindowBounds(req);
  // bottomLimit = 200 - targetHeight < 0 < workArea.y -> pin to top.
  assert.equal(resolved.y, 0);
  assert.ok(resolved.height > workArea.height);
});

// ---- 气泡关闭：严格回到 base rect ----

test('bubbleWidth=null collapses strictly back to the base rect from grown bounds', () => {
  const grown = resolveBubbleWindowBounds(
    baseRequest({ bubbleWidth: 390, bubbleHeightPx: 500 }),
  );
  assert.notEqual(grown.width, 264);
  assert.notEqual(grown.height, 220);
  const req = baseRequest({
    bounds: { x: grown.x, y: grown.y, width: grown.width, height: grown.height },
  });
  const closed = resolveBubbleWindowBounds(req);
  assert.equal(closed.width, req.base.width);
  assert.equal(closed.height, req.base.height);
  assert.equal(closed.grantedHeightExtra, 0);
  assert.equal(closed.x + closed.width / 2, grown.x + grown.width / 2);
});

test('bubbleWidth=null means closed even when a stale positive bubbleHeightPx arrives', () => {
  const req = baseRequest({ bubbleWidth: null, bubbleHeightPx: 400 });
  const resolved = resolveBubbleWindowBounds(req);
  assert.equal(resolved.width, req.base.width);
  assert.equal(resolved.height, req.base.height);
  assert.equal(resolved.grantedHeightExtra, 0);
});

// ---- 漂移 / 反馈环：输出喂回输入，必须收敛、不振荡、不越界 ----

/** Feed each resolved rect back as the next native bounds (main <-> OS round-trip). */
function iterateBounds(
  request: BubbleBoundsRequest,
  steps: number,
): Array<{ x: number; y: number; width: number; height: number; grantedHeightExtra: number }> {
  const out = [];
  let bounds: DesktopPetRectangle = { ...request.bounds };
  for (let i = 0; i < steps; i += 1) {
    const resolved = resolveBubbleWindowBounds({ ...request, bounds });
    out.push(resolved);
    bounds = { x: resolved.x, y: resolved.y, width: resolved.width, height: resolved.height };
  }
  return out;
}

function assertInsideWorkArea(
  r: { x: number; y: number; width: number; height: number },
  workArea: DesktopPetRectangle,
  allowOverflow = false,
): void {
  if (!allowOverflow) {
    assert.ok(r.x >= workArea.x + M - 1, `x ${r.x} left of ${workArea.x + M}`);
    assert.ok(r.y >= workArea.y + M - 1, `y ${r.y} above ${workArea.y + M}`);
    assert.ok(r.x + r.width <= workArea.x + workArea.width - M + 1);
    assert.ok(r.y + r.height <= workArea.y + workArea.height + 1);
  }
}

test('feedback converges to a fixed point at every edge on a negative-origin stacked display', () => {
  const workArea: DesktopPetRectangle = { x: -1920, y: -1080, width: 1920, height: 1080 };
  const cornerCases: Array<DesktopPetRectangle> = [
    { x: -1920, y: -1080, width: 264, height: 220 }, // upper-left
    { x: -264, y: -220, width: 264, height: 220 }, // lower-right seam
    { x: -1000, y: -600, width: 264, height: 220 }, // mid
  ];
  for (const bounds of cornerCases) {
    const seq = iterateBounds(
      baseRequest({ workArea, bounds, bubbleWidth: 390, bubbleHeightPx: 500 }),
      6,
    );
    for (const r of seq) assertInsideWorkArea(r, workArea);
    const last = seq[seq.length - 1];
    const prev = seq[seq.length - 2];
    assert.deepEqual(last, prev, 're-clamping the output must be a fixed point');
  }
});

test('feedback on a too-short work area shrinks monotonically to a fixed point (no oscillation)', () => {
  const workArea: DesktopPetRectangle = { x: 0, y: 0, width: 800, height: 200 };
  const seq = iterateBounds(
    baseRequest({
      workArea,
      bounds: { x: 300, y: 100, width: 264, height: 220 },
      bubbleWidth: 240,
      bubbleHeightPx: 500,
    }),
    15,
  );
  // Pinned to the top on every iteration; granted height may only shrink, never bounce.
  for (const r of seq) assert.equal(r.y, workArea.y);
  for (let i = 1; i < seq.length; i += 1) {
    assert.ok(seq[i].height <= seq[i - 1].height, 'height must be non-increasing');
  }
  const last = seq[seq.length - 1];
  assert.deepEqual(last, seq[seq.length - 2], 'must settle instead of oscillating');
  assert.ok(last.height > 0);
});

test('drifting bounds while the bubble is open never escape and settle once motion stops', () => {
  const workArea: DesktopPetRectangle = { x: -1920, y: -1080, width: 1920, height: 1080 };
  const layout = getDesktopPetLayout(SCALE);
  // Pet drifts up-left 24px/frame toward the upper-left corner of the stacked display.
  let bounds: DesktopPetRectangle = { x: -600, y: -500, width: layout.hostWidth, height: layout.hostHeight };
  const request = baseRequest({ workArea, bubbleWidth: 390, bubbleHeightPx: 500 });
  for (let frame = 0; frame < 20; frame += 1) {
    const resolved = resolveBubbleWindowBounds({ ...request, bounds });
    assertInsideWorkArea(resolved, workArea);
    // User/system keeps moving the sprite; the OS reports the clamped rect plus drift.
    bounds = {
      x: resolved.x - 24,
      y: resolved.y - 24,
      width: resolved.width,
      height: resolved.height,
    };
  }
  // Motion stops: one more resolve, then a re-resolve must already be a fixed point.
  const settled = resolveBubbleWindowBounds({ ...request, bounds });
  assertInsideWorkArea(settled, workArea);
  const again = resolveBubbleWindowBounds({
    ...request,
    bounds: { x: settled.x, y: settled.y, width: settled.width, height: settled.height },
  });
  assert.deepEqual(again, settled);
});

test('grantedHeightExtra is truncated at the top margin on a stacked display and converges', () => {
  const workArea: DesktopPetRectangle = { x: 0, y: -768, width: 1920, height: 768 };
  const layout = getDesktopPetLayout(SCALE);
  // Bottom fixed at the seam y=0; content wants 600px.
  const bounds = { x: 400, y: 0 - layout.hostHeight, width: layout.hostWidth, height: layout.hostHeight };
  const seq = iterateBounds(
    baseRequest({ workArea, bounds, bubbleWidth: 240, bubbleHeightPx: 600 }),
    4,
  );
  // Headroom = 768 - 220 - 8 = 540; wantedExtra = 600-108 = 492 -> full grant fits.
  assert.equal(seq[0].grantedHeightExtra, 492);
  assert.ok(seq[0].y >= workArea.y + M);
  assert.equal(seq[0].y + seq[0].height, 0); // bottom stays on the seam
  assert.deepEqual(seq[0], seq[seq.length - 1]);

  // Now park much closer to the top so the grant must be cut well below the ask.
  const tight = { x: 400, y: workArea.y + 40, width: layout.hostWidth, height: layout.hostHeight };
  const tightSeq = iterateBounds(
    baseRequest({ workArea, bounds: tight, bubbleWidth: 240, bubbleHeightPx: 600 }),
    4,
  );
  assert.equal(tightSeq[0].grantedHeightExtra, 32); // bottom(-708)-220-(-768)-8
  assert.equal(tightSeq[0].y, workArea.y + M);
  assert.deepEqual(tightSeq[0], tightSeq[tightSeq.length - 1]);
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
