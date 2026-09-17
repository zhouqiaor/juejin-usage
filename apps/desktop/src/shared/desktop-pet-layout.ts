export const DESKTOP_PET_SOURCE_WIDTH = 192;
export const DESKTOP_PET_SOURCE_HEIGHT = 208;
/**
 * Bubble width floats with content inside [min, max] (fit-content in the
 * renderer); this constant is only the base/default used for the host window
 * footprint when the bubble is closed.
 */
export const DESKTOP_PET_POPOVER_WIDTH = 240;
export const DESKTOP_PET_POPOVER_MIN_WIDTH = 210;
export const DESKTOP_PET_POPOVER_MAX_WIDTH = 390;
/**
 * Headroom above the sprite for the two-row token bubble, its arrow, and the
 * gap above the sprite. Sized so the bubble stays inside the host window.
 */
export const DESKTOP_PET_POPOVER_TOP_SPACE = 116;
export const DESKTOP_PET_HORIZONTAL_GUTTER = 12;
/** Bubble/window may not get closer than this to any workArea edge. */
export const DESKTOP_PET_SCREEN_MARGIN_PX = 8;

export interface DesktopPetLayout {
  hostWidth: number;
  hostHeight: number;
  spriteWidth: number;
  spriteHeight: number;
  spriteLeft: number;
  spriteTop: number;
  popoverWidth: number;
  popoverTop: number;
}

export interface DesktopPetRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Single source of truth for the native host, sprite, and bubble centerline. */
export function getDesktopPetLayout(scale: number): DesktopPetLayout {
  const spriteWidth = Math.round(DESKTOP_PET_SOURCE_WIDTH * scale);
  const spriteHeight = Math.round(DESKTOP_PET_SOURCE_HEIGHT * scale);
  const topSpace = DESKTOP_PET_POPOVER_TOP_SPACE;
  const hostWidth = Math.max(
    spriteWidth,
    DESKTOP_PET_POPOVER_WIDTH + DESKTOP_PET_HORIZONTAL_GUTTER * 2,
  );

  return {
    hostWidth,
    hostHeight: spriteHeight + topSpace,
    spriteWidth,
    spriteHeight,
    spriteLeft: Math.round((hostWidth - spriteWidth) / 2),
    spriteTop: topSpace,
    popoverWidth: DESKTOP_PET_POPOVER_WIDTH,
    popoverTop: topSpace,
  };
}

/**
 * Constrain a renderer-measured content width to the legal bubble range.
 * Non-finite / non-positive input falls back to the default base width so a
 * bogus measurement can never collapse the bubble or the host window.
 */
export function clampBubbleWidth(desiredWidthPx: number): number {
  if (!Number.isFinite(desiredWidthPx) || desiredWidthPx <= 0) {
    return DESKTOP_PET_POPOVER_WIDTH;
  }
  return Math.round(
    Math.min(
      DESKTOP_PET_POPOVER_MAX_WIDTH,
      Math.max(DESKTOP_PET_POPOVER_MIN_WIDTH, desiredWidthPx),
    ),
  );
}

export interface BubbleBoundsRequest {
  /** Host footprint at the current scale with the bubble closed. */
  base: { width: number; height: number };
  /** Display work area (excludes taskbar / dock) the window lives in. */
  workArea: DesktopPetRectangle;
  /** Current native window bounds. */
  bounds: DesktopPetRectangle;
  /**
   * Renderer-measured bubble width already clamped via clampBubbleWidth.
   * `null` means the bubble is closed: the footprint collapses back to base.
   */
  bubbleWidth: number | null;
  /**
   * Renderer-measured bubble content height in px. 0 / non-finite means closed.
   */
  bubbleHeightPx: number;
  /** Layout popoverTop: height the base window already reserves for the bubble. */
  popoverTop: number;
  /** Gap between bubble bottom and sprite top (renderer/main must agree). */
  gapPx: number;
  /** Minimum gap kept between the window and every workArea edge. */
  screenMarginPx: number;
}

export interface ResolvedBubbleBounds extends DesktopPetRectangle {
  /**
   * Extra height granted over base.height after the workArea-top clamp. The
   * renderer turns a shortfall (wanted > granted) into an internal scroll
   * region.
   */
  grantedHeightExtra: number;
}

/**
 * Pure geometry for the transparent host while the merged bubble opens, grows
 * or closes:
 *
 * - **Horizontal**: width = max(base, bubble + 2 gutters); the window center is
 *   the sprite center (sprite is centered in the host), so x moves
 *   symmetrically. Near a left/right workArea edge the window is clamped
 *   inside the work area instead — the bubble arrow stays at 50% of the window
 *   and may then sit off the sprite center, mirroring the vertical top-clamp.
 * - **Vertical**: the window only grows upward (bottom edge / sprite position
 *   fixed); growth is capped so the top edge stays screenMarginPx below the
 *   work area top. Closing shrinks back to base.
 */
