import { app, BrowserWindow, ipcMain, Menu, screen, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_DESKTOP_PET_FRAME_INTERVAL_MS,
  DEFAULT_DESKTOP_PET_QUOTA_ALERT_COOLDOWN_MIN,
  DEFAULT_DESKTOP_PET_QUOTA_ALERT_ENABLED,
  DEFAULT_DESKTOP_PET_QUOTA_ALERT_THRESHOLD,
  DEFAULT_DESKTOP_PET_QUOTA_BUBBLE_INTERVAL_MIN,
  DEFAULT_DESKTOP_PET_QUOTA_BUBBLE_MODE,
  DEFAULT_DESKTOP_PET_QUOTA_MOOD_ENABLED,
  DEFAULT_DESKTOP_PET_SCALE,
  isQuotaBubbleMode,
  loadDesktopPetPref,
  saveDesktopPetPref,
  type DesktopPetPref,
  type DesktopPetPosition,
} from './autostart';
import { isQuotaAlertThreshold } from '../shared/pet-quota-alert';
import { defaultPreloadPath } from './DesktopWindow';
import {
  clampBubbleWidth,
  DESKTOP_PET_SCREEN_MARGIN_PX,
  getDesktopPetLayout,
  resolveBubbleWindowBounds,
} from '../shared/desktop-pet-layout';
import {
  desktopPetDirectory,
  getDesktopPetSpritesheetUrl,
  isKnownDesktopPet,
  scanDesktopPets,
} from './DesktopPetCatalog';
import {
  fetchRemoteDesktopPets,
  installRemoteDesktopPet,
} from './desktop-pet-remote';
import type { DesktopPetDefinition } from '../shared/desktop-pet-catalog';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PET_GET_CHANNEL = 'desktop-pet:get';
const PET_SET_ENABLED_CHANNEL = 'desktop-pet:set-enabled';
const PET_SET_SELECTED_CHANNEL = 'desktop-pet:set-selected';
const PET_BEGIN_DRAG_CHANNEL = 'desktop-pet:begin-drag';
const PET_END_DRAG_CHANNEL = 'desktop-pet:end-drag';
const PET_SET_PREFERENCES_CHANNEL = 'desktop-pet:set-preferences';
const PET_SET_MOUSE_IGNORE_CHANNEL = 'desktop-pet:set-ignore-mouse-events';
const PET_ANIMATION_CHANNEL = 'desktop-pet:animation';
const PET_PREFERENCES_CHANNEL = 'desktop-pet:preferences';
const PET_CATALOG_CHANNEL = 'desktop-pet:catalog';
const PET_REFRESH_CATALOG_CHANNEL = 'desktop-pet:refresh-catalog';
const PET_FETCH_REMOTE_CATALOG_CHANNEL = 'desktop-pet:fetch-remote-catalog';
const PET_INSTALL_REMOTE_CHANNEL = 'desktop-pet:install-remote';
const PET_OPEN_DIRECTORY_CHANNEL = 'desktop-pet:open-directory';
const PET_SPRITESHEET_URL_CHANNEL = 'desktop-pet:spritesheet-url';
/** renderer 上报气泡实际内容尺寸（px），返回 main 实际准予向上扩出的额外高度。 */
const PET_SET_BUBBLE_BOUNDS_CHANNEL = 'desktop-pet:set-bubble-bounds';
/** 与 renderer BUBBLE_GAP_PX 保持一致：气泡底边距 sprite 的间隙。 */
const PET_BUBBLE_GAP_PX = 8;
/**
 * 气泡再高/再宽也不允许窗口贴上屏幕：动态按显示器可用区钳制（四边至少留
 * 8px）。高度无固定 px 上限——内容多高就向上扩多高；空间真的不足时由
 * renderer 的 body max-height + 内部滚动作为极端兜底。
 */
const PET_BUBBLE_SCREEN_MARGIN_PX = DESKTOP_PET_SCREEN_MARGIN_PX;
const PET_MARGIN = 24;
const BUILTIN_PETS = [
  { id: 'hawking', displayName: 'Hawking', description: '橙色、锐眼的土星伙伴', glow: { primary: '#ff7a1a', accent: '#ffd21f' }, source: 'builtin' as const },
  { id: 'yoyo', displayName: 'Yoyo', description: '蓝色、胸前带星标的伙伴', glow: { primary: '#2f7df6', accent: '#ffd84a' }, source: 'builtin' as const },
  { id: 'click', displayName: 'Click', description: '青绿色、亮眼的克里克伙伴', glow: { primary: '#51d6a2', accent: '#ff7b8d' }, source: 'builtin' as const },
];

export interface DesktopPetHostActions {
  showMainWindow: () => void;
  openSettings: () => void;
  triggerSync: () => void;
}

let hostActions: DesktopPetHostActions | null = null;
let contextMenuOpen = false;

type PetAnimation = 'idle' | 'running-left' | 'running-right';

let petWindow: BrowserWindow | null = null;
let latestPosition: DesktopPetPosition | undefined;
let moveStopTimer: ReturnType<typeof setTimeout> | null = null;
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastBounds: DesktopPetPosition | null = null;
/** Cursor→window offset captured on pointer-down, plus drag animation bookkeeping. */
let dragOrigin: {
  offsetX: number;
  offsetY: number;
  lastX: number;
  animation: PetAnimation;
} | null = null;
let dragTicker: ReturnType<typeof setInterval> | null = null;
let autoMoveTimer: ReturnType<typeof setTimeout> | null = null;
let autoMoveTicker: ReturnType<typeof setInterval> | null = null;

interface AutoMovePoint { x: number; y: number }
interface AutoMoveSegment { from: AutoMovePoint; control1: AutoMovePoint; control2: AutoMovePoint; to: AutoMovePoint }
interface AutoMoveRun {
  startedAt: number;
  durationMs: number;
  scale: number;
  segments: [AutoMoveSegment, AutoMoveSegment];
}

let autoMoveRun: AutoMoveRun | null = null;

