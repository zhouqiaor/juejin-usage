import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { fetchDaily } from '@/lib/api';
import { formatTokens, formatTokensExact, formatUsd } from '@/lib/format';
import { DESKTOP_PETS, getDesktopPet, loadPetSpritesheet, type DesktopPetDefinition } from '@/pets';
import {
  DASHBOARD_RANGE_DAYS,
  DASHBOARD_RANGE_LABELS,
  DEFAULT_DASHBOARD_RANGE,
  type DashboardRange,
} from '../../shared/dashboard-range';
import {
  DESKTOP_PET_SOURCE_HEIGHT,
  DESKTOP_PET_SOURCE_WIDTH,
  getDesktopPetLayout,
} from '../../shared/desktop-pet-layout';
import {
  PET_SPRITESHEET_HEIGHT,
  PET_SPRITESHEET_WIDTH,
  paintPetSpriteFrame,
  petSpriteCell,
  type PetAnimation,
} from '../../shared/desktop-pet-sprite';
import {
  evaluateQuotaAlerts,
  type QuotaAlertStateEntry,
  type QuotaAlertThreshold,
} from '../../shared/pet-quota-alert';
import { resolveMergedPetBubble } from '../../shared/pet-quota-bubble';
import {
  buildPetQuotaAggregate,
  type PetQuotaAggregate,
} from '../../shared/pet-quota-providers';
import { aggregateToQuotaWindows } from '../../shared/pet-quota-integration';
import type { PetSyncFeedback } from '../../shared/pet-sync-feedback';
import { PetQuotaBubble } from './PetQuotaBubble';
import { SUBSCRIPTION_REFRESH_EVENT } from './SubscriptionOverviewSection';
import { fetchPetProviderSnapshots } from '../lib/petProviderSnapshots';

const DISPLAY_SCALE = 0.5;
const DRAG_ANIMATION_SPEED_MULTIPLIER = 0.55;
const BUBBLE_GAP_PX = 8;
/** 与 pet.css .desktop-pet-bubble 的 8px 上下内边距对应（max-height 换算用）。 */
const BUBBLE_VERTICAL_PADDING_PX = 16;
const DEFAULT_SYNC_FEEDBACK_DURATION_SEC = 3;
/** periodic 模式下气泡每次展开的停留时长。 */
const QUOTA_BUBBLE_VISIBLE_MS = 10_000;
/** main 侧各 get*Subscription 均有 60s 缓存；统一聚合轮询命中缓存，不打爆网络。 */
const QUOTA_SUBSCRIPTION_POLL_MS = 60_000;
/** 今日统计在常驻/周期气泡可见期间的本地数据轮询节奏。 */
const SUMMARY_POLL_MS = 30_000;
const DEFAULT_QUOTA_BUBBLE_MODE = 'off' as const;
const DEFAULT_QUOTA_BUBBLE_INTERVAL_MIN = 5;
const DEFAULT_QUOTA_ALERT_ENABLED = false;
const DEFAULT_QUOTA_ALERT_THRESHOLD: QuotaAlertThreshold = 90;
const DEFAULT_QUOTA_ALERT_COOLDOWN_MIN = 30;

async function fetchRangeTotals(range: DashboardRange): Promise<{
  totalTokens: number;
  totalCostUsd: number;
}> {
  const daily = await fetchDaily(DASHBOARD_RANGE_DAYS[range]);
  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const row of daily.days ?? []) {
    totalTokens += row.tokens;
    totalCostUsd += row.costUsd;
  }
  return { totalTokens, totalCostUsd };
}