export function resolveBubbleWindowBounds(
  request: BubbleBoundsRequest,
): ResolvedBubbleBounds {
  const { base, workArea, bounds } = request;
  const open =
    request.bubbleWidth !== null
    && Number.isFinite(request.bubbleHeightPx)
    && request.bubbleHeightPx > 0;

  const targetWidth = open
    ? Math.max(base.width, Math.ceil(request.bubbleWidth as number) + DESKTOP_PET_HORIZONTAL_GUTTER * 2)
    : base.width;

  // Anchor on the current window centerline (= sprite centerline).
  const centerX = bounds.x + bounds.width / 2;
  const minX = workArea.x + request.screenMarginPx;
  const maxX = workArea.x + workArea.width - request.screenMarginPx - targetWidth;
  let x = Math.round(centerX - targetWidth / 2);
  x = maxX >= minX
    ? Math.min(Math.max(x, minX), maxX)
    : Math.round(workArea.x);

  const baseBubbleHeight = request.popoverTop - request.gapPx;
  const wantedExtra = open
    ? Math.max(0, Math.ceil(request.bubbleHeightPx - baseBubbleHeight))
    : 0;
  // Sprite bottom == window bottom; keep it fixed while growing upward.
  const bottom = bounds.y + bounds.height;
  const headroom = Math.max(
    0,
    bottom - base.height - workArea.y - request.screenMarginPx,
  );
  const grantedHeightExtra = Math.min(wantedExtra, headroom);
  const targetHeight = base.height + grantedHeightExtra;
  const workAreaBottom = workArea.y + workArea.height;
  const bottomLimit = workAreaBottom - targetHeight;
  let y: number;
  if (bottomLimit < workArea.y) {
    // Window taller than the work area itself: pin to the work area top.
    y = workArea.y;
  } else {
    // Anchor bottom, but never cross the top-margin floor or the bottom edge.
    const topLimit = workArea.y + request.screenMarginPx;
    y = Math.min(Math.max(bottom - targetHeight, topLimit), bottomLimit);
  }

  return { x, y, width: targetWidth, height: targetHeight, grantedHeightExtra };
}

export interface BubbleBodyClipRequest {
  /**
   * Natural (unclamped) content height of the bubble body wrapper, i.e. its
   * `scrollHeight` while a max-height may already be applied. Measuring the
   * clamped `offsetHeight` instead would deadlock the grow feedback loop.
   */
  naturalBodyHeightPx: number;
  /** Extra window height main actually granted (workArea-top clamp may cut it). */
  grantedHeightExtra: number;
  /** Layout popoverTop: height the base window already reserves for the bubble. */
  popoverTop: number;
  /** Gap between bubble bottom and sprite top. */
  gapPx: number;
  /** Bubble vertical padding (top + bottom), excluded from the body box. */
  verticalPaddingPx: number;
}

export interface BubbleBodyClip {
  /**
   * max-height for the body wrapper when physical space is insufficient, or
   * `null` when the grant covers the full natural height (no clamp, no scroll).
   */
  maxHeightPx: number | null;
  /** True only when the work area physically cannot fit the content. */
  needsScroll: boolean;
}

/**
 * Renderer-side half of the bubble height feedback loop. The window natively
 * reserves `popoverTop - gapPx` for the bubble; of that, the body box gets
 * `popoverTop - gapPx - verticalPaddingPx` (base capacity). Every granted px
 * adds one px of body capacity.
 *
 * The loop this closes: natural content > current window → renderer reports
 * scrollHeight → main grants extra upward growth → capacity reaches the
 * natural height → clamp removed → no scrollbar → stable (same-value reports
 * are deduped, so the loop converges). Scroll is kept solely for the case
 * where the work area physically runs out above the sprite.
 */
export function resolveBubbleBodyClip(request: BubbleBodyClipRequest): BubbleBodyClip {
  const baseCapacity = request.popoverTop - request.gapPx - request.verticalPaddingPx;
  const capacity = baseCapacity + Math.max(0, request.grantedHeightExtra);
  // 1px rounding slop: scrollHeight is an integer ceil, sub-pixel line boxes
  // must not leave a phantom scrollbar when the grant is mathematically exact.
  if (request.naturalBodyHeightPx <= capacity + 1) {
    return { maxHeightPx: null, needsScroll: false };
  }
  return { maxHeightPx: Math.max(0, Math.round(capacity)), needsScroll: true };
}