/**
 * 合并气泡比窗口预留的头部空间（popoverTop - gap）高出的像素数。
 * 窗口只向上方扩高（y 上移、sprite 屏幕位置不动）；受屏幕顶边约束，
 * 实际准予值可能小于请求值，renderer 据此给气泡内容加 max-height 滚动兜底。
 */
let bubbleExtraPx = 0;
/** 已应用的气泡宽度（clamp 后）；null = 气泡关闭，窗口宽度回到 base。 */
let bubbleAppliedWidth: number | null = null;
/** renderer 最近一次上报的气泡内容高度（scale 变化/跨显示器后据此重算）。 */
let bubbleDesiredHeightPx = 0;
/**
 * 保存的 sprite 屏幕锚点：sprite 中心线 x（= 窗口中心）与底边 y（= 窗口底边）。
 * 所有气泡几何都以它为锚，绝不用可能陈旧/中间态的实时 getBounds() 反复累加，
 * 因此 persistent 模式下 renderer 高频重复上报的解析结果幂等、坐标不漂。
 * 仅在真实位移（拖拽/自动散步/OS move）与窗口创建时更新；气泡对称扩缩本就
 * 保持该锚点不变。
 */
let spriteAnchor: { cx: number; bottom: number } | null = null;
/** 合流计时器：一个 flush 窗口内 renderer 的多次上报只触发一次重算/setBounds。 */
let bubbleFlushTimer: ReturnType<typeof setTimeout> | null = null;
/** 等待本轮合流结果（grantedHeightExtra）的 IPC 调用方。 */
let bubbleFlushWaiters: Array<(granted: number) => void> = [];
let bubbleCommitInFlight = false;
/** setBounds 由气泡几何驱动时短暂置位：此时的 move 事件不更新 sprite 锚点。 */
let suppressAnchorCapture = false;
/** 合流窗口：覆盖一帧 + ResizeObserver 抖动；同值结果在 commit 内去重跳过。 */
const BUBBLE_FLUSH_MS = 32;

/** ~120Hz: fast enough to feel glued to the cursor, cheap enough to stay smooth. */
const DRAG_TICK_MS = 8;
/** Ignore sub-pixel jitter so the sprite does not flip direction while held still. */
const DRAG_DIRECTION_THRESHOLD = 1.5;
const AUTO_MOVE_TICK_MS = 16;
const AUTO_MOVE_EDGE_MARGIN = 24;
const AUTO_MOVE_MIN_DURATION_MS = 1600;
const AUTO_MOVE_MAX_DURATION_MS = 5200;

function isPetWindow(window: BrowserWindow | null): window is BrowserWindow {
  return Boolean(window && !window.isDestroyed());
}

function petDimensions(scale: number) {
  const layout = getDesktopPetLayout(scale);
  return {
    width: layout.hostWidth,
    height: layout.hostHeight,
    petWidth: layout.spriteWidth,
    spriteLeft: layout.spriteLeft,
  };
}

/**
 * 合并气泡按内容自适应尺寸（renderer ResizeObserver 同一通道上报宽高）：
 * 高度让窗口向上扩高（底边/sprite 不动）、宽度围绕 sprite 中心线对称扩宽，
 * 两维都经 resolveBubbleWindowBounds 按所在显示器 workArea 四边钳制；高度
 * 空间不足时返回值小于「想要的扩高」，renderer 用 body max-height + 内部
 * 滚动兜底。宽/高为 0（气泡隐藏）时收回基础占位。
 *
 * 写窗口只有这一个入口（applyBubbleBounds 高频上报、doSyncDesktopPet、拖拽
 * 结束重钳都走它）：
 *  - 锚点用保存的 spriteAnchor 合成 base 尺寸的参考 bounds，不用实时窗口
 *    bounds，重复上报结果幂等；
 *  - 最小维度裁剪：常态气泡（≤240 + 2 gutter = base.hostWidth）只写 y/height
 *    （旧 applyBubbleHeight 被验证无 DWM 问题的路径）；仅当宽度真的需要超过
 *    base 时才连带写 x/width；
 *  - renderer 上报经 BUBBLE_FLUSH_MS 合流，目标 rect 与当前完全相同则跳过。
 * 返回实际准予的额外高度。
 */
async function applyBubbleBounds(
  desiredWidthPx: number,
  desiredHeightPx: number,
): Promise<number> {
  if (!isPetWindow(petWindow)) return 0;
  if (!Number.isFinite(desiredHeightPx) || desiredHeightPx < 0) return bubbleExtraPx;
  const closed = desiredHeightPx <= 0;
  bubbleAppliedWidth = closed ? null : clampBubbleWidth(desiredWidthPx);
  bubbleDesiredHeightPx = closed ? 0 : Math.ceil(desiredHeightPx);
  return scheduleBubbleFlush();
}

function settleBubbleWaiters(granted: number): void {
  const waiters = bubbleFlushWaiters;
  bubbleFlushWaiters = [];
  for (const resolve of waiters) resolve(granted);
}

/** 合流：leading 立即跑一次（赶首帧），trailing 在静默窗口后兜底收敛。 */
function scheduleBubbleFlush(): Promise<number> {
  const promise = new Promise<number>((resolve) => bubbleFlushWaiters.push(resolve));
  if (bubbleFlushTimer === null && !bubbleCommitInFlight && isPetWindow(petWindow)) {
    bubbleCommitInFlight = true;
    void commitBubbleBounds()
      .then((granted) => settleBubbleWaiters(granted))
      .finally(() => { bubbleCommitInFlight = false; });
  }
  if (bubbleFlushTimer) clearTimeout(bubbleFlushTimer);
  bubbleFlushTimer = setTimeout(() => {
    bubbleFlushTimer = null;
    if (!isPetWindow(petWindow)) {
      settleBubbleWaiters(bubbleExtraPx);
      return;
    }
    bubbleCommitInFlight = true;
    void commitBubbleBounds()
      .then((granted) => settleBubbleWaiters(granted))
      .finally(() => { bubbleCommitInFlight = false; });
  }, BUBBLE_FLUSH_MS);
  return promise;
}