/** Transparent pet view with manual drag support so click can open its token bubble. */
export function DesktopPetView() {
  const [animation, setAnimation] = useState<PetAnimation>('idle');
  const [selectedPetId, setSelectedPetId] = useState('hawking');
  const [scale, setScale] = useState(DISPLAY_SCALE);
  const [frameIntervalMs, setFrameIntervalMs] = useState(180);
  const [isTokenTooltipOpen, setIsTokenTooltipOpen] = useState(false);
  /**
   * persistent/periodic 下点击 sprite 只收起/展开上区「今日」；
   * 额度区始终按模式规则显示，不再被点击顶替。off 模式不使用此状态。
   */
  const [isTodayCollapsed, setIsTodayCollapsed] = useState(false);
  const [range, setRange] = useState<DashboardRange>(DEFAULT_DASHBOARD_RANGE);
  const [summary, setSummary] = useState<{ totalTokens: number; totalCostUsd: number } | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<PetSyncFeedback | null>(null);
  const [spritesheetUrl, setSpritesheetUrl] = useState<string | null>(null);
  const [pets, setPets] = useState<DesktopPetDefinition[]>(DESKTOP_PETS);
  // 套餐额度气泡（需求①②）与阈值跳动告警（需求③）的 pref 镜像。
  const [quotaBubbleMode, setQuotaBubbleMode] =
    useState<'off' | 'periodic' | 'persistent'>(DEFAULT_QUOTA_BUBBLE_MODE);
  const [quotaBubbleIntervalMin, setQuotaBubbleIntervalMin] =
    useState(DEFAULT_QUOTA_BUBBLE_INTERVAL_MIN);
  const [quotaAlertEnabled, setQuotaAlertEnabled] = useState(DEFAULT_QUOTA_ALERT_ENABLED);
  const [quotaAlertThreshold, setQuotaAlertThreshold] =
    useState<QuotaAlertThreshold>(DEFAULT_QUOTA_ALERT_THRESHOLD);
  const [quotaAlertCooldownMin, setQuotaAlertCooldownMin] =
    useState(DEFAULT_QUOTA_ALERT_COOLDOWN_MIN);
  /** periodic 模式下「当前正处于 10 秒展开窗口」。 */
  const [quotaPeriodicOpen, setQuotaPeriodicOpen] = useState(false);
  /** 自包含气泡在无任何 provider 有有效套餐数据时不渲染额度区。 */
  const [quotaDataReady, setQuotaDataReady] = useState(false);
  /** 多 provider 归一化聚合模型（一次并发扇出，气泡展示与告警共用）。 */
  const [quotaAggregate, setQuotaAggregate] = useState<PetQuotaAggregate | null>(null);
  /** 告警状态机给出的 level 态（任一窗口 ≥ 阈值且未释放）。 */
  const [quotaAlertActive, setQuotaAlertActive] = useState(false);
  /** 右键菜单打开期间抑制本轮弹出；bump epoch 让周期定时器重新等满一个周期。 */
  const [quotaScheduleEpoch, setQuotaScheduleEpoch] = useState(0);
  const spriteRef = useRef<HTMLButtonElement>(null);
  /** 合并气泡容器；用其实际高度请求 main 向上扩高透明宿主窗口。 */
  const bubbleRef = useRef<HTMLDivElement>(null);
  /** main 实际准予的额外窗口高度（屏幕顶边不足时小于请求值）。 */
  const [grantedBubbleExtra, setGrantedBubbleExtra] = useState(0);
  const frameRef = useRef(0);
  const alphaCanvas = useRef<HTMLCanvasElement | null>(null);
  const ignored = useRef(false);
  const feedbackTimer = useRef<number | null>(null);
  const syncFeedbackEnabledRef = useRef(false);
  const syncFeedbackDurationSecRef = useRef(DEFAULT_SYNC_FEEDBACK_DURATION_SEC);
  /** 告警状态机 state 跨渲染持久（Map 由 evaluateQuotaAlerts 每次整体替换）。 */
  const quotaAlertStateRef = useRef<ReadonlyMap<string, QuotaAlertStateEntry>>(new Map());
  /** 原生右键菜单打开期间不允许周期气泡弹出；下次左键交互清除。 */
  const quotaMenuOpenRef = useRef(false);
  /** IPC 异常只 console.warn 一次，不刷爆宠物主循环日志。 */
  const quotaWarnedRef = useRef(false);
  const dragState = useRef<{
    pointerId: number;
    screenX: number;
    screenY: number;
    moved: boolean;
  } | null>(null);
  const effectiveFrameIntervalMs = animation === 'idle'
    ? frameIntervalMs
    : Math.max(60, Math.round(frameIntervalMs * DRAG_ANIMATION_SPEED_MULTIPLIER));
  const layout = getDesktopPetLayout(scale);
  const { spriteWidth, spriteHeight } = layout;

  /**
   * Frame clock writes `backgroundPosition` on the sprite node. A React
   * setState loop would re-render the tree (and composite the transparent
   * window) on every idle cell, about 5–17 times a second.
   */
  useEffect(() => {
    const el = spriteRef.current;
    if (!el || !spritesheetUrl) return;
    const paint = () => {
      paintPetSpriteFrame(
        el,
        selectedPetId,
        animation,
        frameRef.current,
        spriteWidth,
        spriteHeight,
      );
    };
    paint();
    const timer = window.setInterval(() => {
      frameRef.current += 1;
      paint();
    }, effectiveFrameIntervalMs);
    return () => window.clearInterval(timer);
  }, [animation, selectedPetId, spritesheetUrl, spriteWidth, spriteHeight, effectiveFrameIntervalMs]);

  useEffect(() => window.tud.onDesktopPetAnimation(setAnimation), []);

  useEffect(() => {
    void window.tud.getDashboardRange().then(setRange);
    return window.tud.onDashboardRange(setRange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.tud.getDesktopPet().then((pref) => {
      if (cancelled) return;
      setScale(pref.scale);
      setFrameIntervalMs(pref.frameIntervalMs);
      setSelectedPetId(pref.selectedPetId);
      syncFeedbackEnabledRef.current = pref.syncFeedbackEnabled === true;
      syncFeedbackDurationSecRef.current =
        typeof pref.syncFeedbackDurationSec === 'number'
          ? pref.syncFeedbackDurationSec
          : DEFAULT_SYNC_FEEDBACK_DURATION_SEC;
      setQuotaBubbleMode(pref.quotaBubbleMode ?? DEFAULT_QUOTA_BUBBLE_MODE);
      setQuotaBubbleIntervalMin(
        typeof pref.quotaBubbleIntervalMin === 'number'
          ? pref.quotaBubbleIntervalMin
          : DEFAULT_QUOTA_BUBBLE_INTERVAL_MIN,
      );
      setQuotaAlertEnabled(pref.quotaAlertEnabled === true);
      setQuotaAlertThreshold(pref.quotaAlertThreshold ?? DEFAULT_QUOTA_ALERT_THRESHOLD);
      setQuotaAlertCooldownMin(
        typeof pref.quotaAlertCooldownMin === 'number'
          ? pref.quotaAlertCooldownMin
          : DEFAULT_QUOTA_ALERT_COOLDOWN_MIN,
      );
    });
    const unsubscribe = window.tud.onDesktopPetPreferences((pref) => {
      setScale(pref.scale);
      setFrameIntervalMs(pref.frameIntervalMs);
      setSelectedPetId(pref.selectedPetId);
      syncFeedbackEnabledRef.current = pref.syncFeedbackEnabled === true;
      syncFeedbackDurationSecRef.current =
        typeof pref.syncFeedbackDurationSec === 'number'
          ? pref.syncFeedbackDurationSec
          : DEFAULT_SYNC_FEEDBACK_DURATION_SEC;
      setQuotaBubbleMode(pref.quotaBubbleMode ?? DEFAULT_QUOTA_BUBBLE_MODE);
      setQuotaBubbleIntervalMin(
        typeof pref.quotaBubbleIntervalMin === 'number'
          ? pref.quotaBubbleIntervalMin
          : DEFAULT_QUOTA_BUBBLE_INTERVAL_MIN,
      );
      setQuotaAlertEnabled(pref.quotaAlertEnabled === true);
      setQuotaAlertThreshold(pref.quotaAlertThreshold ?? DEFAULT_QUOTA_ALERT_THRESHOLD);
      setQuotaAlertCooldownMin(
        typeof pref.quotaAlertCooldownMin === 'number'
          ? pref.quotaAlertCooldownMin
          : DEFAULT_QUOTA_ALERT_COOLDOWN_MIN,
      );
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => { alphaCanvas.current = null; }, [selectedPetId]);

  useEffect(() => {
    let cancelled = false;
    void window.tud.getDesktopPetCatalog().then((catalog) => {
      if (!cancelled) setPets(catalog.pets);
    });
    return () => { cancelled = true; };
  }, [selectedPetId]);

  // Load only the selected pet's atlas; unchosen spritesheets stay unloaded.
  useEffect(() => {
    let cancelled = false;
    setSpritesheetUrl(null);
    void loadPetSpritesheet(selectedPetId).then((url) => {
      if (!cancelled) setSpritesheetUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPetId]);

  /**
   * 今日统计拉取/轮询。三种激活源（resolveMergedPetBubble 单一决策）：
   *   - off：点击 sprite 展开时；
   *   - persistent：常驻期间持续轮询；
   *   - periodic：即使在两次 10s 展开窗口之间也保持预取，弹出即有数据。
   * 本地 /dashboard 聚合很轻，30s 轮询 + onDataSynced 强刷，不打爆接口。
   */
  const summaryPollActive =
    isTokenTooltipOpen || quotaBubbleMode === 'persistent' || quotaBubbleMode === 'periodic';
  useEffect(() => {
    if (!summaryPollActive) return;
    let cancelled = false;
    setSummary(null);
    setSummaryError(false);
    const load = () => {
      void fetchRangeTotals(range)
        .then((next) => {
          if (cancelled) return;
          setSummary(next);
        })
        .catch(() => { if (!cancelled) setSummaryError(true); });
    };
    load();
    const pollTimer = window.setInterval(load, SUMMARY_POLL_MS);
    const unsubscribe = window.tud.onDataSynced(load);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      unsubscribe();
    };
  }, [summaryPollActive, range]);

  useEffect(() => {
    const clearFeedbackTimer = () => {
      if (feedbackTimer.current !== null) {
        window.clearTimeout(feedbackTimer.current);
        feedbackTimer.current = null;
      }
    };

    const unsubscribe = window.tud.onDataSynced((feedback) => {
      if (!syncFeedbackEnabledRef.current || !feedback || dragState.current) return;
      clearFeedbackTimer();
      setIsTokenTooltipOpen(false);
      setSyncFeedback(feedback);
      const durationMs = Math.max(1, syncFeedbackDurationSecRef.current) * 1000;
      feedbackTimer.current = window.setTimeout(() => {
        feedbackTimer.current = null;
        setSyncFeedback(null);
      }, durationMs);
    });

    return () => {
      unsubscribe();
      clearFeedbackTimer();
    };
  }, []);

  /**
   * periodic 气泡时序：mount 不立即弹，首次等满一个周期；每次展开 10s 后收起，
   * 再等一个周期。切模式/改间隔/右键菜单（bump epoch）都会重跑本 effect，
   * 旧定时器全部清理。弹出瞬间若正在拖拽或原生菜单仍开着，本轮跳过、等下一周期。
   */
  useEffect(() => {
    if (quotaBubbleMode !== 'periodic') {
      // 切走 periodic 时立即收起，避免残留下一次渲染。
      setQuotaPeriodicOpen(false);
      return;
    }
    let cancelled = false;
    let showTimer = 0;
    let hideTimer: number | null = null;
    const periodMs = Math.max(1, quotaBubbleIntervalMin) * 60_000;

    const clearHide = () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
    const scheduleShow = (delayMs: number) => {
      showTimer = window.setTimeout(() => {
        if (cancelled) return;
        if (dragState.current || quotaMenuOpenRef.current) {
          scheduleShow(periodMs);
          return;
        }
        setQuotaPeriodicOpen(true);
        hideTimer = window.setTimeout(() => {
          hideTimer = null;
          if (cancelled) return;
          setQuotaPeriodicOpen(false);
          scheduleShow(periodMs);
        }, QUOTA_BUBBLE_VISIBLE_MS);
      }, delayMs);
    };

    scheduleShow(periodMs);
    return () => {
      cancelled = true;
      window.clearTimeout(showTimer);
      clearHide();
    };
  }, [quotaBubbleMode, quotaBubbleIntervalMin, quotaScheduleEpoch]);

  /**
   * 多 provider 订阅快照统一聚合拉取（气泡展示 + 阈值告警共用同一份）：
   * renderer 侧 Promise.allSettled 一次并发扇出 16 个通道，单家失败/未配置
   * 不影响其他家；main 侧每家各有 60s 缓存，轮询命中缓存不打爆网络。
   * SUBSCRIPTION_REFRESH_EVENT 触发 forceRefresh 强刷。任何全失败只 warn 一次。
   */
  const quotaPollActive = quotaAlertEnabled || quotaBubbleMode !== 'off';
  useEffect(() => {
    if (!quotaPollActive) {
      setQuotaDataReady(false);
      setQuotaAggregate(null);
      return;
    }
    let cancelled = false;

    const load = async (force: boolean) => {
      let outcome: Awaited<ReturnType<typeof fetchPetProviderSnapshots>>;
      try {
        outcome = await fetchPetProviderSnapshots(force);
      } catch (error) {
        if (!quotaWarnedRef.current) {
          quotaWarnedRef.current = true;
          console.warn('[desktop-pet] subscription aggregate fetch failed:', error);
        }
        return;
      }
      if (cancelled) return;
      if (outcome.hadFailure && !quotaWarnedRef.current) {
        quotaWarnedRef.current = true;
        console.warn('[desktop-pet] some subscription providers failed to load');
      }
      const aggregate = buildPetQuotaAggregate(outcome.entries, Date.now());
      setQuotaAggregate(aggregate);
      setQuotaDataReady(aggregate.sections.length > 0);
      if (!quotaAlertEnabled) return;

      const windows = aggregateToQuotaWindows(aggregate);
      const result = evaluateQuotaAlerts(windows, {
        threshold: quotaAlertThreshold,
        cooldownMs: Math.max(0, quotaAlertCooldownMin) * 60_000,
        nowMs: Date.now(),
        state: quotaAlertStateRef.current,
      });
      quotaAlertStateRef.current = result.state;
      setQuotaAlertActive(result.fired.length > 0 || result.activeKeys.length > 0);
    };

    void load(false);
    const onRefresh = () => {
      void load(true);
    };
    window.addEventListener(SUBSCRIPTION_REFRESH_EVENT, onRefresh);
    const pollTimer = window.setInterval(() => {
      void load(false);
    }, QUOTA_SUBSCRIPTION_POLL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener(SUBSCRIPTION_REFRESH_EVENT, onRefresh);
      window.clearInterval(pollTimer);
    };
  }, [
    quotaPollActive,
    quotaAlertEnabled,
    quotaAlertThreshold,
    quotaAlertCooldownMin,
  ]);

  // 关闭告警：立即解除跳动并清空状态机，下次开启从 armed 基线重新开始。
  useEffect(() => {
    if (!quotaAlertEnabled) {
      quotaAlertStateRef.current = new Map();
      setQuotaAlertActive(false);
    }
  }, [quotaAlertEnabled]);

  const setMouseIgnored = (shouldIgnore: boolean) => {
    if (shouldIgnore === ignored.current) return;
    ignored.current = shouldIgnore;
    window.tud.setDesktopPetMouseIgnored(shouldIgnore);
  };

  const loadAlphaMap = (image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = PET_SPRITESHEET_WIDTH;
    canvas.height = PET_SPRITESHEET_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0);
    alphaCanvas.current = canvas;
  };

  const updateMousePassThrough = (event: MouseEvent<HTMLButtonElement>) => {
    if (dragState.current) {
      setMouseIgnored(false);
      return;
    }
    const canvas = alphaCanvas.current;
    if (!canvas) return;
    const cell = petSpriteCell(selectedPetId, animation, frameRef.current);
    const pointerX = Math.max(
      0,
      Math.min(DESKTOP_PET_SOURCE_WIDTH - 1, Math.floor(event.nativeEvent.offsetX / scale)),
    );
    const x = cell.mirrorX ? DESKTOP_PET_SOURCE_WIDTH - 1 - pointerX : pointerX;
    const y = Math.max(
      0,
      Math.min(DESKTOP_PET_SOURCE_HEIGHT - 1, Math.floor(event.nativeEvent.offsetY / scale)),
    );
    const alpha = canvas.getContext('2d', { willReadFrequently: true })
      ?.getImageData(cell.sourceX + x, cell.sourceY + y, 1, 1).data[3] ?? 0;
    setMouseIgnored(alpha < 16);
  };

  /**
   * Pointer-down hands the whole drag to main, which polls the OS cursor and
   * moves its own window. The renderer keeps tracking the pointer only to tell
   * a click apart from a drag, and never sends per-move coordinates.
   */
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    // 左键重新交互即视为右键菜单抑制期结束（右键的 pointerdown 先于 contextmenu）。
    quotaMenuOpenRef.current = false;
    // Right-click / macOS ctrl-click open the native menu; do not start a drag.
    if (event.button !== 0 || event.ctrlKey) return;
    event.preventDefault();
    setMouseIgnored(false);
    if (feedbackTimer.current !== null) {
      window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    setSyncFeedback(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      moved: false,
    };
    window.tud.beginDesktopPetDrag();
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.moved) return;
    if (
      Math.abs(event.screenX - drag.screenX) > 3
      || Math.abs(event.screenY - drag.screenY) > 3
    ) {
      drag.moved = true;
      setIsTokenTooltipOpen(false);
      setQuotaPeriodicOpen(false);
    }
  };

  const finishDrag = (
    event?: PointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) => {
    const drag = dragState.current;
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    dragState.current = null;
    window.tud.endDesktopPetDrag();
    setAnimation('idle');
    if (event && event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
    if (!cancelled && !drag.moved) {
      if (quotaBubbleMode === 'off') {
        // off：点击切换整个气泡（仅今日统计）
        setIsTokenTooltipOpen((open) => !open);
      } else {
        // persistent/periodic：额度区不可被点击顶替；点击只折叠/展开今日区
        setIsTodayCollapsed((collapsed) => !collapsed);
      }
    }
  };

  useEffect(() => {
    const cancelDrag = () => finishDrag(undefined, true);
    // Do not preventDefault: main shows the native menu from webContents `context-menu`.
    const onContextMenu = () => {
      setIsTokenTooltipOpen(false);
      setSyncFeedback(null);
      // 菜单期间抑制周期气泡：立即收起，并让调度重等一个完整周期。
      setQuotaPeriodicOpen(false);
      quotaMenuOpenRef.current = true;
      setQuotaScheduleEpoch((epoch) => epoch + 1);
      if (feedbackTimer.current !== null) {
        window.clearTimeout(feedbackTimer.current);
        feedbackTimer.current = null;
      }
    };
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('contextmenu', onContextMenu);
      cancelDrag();
    };
  }, []);

  const pet = getDesktopPet(selectedPetId, pets);
  const mergedBubble = resolveMergedPetBubble({
    mode: quotaBubbleMode,
    periodicOpen: quotaPeriodicOpen,
    tooltipOpen: isTokenTooltipOpen,
    todayCollapsed: isTodayCollapsed,
    quotaReady: quotaDataReady,
    syncActive: syncFeedback !== null,
  });
  const isBubbleOpen = mergedBubble.bubbleVisible;

  /**
   * 把合并气泡的实际高度上报 main：默认窗口只在 sprite 上方预留
   * popoverTop-gap=108px，超出部分由 main 把透明宿主窗向上扩高（sprite
   * 屏幕位置不动）；main 不设固定 px 上限，只按屏幕顶边 ≥8px 动态钳制，
   * 因此正常密度下准予高度 == 内容高度，body max-height 恰好等于内容、
   * 不出滚动条；只有屏幕真的不够高时准予值偏小，body max-height + 内部
   * 滚动才作为极端兜底。ResizeObserver 覆盖今日三态/套餐异步加载引起的变高。
   */
  useLayoutEffect(() => {
    if (!isBubbleOpen) {
      setGrantedBubbleExtra(0);
      return;
    }
    const el = bubbleRef.current;
    if (!el) return;
    let cancelled = false;
    const report = () => {
      const height = el.offsetHeight;
      void window.tud.setDesktopPetBubbleHeight(height)
        .then((granted) => {
          if (!cancelled && typeof granted === 'number') setGrantedBubbleExtra(granted);
        })
        .catch(() => { /* IPC 不可用：退回固定预留高度 + 内部滚动 */ });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.tud.setDesktopPetBubbleHeight(0).catch(() => {});
    };
  }, [isBubbleOpen, scale]);

  const summaryState: 'error' | 'loading' | 'ready' =
    summaryError ? 'error' : summary === null ? 'loading' : 'ready';
  const bodyMaxHeight =
    layout.popoverTop - BUBBLE_GAP_PX - BUBBLE_VERTICAL_PADDING_PX + grantedBubbleExtra;
  let bubbleContent: JSX.Element | null = null;
  if (isBubbleOpen) {
    bubbleContent = syncFeedback ? (
      <PetSyncFeedbackContent feedback={syncFeedback} />
    ) : (
      <>
        {mergedBubble.showToday ? (
          <div className="desktop-pet-bubble-today">
            <div className="desktop-pet-bubble-range">{DASHBOARD_RANGE_LABELS[range]}</div>
            <PetStatRow
              dotClassName="desktop-pet-stat-dot--token"
              exactLabel={summary ? formatTokensExact(summary.totalTokens) : undefined}
              format={formatTokens}
              label="Token"
              state={summaryState}
              value={summary?.totalTokens ?? 0}
            />
            <PetStatRow
              dotClassName="desktop-pet-stat-dot--cost"
              format={formatUsd}
              label="费用"
              state={summaryState}
              value={summary?.totalCostUsd ?? 0}
            />
          </div>
        ) : null}
        {mergedBubble.showToday && mergedBubble.showQuota ? (
          <div aria-hidden="true" className="desktop-pet-bubble-divider" />
        ) : null}
        {mergedBubble.showQuota && quotaAggregate ? (
          <div className="desktop-pet-bubble-quota">
            <PetQuotaBubble aggregate={quotaAggregate} />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div
      className={
        window.tud?.platform === 'win32'
          ? 'desktop-pet-root desktop-pet-root--win'
          : 'desktop-pet-root'
      }
      onMouseMove={(event) => {
        if (!dragState.current && event.target === event.currentTarget) setMouseIgnored(true);
      }}
    >
      <img
        alt=""
        aria-hidden="true"
        className="desktop-pet-preload"
        src={spritesheetUrl ?? undefined}
        onLoad={(event) => loadAlphaMap(event.currentTarget)}
      />
      {isBubbleOpen ? (
        <div
          className="desktop-pet-bubble"
          onMouseEnter={() => setMouseIgnored(false)}
          ref={bubbleRef}
          style={{ width: layout.popoverWidth, bottom: spriteHeight + BUBBLE_GAP_PX }}
        >
          <div
            className="desktop-pet-bubble-body"
            style={{ maxHeight: bodyMaxHeight, overflowY: 'auto' }}
          >
            {bubbleContent}
          </div>
          <span aria-hidden className="desktop-pet-bubble-arrow" />
        </div>
      ) : null}
      <div
        className={
          quotaAlertActive ? 'desktop-pet-stage pet-alert-bounce' : 'desktop-pet-stage'
        }
        style={{
          width: spriteWidth,
          height: spriteHeight,
          left: layout.spriteLeft,
          top: layout.spriteTop,
          '--pet-glow-primary': pet.glow.primary,
          '--pet-glow-accent': pet.glow.accent,
        } as CSSProperties}
      >
        <button
          ref={spriteRef}
          aria-label={`${pet.displayName} 桌面宠物，点击展开或收起今日用量与套餐余量气泡，拖动可移动，右键打开菜单`}
          className="desktop-pet-sprite"
          onMouseMove={updateMousePassThrough}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finishDrag(event)}
          onPointerCancel={(event) => finishDrag(event, true)}
          onLostPointerCapture={(event) => finishDrag(event, true)}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          style={{
            width: spriteWidth,
            height: spriteHeight,
            backgroundImage: spritesheetUrl ? `url(${spritesheetUrl})` : undefined,
            backgroundSize: `${PET_SPRITESHEET_WIDTH * scale}px ${PET_SPRITESHEET_HEIGHT * scale}px`,
          }}
          type="button"
        />
      </div>
    </div>
  );
}

/** Compact celebration content shown inside the pet's lightweight bubble. */
function PetSyncFeedbackContent({ feedback }: { feedback: PetSyncFeedback }) {
  const milestones = [
    feedback.isDailyRecord ? '🎉 今日新高' : null,
    feedback.activeStreakDays >= 2
      ? `🔥 连续使用 ${feedback.activeStreakDays} 天`
      : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div
      aria-live="polite"
      className="desktop-pet-feedback"
      role="status"
    >
      <div className="desktop-pet-feedback-headline">
        <span
          aria-hidden
          className="desktop-pet-feedback-dot"
        />
        <span className="desktop-pet-feedback-text">
          <span className="desktop-pet-feedback-sign">+</span>
          <strong
            className="desktop-pet-feedback-amount"
            title={formatTokensExact(feedback.addedTokens)}
          >
            {formatTokens(feedback.addedTokens)}
          </strong>
          <span className="desktop-pet-feedback-unit">Token</span>
        </span>
      </div>
      {milestones.length > 0 && (
        <div className="desktop-pet-feedback-milestones">
          {milestones.map((milestone) => (
            <span key={milestone}>{milestone}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One bullet + label + rolling value row inside the pet bubble. */
function PetStatRow({
  dotClassName,
  exactLabel,
  format,
  label,
  state,
  value,
}: {
  dotClassName: string;
  exactLabel?: string;
  format: (value: number) => string;
  label: string;
  state: 'error' | 'loading' | 'ready';
  value: number;
}) {
  // Hold at 0 until data lands so the roll runs once, on the real value.
  const animatedValue = useAnimatedNumber(state === 'ready' ? value : 0);

  return (
    <div className="desktop-pet-stat">
      <span className="desktop-pet-stat-label">
        <span aria-hidden className={`desktop-pet-stat-dot ${dotClassName}`} />
        <span>{label}</span>
      </span>
      <span
        aria-label={exactLabel ? `${label} ${exactLabel}` : undefined}
        className="desktop-pet-stat-value"
        title={exactLabel}
      >
        {state === 'error' ? '--' : state === 'loading' ? '…' : format(animatedValue)}
      </span>
    </div>
  );
}