/** 立即冲刷合流队列（doSync 必须在 showInactive 前完成定位）。 */
async function flushBubbleBoundsNow(): Promise<number> {
  if (bubbleFlushTimer) {
    clearTimeout(bubbleFlushTimer);
    bubbleFlushTimer = null;
  }
  const granted = await commitBubbleBounds();
  settleBubbleWaiters(granted);
  return granted;
}

/**
 * Windows DWM 兜底：分层透明窗在宽度（x/width）变化后，新扩出的区域可能保持
 * 全透明（Chromium 表面正常、物理屏透明）。轻推一次 opacity 强制 layered
 * window 重新合成；0.99 肉眼不可见。仅宽度维度变化时需要——旧的只改
 * y/height 路径在 DWM 下一直正常。
 */
function forceLayeredWindowRepaint(target: BrowserWindow): void {
  if (process.platform !== 'win32') return;
  try {
    target.setOpacity(0.99);
    setTimeout(() => {
      if (!target.isDestroyed()) target.setOpacity(1);
    }, 16);
  } catch {
    // setOpacity 不可用时静默：物理屏验证会暴露问题。
  }
}

/**
 * 单一几何写入：以保存的 spriteAnchor 解析目标 rect，只把真正变化的维度写进
 * setBounds，完全相同则跳过。返回 grantedHeightExtra。
 */
async function commitBubbleBounds(): Promise<number> {
  const window = petWindow;
  if (!isPetWindow(window)) {
    spriteAnchor = null;
    return bubbleExtraPx;
  }
  const pref = await loadDesktopPetPref();
  if (!isPetWindow(window)) return bubbleExtraPx;
  const layout = getDesktopPetLayout(pref.scale);
  const current = window.getBounds();
  if (!spriteAnchor) {
    spriteAnchor = { cx: current.x + current.width / 2, bottom: current.y + current.height };
  }
  // 用锚点 + base 尺寸合成参考 bounds：同样的锚点/输入永远解析出同样的 rect。
  const anchorBounds = {
    x: Math.round(spriteAnchor.cx - layout.hostWidth / 2),
    y: Math.round(spriteAnchor.bottom - layout.hostHeight),
    width: layout.hostWidth,
    height: layout.hostHeight,
  };
  const { workArea } = screen.getDisplayNearestPoint({
    x: anchorBounds.x,
    y: anchorBounds.y,
  });
  const resolved = resolveBubbleWindowBounds({
    base: { width: layout.hostWidth, height: layout.hostHeight },
    workArea,
    bounds: anchorBounds,
    bubbleWidth: bubbleAppliedWidth,
    bubbleHeightPx: bubbleDesiredHeightPx,
    popoverTop: layout.popoverTop,
    gapPx: PET_BUBBLE_GAP_PX,
    screenMarginPx: PET_BUBBLE_SCREEN_MARGIN_PX,
  });

  // 最小维度裁剪：未变化的维度绝不写进 setBounds。
  const next = { x: current.x, y: current.y, width: current.width, height: current.height };
  let widthDimChanged = false;
  if (resolved.width !== current.width) {
    // 宽度只在内容真的超过 base 主机位时才变（resolve 内取 max(base, …)）；
    // x 围绕同一中心线对称变化，必须与 width 同批写入。
    next.width = resolved.width;
    next.x = resolved.x;
    widthDimChanged = true;
  }
  if (resolved.height !== current.height) {
    next.height = resolved.height;
    next.y = resolved.y;
  }
  const changed = next.x !== current.x
    || next.y !== current.y
    || next.width !== current.width
    || next.height !== current.height;
  if (changed) {
    suppressAnchorCapture = true;
    try {
      window.setBounds(next);
    } finally {
      // Windows 上 move 事件经消息泵异步派发，保留一小段抑制窗口。
      setTimeout(() => { suppressAnchorCapture = false; }, 200);
    }
    if (widthDimChanged) forceLayeredWindowRepaint(window);
    // 拖拽以 cursor-窗口原点偏移跟随；窗口移动后同步修正，避免 sprite 跳变。
    if (dragOrigin) {
      dragOrigin.offsetX -= next.x - current.x;
      dragOrigin.offsetY -= next.y - current.y;
    }
  }
  bubbleExtraPx = resolved.grantedHeightExtra;
  return bubbleExtraPx;
}

function clampPosition(position: DesktopPetPosition, scale: number): DesktopPetPosition {
  const display = screen.getDisplayNearestPoint(position);
  const { workArea } = display;
  const base = petDimensions(scale);
  // 气泡展开时窗口可能比 base 更宽/更高；自动移动按当前实际占位夹取，
  // 避免扩出的部分被推出屏幕。窗口尚未创建（首次定位）时退回 base。
  const width = isPetWindow(petWindow) ? petWindow.getBounds().width : base.width;
  const height = isPetWindow(petWindow) ? petWindow.getBounds().height : base.height;
  return {
    x: Math.round(Math.min(Math.max(position.x, workArea.x), workArea.x + workArea.width - width)),
    y: Math.round(Math.min(Math.max(position.y, workArea.y), workArea.y + workArea.height - height)),
  };
}

function defaultPosition(scale: number): DesktopPetPosition {
  const { workArea } = screen.getPrimaryDisplay();
  const { height, petWidth, spriteLeft } = petDimensions(scale);
  return {
    x: workArea.x + workArea.width - petWidth - spriteLeft - PET_MARGIN,
    y: workArea.y + workArea.height - height - PET_MARGIN,
  };
}

function sendAnimation(animation: PetAnimation): void {
  if (isPetWindow(petWindow)) {
    petWindow.webContents.send(PET_ANIMATION_CHANNEL, animation);
  }
}

function sendPreferences(pref: DesktopPetPref): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(PET_PREFERENCES_CHANNEL, pref);
    }
  }
}

async function normalizeSelectedPet(
  pref: DesktopPetPref,
  knownPetIds?: ReadonlySet<string>,
): Promise<DesktopPetPref> {
  const known = knownPetIds
    ? knownPetIds.has(pref.selectedPetId)
    : await isKnownDesktopPet(pref.selectedPetId);
  if (known) return pref;
  const saved = await saveDesktopPetPref({ ...pref, selectedPetId: 'hawking' });
  sendPreferences(saved);
  return saved;
}

async function catalogResponse(remotePets: DesktopPetDefinition[] = []) {
  const catalog = await scanDesktopPets();
  const installedIds = new Set([
    ...BUILTIN_PETS.map((pet) => pet.id),
    ...catalog.pets.map((pet) => pet.id),
  ]);
  const availableRemote = remotePets.filter(
    (pet) => pet.source === 'remote' && !installedIds.has(pet.id),
  );
  return {
    ...catalog,
    pets: [...BUILTIN_PETS, ...catalog.pets, ...availableRemote],
  };
}

async function remoteCatalogResponse(force = false) {
  const local = await catalogResponse();
  const installedIds = new Set(local.pets.filter((pet) => pet.source !== 'remote').map((pet) => pet.id));
  const remote = await fetchRemoteDesktopPets({ installedIds, force });
  const catalog = await catalogResponse(remote.pets);
  const pref = await normalizeSelectedPet(
    await loadDesktopPetPref(),
    new Set(catalog.pets.filter((pet) => pet.source !== 'remote').map((pet) => pet.id)),
  );
  return {
    ...catalog,
    selectedPetId: pref.selectedPetId,
    remoteError: remote.error ?? null,
  };
}

async function setPetEnabled(enabled: boolean): Promise<boolean> {
  const current = await loadDesktopPetPref();
  const saved = await saveDesktopPetPref({
    ...current,
    enabled,
    position: latestPosition ?? current.position,
  });
  sendPreferences(saved);
  await syncDesktopPet();
  return enabled;
}

/** Same first items as the tray; last item hides the pet instead of quitting. */
function buildPetMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => hostActions?.showMainWindow(),
    },
    {
      label: '同步数据',
      click: () => hostActions?.triggerSync(),
    },
    {
      label: '设置',
      click: () => hostActions?.openSettings(),
    },
    { type: 'separator' },
    {
      label: '退出宠物',
      click: () => {
        void setPetEnabled(false);
      },
    },
  ]);
}

function popupPetContextMenu(): void {
  if (!isPetWindow(petWindow) || contextMenuOpen || dragOrigin) return;
  contextMenuOpen = true;
  stopAutoMove();
  buildPetMenu().popup({
    window: petWindow,
    callback: () => {
      contextMenuOpen = false;
      void scheduleAutoMove();
    },
  });
}

function scheduleIdle(): void {
  if (moveStopTimer) clearTimeout(moveStopTimer);
  moveStopTimer = setTimeout(() => sendAnimation('idle'), 180);
}

function schedulePositionSave(delay = 180): void {
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null;
    const position = latestPosition;
    if (!position) return;
    void loadDesktopPetPref()
      .then((pref) => saveDesktopPetPref({ ...pref, enabled: true, position }));
  }, delay);
}

function stopAutoMoveTicker(): void {
  if (autoMoveTicker) clearInterval(autoMoveTicker);
  autoMoveTicker = null;
}

function clearAutoMoveTimer(): void {
  if (autoMoveTimer) clearTimeout(autoMoveTimer);
  autoMoveTimer = null;
}

function stopAutoMove(): void {
  clearAutoMoveTimer();
  stopAutoMoveTicker();
  autoMoveRun = null;
  sendAnimation('idle');
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * Math.max(0, max - min);
}

function cubicPoint(segment: AutoMoveSegment, progress: number): AutoMovePoint {
  const t = progress;
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * segment.from.x
      + 3 * inverse ** 2 * t * segment.control1.x
      + 3 * inverse * t ** 2 * segment.control2.x
      + t ** 3 * segment.to.x,
    y: inverse ** 3 * segment.from.y
      + 3 * inverse ** 2 * t * segment.control1.y
      + 3 * inverse * t ** 2 * segment.control2.y
      + t ** 3 * segment.to.y,
  };
}

function createAutoMoveSegments(
  from: AutoMovePoint,
  to: AutoMovePoint,
): [AutoMoveSegment, AutoMoveSegment] {
  const midpoint = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const perpendicular = { x: -dy / distance, y: dx / distance };
  const bend = randomBetween(-Math.min(180, distance * 0.35), Math.min(180, distance * 0.35));
  const bentMidpoint = {
    x: midpoint.x + perpendicular.x * bend,
    y: midpoint.y + perpendicular.y * bend,
  };
  const firstControl = {
    x: from.x + dx * 0.22 + perpendicular.x * bend * 0.35,
    y: from.y + dy * 0.22 + perpendicular.y * bend * 0.35,
  };
  const secondControl = {
    x: bentMidpoint.x - dx * 0.16 + perpendicular.x * bend * 0.12,
    y: bentMidpoint.y - dy * 0.16 + perpendicular.y * bend * 0.12,
  };
  const thirdControl = {
    x: bentMidpoint.x + dx * 0.16 + perpendicular.x * bend * 0.12,
    y: bentMidpoint.y + dy * 0.16 + perpendicular.y * bend * 0.12,
  };
  const fourthControl = {
    x: to.x - dx * 0.22 + perpendicular.x * bend * 0.35,
    y: to.y - dy * 0.22 + perpendicular.y * bend * 0.35,
  };
  return [
    { from, control1: firstControl, control2: secondControl, to: bentMidpoint },
    { from: bentMidpoint, control1: thirdControl, control2: fourthControl, to },
  ];
}

function randomAutoMoveTarget(scale: number, current: AutoMovePoint): AutoMovePoint | null {
  const display = screen.getDisplayNearestPoint(current);
  const { workArea } = display;
  const { width, height } = petDimensions(scale);
  const minX = workArea.x + AUTO_MOVE_EDGE_MARGIN;
  const minY = workArea.y + AUTO_MOVE_EDGE_MARGIN;
  const maxX = workArea.x + workArea.width - width - AUTO_MOVE_EDGE_MARGIN;
  const maxY = workArea.y + workArea.height - height - AUTO_MOVE_EDGE_MARGIN;
  if (maxX <= minX || maxY <= minY) return null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const target = {
      x: Math.round(randomBetween(minX, maxX)),
      y: Math.round(randomBetween(minY, maxY)),
    };
    if (Math.hypot(target.x - current.x, target.y - current.y) >= Math.min(180, Math.max(80, width * 0.8))) {
      return target;
    }
  }
  return {
    x: Math.round(randomBetween(minX, maxX)),
    y: Math.round(randomBetween(minY, maxY)),
  };
}

function tickAutoMove(): void {
  if (!autoMoveRun || !isPetWindow(petWindow) || dragOrigin) {
    stopAutoMove();
    return;
  }
  const elapsed = Date.now() - autoMoveRun.startedAt;
  const overallProgress = Math.min(1, elapsed / autoMoveRun.durationMs);
  const easedProgress = overallProgress < 0.5
    ? 4 * overallProgress ** 3
    : 1 - ((-2 * overallProgress + 2) ** 3) / 2;
  const segmentProgress = easedProgress < 0.5 ? easedProgress * 2 : (easedProgress - 0.5) * 2;
  const segment = autoMoveRun.segments[easedProgress < 0.5 ? 0 : 1];
  const point = clampPosition(cubicPoint(segment, segmentProgress), autoMoveRun.scale);
  petWindow.setPosition(point.x, point.y);
  const previous = lastBounds;
  lastBounds = point;
  latestPosition = lastBounds;
  if (previous && lastBounds.x !== previous.x) {
    sendAnimation(lastBounds.x < previous.x ? 'running-left' : 'running-right');
  }
  if (overallProgress >= 1) {
    stopAutoMoveTicker();
    autoMoveRun = null;
    schedulePositionSave(0);
    sendAnimation('idle');
    void scheduleAutoMove();
  }
}

function canAutoMove(window: BrowserWindow | null): window is BrowserWindow {
  return isPetWindow(window) && !dragOrigin && !autoMoveRun && !contextMenuOpen;
}

async function startAutoMove(): Promise<void> {
  autoMoveTimer = null;
  if (!canAutoMove(petWindow)) return;
  const pref = await loadDesktopPetPref();
  if (!pref.enabled || !pref.autoMoveEnabled) return;
  if (!canAutoMove(petWindow)) return;
  const [x, y] = petWindow.getPosition();
  const target = randomAutoMoveTarget(pref.scale, { x, y });
  if (!target) {
    await scheduleAutoMove();
    return;
  }
  const distance = Math.hypot(target.x - x, target.y - y);
  const durationMs = Math.min(
    AUTO_MOVE_MAX_DURATION_MS,
    Math.max(AUTO_MOVE_MIN_DURATION_MS, Math.round(distance / 0.12)),
  );
  autoMoveRun = {
    startedAt: Date.now(),
    durationMs,
    scale: pref.scale,
    segments: createAutoMoveSegments({ x, y }, target),
  };
  stopAutoMoveTicker();
  autoMoveTicker = setInterval(tickAutoMove, AUTO_MOVE_TICK_MS);
  sendAnimation(target.x < x ? 'running-left' : 'running-right');
}

async function scheduleAutoMove(delayMs?: number): Promise<void> {
  clearAutoMoveTimer();
  if (!canAutoMove(petWindow)) return;
  const pref = await loadDesktopPetPref();
  if (!pref.enabled || !pref.autoMoveEnabled) return;
  if (!canAutoMove(petWindow)) return;
  autoMoveTimer = setTimeout(() => { void startAutoMove(); }, delayMs ?? pref.autoMoveIntervalMinutes * 60_000);
}

function onPetMoved(): void {
  if (!isPetWindow(petWindow)) return;
  const [x, y] = petWindow.getPosition();
  const next = { x, y };
  if (lastBounds && !dragOrigin && !autoMoveRun) {
    if (next.x < lastBounds.x) sendAnimation('running-left');
    if (next.x > lastBounds.x) sendAnimation('running-right');
    scheduleIdle();
  }
  lastBounds = next;
  latestPosition = next;
  // sprite 恒为窗口居中 + 底边对齐，真实位移（拖拽/自动散步/OS）刷新锚点；
  // 气泡几何驱动的 move 事件被抑制，锚点保持不漂。
  if (!suppressAnchorCapture && isPetWindow(petWindow)) {
    const b = petWindow.getBounds();
    spriteAnchor = { cx: b.x + b.width / 2, bottom: b.y + b.height };
  }
  if (!dragOrigin && !autoMoveRun) schedulePositionSave();
}

/**
 * One drag tick. Main polls the OS cursor instead of waiting for renderer
 * pointer events, so window position never lags behind IPC round-trips and the
 * walk animation follows the real horizontal direction of travel.
 */
function tickDrag(): void {
  const drag = dragOrigin;
  if (!drag || !isPetWindow(petWindow)) {
    stopDragTicker();
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const x = Math.round(cursor.x - drag.offsetX);
  const y = Math.round(cursor.y - drag.offsetY);
  const [currentX, currentY] = petWindow.getPosition();
  if (x !== currentX || y !== currentY) petWindow.setPosition(x, y);

  const horizontalDelta = cursor.x - drag.lastX;
  if (Math.abs(horizontalDelta) >= DRAG_DIRECTION_THRESHOLD) {
    drag.lastX = cursor.x;
    const next: PetAnimation = horizontalDelta < 0 ? 'running-left' : 'running-right';
    if (drag.animation !== next) {
      drag.animation = next;
      sendAnimation(next);
    }
  }
}

function startDragTicker(): void {
  if (dragTicker) return;
  dragTicker = setInterval(tickDrag, DRAG_TICK_MS);
}

function stopDragTicker(): void {
  if (dragTicker) clearInterval(dragTicker);
  dragTicker = null;
}

/**
 * Keep the native window title from becoming "Juejin Usage" / "pet.html".
 * Chromium synthesizes a title from the file URL when the document title is
 * empty (`explicitSet: false`); preventDefault stops that from hitting HWND.
 */
const PET_WINDOW_TITLE = '\u200B';

function suppressPetWindowTitle(window: BrowserWindow): void {
  window.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  window.setTitle(PET_WINDOW_TITLE);
}

async function loadPetRenderer(window: BrowserWindow): Promise<void> {
  try {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devUrl) {
      const url = new URL('pet.html', devUrl.endsWith('/') ? devUrl : `${devUrl}/`);
      await window.loadURL(url.toString());
      return;
    }
    await window.loadFile(path.join(__dirname, '../renderer/pet.html'));
  } catch (err) {
    // Window destroyed mid-load (pet disabled / toggled away) — swallow.
    if (window.isDestroyed()) return;
    throw err;
  }
}

async function ensurePetWindow(): Promise<BrowserWindow> {
  if (isPetWindow(petWindow)) return petWindow;
  const pref = await loadDesktopPetPref();
  const position = clampPosition(pref.position ?? latestPosition ?? defaultPosition(pref.scale), pref.scale);
  const { width, height } = petDimensions(pref.scale);
  latestPosition = position;
  lastBounds = position;
  spriteAnchor = { cx: position.x + width / 2, bottom: position.y + height };
  petWindow = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: PET_WINDOW_TITLE,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    ...(process.platform === 'win32'
      ? { roundedCorners: false, thickFrame: false }
      : {}),
    webPreferences: {
      preload: defaultPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const window = petWindow;
  // `titleBarStyle` enables macOS traffic lights even on a frameless window.
  // A floating pet must never expose native window controls over its sprite.
  if (process.platform === 'darwin') window.setWindowButtonVisibility(false);
  suppressPetWindowTitle(window);
  window.setAlwaysOnTop(true, 'floating');
  window.webContents.on('context-menu', (event) => {
    event.preventDefault();
    popupPetContextMenu();
  });
  window.on('move', onPetMoved);
  window.on('closed', () => {
    stopAutoMove();
    bubbleExtraPx = 0;
    bubbleAppliedWidth = null;
    bubbleDesiredHeightPx = 0;
    spriteAnchor = null;
    suppressAnchorCapture = false;
    if (bubbleFlushTimer) {
      clearTimeout(bubbleFlushTimer);
      bubbleFlushTimer = null;
    }
    settleBubbleWaiters(0);
    // Only clear the ref if it still points at this window; a newer window
    // created by a queued toggle must not be nulled out by the old one.
    if (petWindow === window) {
      petWindow = null;
      lastBounds = null;
    }
  });
  await loadPetRenderer(window);
  sendPreferences(pref);
  return window;
}

/**
 * Rapid toggles previously raced: one call was mid-loadURL while another
 * destroyed the window, killing the navigation with ERR_FAILED (-2). Serialize
 * through a promise chain so each toggle runs to completion before the next.
 */
let syncQueue: Promise<void> = Promise.resolve();

export function syncDesktopPet(): Promise<void> {
  const run = syncQueue.then(() => doSyncDesktopPet());
  // Keep the chain alive even if one run rejects so later toggles still apply.
  syncQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function doSyncDesktopPet(): Promise<void> {
  const pref = await normalizeSelectedPet(await loadDesktopPetPref());
  stopAutoMove();
  latestPosition = pref.position;
  if (!pref.enabled) {
    stopAutoMove();
    // Disabling the pet releases its renderer process entirely instead of
    // keeping a hidden window (and its Chromium process) resident.
    if (isPetWindow(petWindow)) petWindow.destroy();
    return;
  }
  const window = await ensurePetWindow();
  if (window.isDestroyed()) return;
  // 合并气泡动态扩出的宽/高在 scale/pref 同步后经同一条几何入口重算：以保存
  // 的 spriteAnchor 为锚（新窗口已用 pref.position 初始化锚点），按当前所在
  // 显示器 workArea 钳制；高度不足部分 renderer 内部滚动兜底。
  const granted = await flushBubbleBoundsNow();
  bubbleExtraPx = granted;
  if (!window.isDestroyed()) {
    const [x, y] = window.getPosition();
    latestPosition = { x, y };
    lastBounds = { x, y };
  }
  sendPreferences(pref);
  window.setIgnoreMouseEvents(false);
  window.showInactive();
  await scheduleAutoMove();
}

export function registerDesktopPetIpc(actions: DesktopPetHostActions): void {
  hostActions = actions;
  ipcMain.removeHandler(PET_GET_CHANNEL);
  ipcMain.handle(PET_GET_CHANNEL, async () => normalizeSelectedPet(await loadDesktopPetPref()));

  ipcMain.removeHandler(PET_CATALOG_CHANNEL);
  ipcMain.handle(PET_CATALOG_CHANNEL, () => catalogResponse());

  ipcMain.removeHandler(PET_REFRESH_CATALOG_CHANNEL);
  ipcMain.handle(PET_REFRESH_CATALOG_CHANNEL, async () => {
    const catalog = await catalogResponse();
    const pref = await normalizeSelectedPet(
      await loadDesktopPetPref(),
      new Set(catalog.pets.filter((pet) => pet.source !== 'remote').map((pet) => pet.id)),
    );
    return { ...catalog, selectedPetId: pref.selectedPetId };
  });

  ipcMain.removeHandler(PET_FETCH_REMOTE_CATALOG_CHANNEL);
  ipcMain.handle(PET_FETCH_REMOTE_CATALOG_CHANNEL, async (_event, force: unknown) =>
    remoteCatalogResponse(force === true),
  );

  ipcMain.removeHandler(PET_INSTALL_REMOTE_CHANNEL);
  ipcMain.handle(PET_INSTALL_REMOTE_CHANNEL, async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('invalid desktop pet id');
    await installRemoteDesktopPet(id, desktopPetDirectory());
    const catalog = await remoteCatalogResponse(true);
    const pref = await normalizeSelectedPet(
      await saveDesktopPetPref({
        ...(await loadDesktopPetPref()),
        selectedPetId: id,
      }),
      new Set(catalog.pets.filter((pet) => pet.source !== 'remote').map((pet) => pet.id)),
    );
    stopAutoMove();
    sendPreferences(pref);
    void scheduleAutoMove();
    await syncDesktopPet();
    return { ...catalog, selectedPetId: pref.selectedPetId };
  });

  ipcMain.removeHandler(PET_OPEN_DIRECTORY_CHANNEL);
  ipcMain.handle(PET_OPEN_DIRECTORY_CHANNEL, async () => {
    const directory = desktopPetDirectory();
    await mkdir(directory, { recursive: true });
    return shell.openPath(directory);
  });

  ipcMain.removeHandler(PET_SPRITESHEET_URL_CHANNEL);
  ipcMain.handle(PET_SPRITESHEET_URL_CHANNEL, async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('invalid desktop pet id');
    return getDesktopPetSpritesheetUrl(id);
  });

  ipcMain.removeHandler(PET_SET_BUBBLE_BOUNDS_CHANNEL);
  ipcMain.handle(PET_SET_BUBBLE_BOUNDS_CHANNEL, (event, size: unknown) => {
    if (!isPetWindow(petWindow) || event.sender !== petWindow.webContents) {
      return Promise.resolve(0);
    }
    if (!size || typeof size !== 'object') return Promise.resolve(bubbleExtraPx);
    const { width, height } = size as { width?: unknown; height?: unknown };
    if (typeof height !== 'number') return Promise.resolve(bubbleExtraPx);
    return applyBubbleBounds(typeof width === 'number' ? width : 0, height);
  });

  ipcMain.removeHandler(PET_SET_ENABLED_CHANNEL);
  ipcMain.handle(PET_SET_ENABLED_CHANNEL, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('desktop pet enabled must be a boolean');
    return setPetEnabled(enabled);
  });

  ipcMain.removeHandler(PET_SET_SELECTED_CHANNEL);
  ipcMain.handle(PET_SET_SELECTED_CHANNEL, async (_event, selectedPetId: unknown) => {
    if (typeof selectedPetId !== 'string' || !await isKnownDesktopPet(selectedPetId)) {
      throw new Error('unknown desktop pet');
    }
    const current = await loadDesktopPetPref();
    const saved = await saveDesktopPetPref({ ...current, selectedPetId });
    stopAutoMove();
    sendPreferences(saved);
    void scheduleAutoMove();
    return saved;
  });

  ipcMain.removeHandler(PET_SET_PREFERENCES_CHANNEL);
  ipcMain.handle(PET_SET_PREFERENCES_CHANNEL, async (_event, changes: unknown) => {
    if (!changes || typeof changes !== 'object') throw new Error('desktop pet preferences must be an object');
    const current = await loadDesktopPetPref();
    const next = changes as Partial<Pick<
      DesktopPetPref,
      | 'scale'
      | 'frameIntervalMs'
      | 'autoMoveEnabled'
      | 'autoMoveIntervalMinutes'
      | 'syncFeedbackEnabled'
      | 'syncFeedbackDurationSec'
      | 'quotaBubbleMode'
      | 'quotaBubbleIntervalMin'
      | 'quotaAlertEnabled'
      | 'quotaAlertThreshold'
      | 'quotaAlertCooldownMin'
      | 'quotaMoodEnabled'
    >>;
    const scale = typeof next.scale === 'number' && next.scale >= 0.35 && next.scale <= 0.75
      ? next.scale : current.scale ?? DEFAULT_DESKTOP_PET_SCALE;
    const frameIntervalMs = typeof next.frameIntervalMs === 'number' && next.frameIntervalMs >= 120 && next.frameIntervalMs <= 320
      ? Math.round(next.frameIntervalMs) : current.frameIntervalMs ?? DEFAULT_DESKTOP_PET_FRAME_INTERVAL_MS;
    const autoMoveEnabled = typeof next.autoMoveEnabled === 'boolean'
      ? next.autoMoveEnabled : current.autoMoveEnabled;
    const autoMoveIntervalMinutes = typeof next.autoMoveIntervalMinutes === 'number'
      && Number.isInteger(next.autoMoveIntervalMinutes)
      && next.autoMoveIntervalMinutes >= 1
      && next.autoMoveIntervalMinutes <= 120
      ? next.autoMoveIntervalMinutes : current.autoMoveIntervalMinutes;
    const syncFeedbackEnabled = typeof next.syncFeedbackEnabled === 'boolean'
      ? next.syncFeedbackEnabled
      : current.syncFeedbackEnabled;
    const syncFeedbackDurationSec = typeof next.syncFeedbackDurationSec === 'number'
      && Number.isInteger(next.syncFeedbackDurationSec)
      && next.syncFeedbackDurationSec >= 1
      && next.syncFeedbackDurationSec <= 10
      ? next.syncFeedbackDurationSec
      : current.syncFeedbackDurationSec;
    const quotaBubbleMode = isQuotaBubbleMode(next.quotaBubbleMode)
      ? next.quotaBubbleMode
      : current.quotaBubbleMode ?? DEFAULT_DESKTOP_PET_QUOTA_BUBBLE_MODE;
    const quotaBubbleIntervalMin = typeof next.quotaBubbleIntervalMin === 'number'
      && Number.isInteger(next.quotaBubbleIntervalMin)
      && next.quotaBubbleIntervalMin >= 1
      && next.quotaBubbleIntervalMin <= 60
      ? next.quotaBubbleIntervalMin
      : current.quotaBubbleIntervalMin ?? DEFAULT_DESKTOP_PET_QUOTA_BUBBLE_INTERVAL_MIN;
    const quotaAlertEnabled = typeof next.quotaAlertEnabled === 'boolean'
      ? next.quotaAlertEnabled
      : current.quotaAlertEnabled ?? DEFAULT_DESKTOP_PET_QUOTA_ALERT_ENABLED;
    const quotaAlertThreshold = isQuotaAlertThreshold(next.quotaAlertThreshold)
      ? next.quotaAlertThreshold
      : current.quotaAlertThreshold ?? DEFAULT_DESKTOP_PET_QUOTA_ALERT_THRESHOLD;
    const quotaAlertCooldownMin = typeof next.quotaAlertCooldownMin === 'number'
      && Number.isInteger(next.quotaAlertCooldownMin)
      && next.quotaAlertCooldownMin >= 5
      && next.quotaAlertCooldownMin <= 360
      ? next.quotaAlertCooldownMin
      : current.quotaAlertCooldownMin ?? DEFAULT_DESKTOP_PET_QUOTA_ALERT_COOLDOWN_MIN;
    const quotaMoodEnabled = typeof next.quotaMoodEnabled === 'boolean'
      ? next.quotaMoodEnabled
      : current.quotaMoodEnabled ?? DEFAULT_DESKTOP_PET_QUOTA_MOOD_ENABLED;
    const saved = await saveDesktopPetPref({
      ...current,
      scale,
      frameIntervalMs,
      autoMoveEnabled,
      autoMoveIntervalMinutes,
      syncFeedbackEnabled,
      syncFeedbackDurationSec,
      quotaBubbleMode,
      quotaBubbleIntervalMin,
      quotaAlertEnabled,
      quotaAlertThreshold,
      quotaAlertCooldownMin,
      quotaMoodEnabled,
    });
    sendPreferences(saved);
    await syncDesktopPet();
    return saved;
  });

  ipcMain.removeAllListeners(PET_SET_MOUSE_IGNORE_CHANNEL);
  ipcMain.on(PET_SET_MOUSE_IGNORE_CHANNEL, (event, ignore: unknown) => {
    if (!isPetWindow(petWindow) || event.sender !== petWindow.webContents) return;
    if (typeof ignore !== 'boolean') return;
    petWindow.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.removeAllListeners(PET_BEGIN_DRAG_CHANNEL);
  ipcMain.on(PET_BEGIN_DRAG_CHANNEL, (event) => {
    if (!isPetWindow(petWindow) || event.sender !== petWindow.webContents) return;
    stopAutoMove();
    if (moveStopTimer) clearTimeout(moveStopTimer);
    moveStopTimer = null;
    if (positionSaveTimer) clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = petWindow.getPosition();
    dragOrigin = {
      offsetX: cursor.x - x,
      offsetY: cursor.y - y,
      lastX: cursor.x,
      animation: 'idle',
    };
    startDragTicker();
  });

  ipcMain.removeAllListeners(PET_END_DRAG_CHANNEL);
  ipcMain.on(PET_END_DRAG_CHANNEL, (event) => {
    if (!isPetWindow(petWindow) || event.sender !== petWindow.webContents || !dragOrigin) return;
    stopDragTicker();
    tickDrag();
    dragOrigin = null;
    sendAnimation('idle');
    // 拖拽可能跨过显示器/贴到顶边：按新 workArea 经同一合流入口重新钳制气泡
    // 宽高（renderer 内容尺寸未变，直接用最近一次上报值；锚点已随拖拽更新）。
    if (bubbleAppliedWidth !== null && bubbleDesiredHeightPx > 0) {
      void scheduleBubbleFlush();
    }
    schedulePositionSave(0);
    void scheduleAutoMove();
  });
}

export function unregisterDesktopPetIpc(): void {
  stopAutoMove();
  hostActions = null;
  contextMenuOpen = false;
  ipcMain.removeHandler(PET_GET_CHANNEL);
  ipcMain.removeHandler(PET_SET_ENABLED_CHANNEL);
  ipcMain.removeHandler(PET_SET_SELECTED_CHANNEL);
  ipcMain.removeHandler(PET_SET_PREFERENCES_CHANNEL);
  ipcMain.removeHandler(PET_CATALOG_CHANNEL);
  ipcMain.removeHandler(PET_REFRESH_CATALOG_CHANNEL);
  ipcMain.removeHandler(PET_FETCH_REMOTE_CATALOG_CHANNEL);
  ipcMain.removeHandler(PET_INSTALL_REMOTE_CHANNEL);
  ipcMain.removeHandler(PET_OPEN_DIRECTORY_CHANNEL);
  ipcMain.removeHandler(PET_SPRITESHEET_URL_CHANNEL);
  ipcMain.removeHandler(PET_SET_BUBBLE_BOUNDS_CHANNEL);
  ipcMain.removeAllListeners(PET_SET_MOUSE_IGNORE_CHANNEL);
  ipcMain.removeAllListeners(PET_BEGIN_DRAG_CHANNEL);
  ipcMain.removeAllListeners(PET_END_DRAG_CHANNEL);
}

export function disposeDesktopPet(): void {
  stopDragTicker();
  stopAutoMove();
  bubbleExtraPx = 0;
  bubbleAppliedWidth = null;
  bubbleDesiredHeightPx = 0;
  spriteAnchor = null;
  suppressAnchorCapture = false;
  if (bubbleFlushTimer) {
    clearTimeout(bubbleFlushTimer);
    bubbleFlushTimer = null;
  }
  settleBubbleWaiters(0);
  if (moveStopTimer) clearTimeout(moveStopTimer);
  moveStopTimer = null;
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  positionSaveTimer = null;
  dragOrigin = null;
  contextMenuOpen = false;
  if (isPetWindow(petWindow)) petWindow.destroy();
  petWindow = null;
}
