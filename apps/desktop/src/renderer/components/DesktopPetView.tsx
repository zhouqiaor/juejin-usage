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
  DESKTOP_PET_POPOVER_MAX_WIDTH,
  DESKTOP_PET_POPOVER_MIN_WIDTH,
  DESKTOP_PET_SOURCE_HEIGHT,
  DESKTOP_PET_SOURCE_WIDTH,
  getDesktopPetLayout,
  resolveBubbleBodyClip,
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
import { aggregateToMoodInput, aggregateToQuotaWindows } from '../../shared/pet-quota-integration';
import {
  PET_MOOD_RESET_FLASH_MS,
  resolvePetMood,
  type PetMoodResult,
} from '../../shared/pet-mood';
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
const DEFAULT_QUOTA_MOOD_ENABLED = true;
/**
 * loaded（承压档）下 idle 帧间隔倍率：180ms → 225ms，表现「慢下来」。
 * 帧时钟是 setInterval 直写 backgroundPosition（无 CSS animation-duration
 * 可调），倍率只作用于间隔表达式，不改时钟机制。原型取 1.5，M0 收敛为 1.25。
 */
const LOADED_MOOD_FRAME_FACTOR = 1.25;

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
  const [quotaMoodEnabled, setQuotaMoodEnabled] = useState(DEFAULT_QUOTA_MOOD_ENABLED);
  /** periodic 模式下「当前正处于 10 秒展开窗口」。 */
  const [quotaPeriodicOpen, setQuotaPeriodicOpen] = useState(false);
  /** 自包含气泡在无任何 provider 有有效套餐数据时不渲染额度区。 */
  const [quotaDataReady, setQuotaDataReady] = useState(false);
  /** 多 provider 归一化聚合模型（一次并发扇出，气泡展示与告警共用）。 */
  const [quotaAggregate, setQuotaAggregate] = useState<PetQuotaAggregate | null>(null);
  /** 告警状态机给出的 level 态（任一窗口 ≥ 阈值且未释放）。 */
  const [quotaAlertActive, setQuotaAlertActive] = useState(false);
  /** 最近一次 60s 快照评估出的宠物情绪（null = 尚无数据/mood pref 关）。 */
  const [moodResult, setMoodResult] = useState<PetMoodResult | null>(null);
  /** resetting 演出覆盖键：非 null 时 stage 强制挂 pet-mood-resetting，1.2s 后摘除。 */
  const [resetFlashKey, setResetFlashKey] = useState<string | null>(null);
  /** 右键菜单打开期间抑制本轮弹出；bump epoch 让周期定时器重新等满一个周期。 */
  const [quotaScheduleEpoch, setQuotaScheduleEpoch] = useState(0);
  const spriteRef = useRef<HTMLButtonElement>(null);
  /** 动效层：挂在 sprite 后、stage 内，mood 切换时挂 pet-mood-* class 触发 CSS 动画。 */
  const fxRef = useRef<HTMLSpanElement>(null);
  /** 合并气泡容器；用其实际宽度请求 main 对称扩宽透明宿主窗口。 */
  const bubbleRef = useRef<HTMLDivElement>(null);
  /**
   * 气泡内容包裹层：上报高度取自它的 scrollHeight（自然内容高度，不受自身
   * max-height 钳制），否则量到的永远是钳制后的 offsetHeight，窗口永远扩不够。
   */
  const bubbleBodyRef = useRef<HTMLDivElement>(null);
  /** main 实际准予的额外窗口高度（屏幕顶边不足时小于请求值）。 */
  const [grantedBubbleExtra, setGrantedBubbleExtra] = useState(0);
  /** 最近一次测得的 body 自然内容高度（px）；0 = 尚未测量/气泡关闭。 */
  const [naturalBodyHeight, setNaturalBodyHeight] = useState(0);
  const frameRef = useRef(0);
  const alphaCanvas = useRef<HTMLCanvasElement | null>(null);
  const ignored = useRef(false);
  const feedbackTimer = useRef<number | null>(null);
  const syncFeedbackEnabledRef = useRef(false);
  const syncFeedbackDurationSecRef = useRef(DEFAULT_SYNC_FEEDBACK_DURATION_SEC);
  /** 告警状态机 state 跨渲染持久（Map 由 evaluateQuotaAlerts 每次整体替换）。 */
  const quotaAlertStateRef = useRef<ReadonlyMap<string, QuotaAlertStateEntry>>(new Map());
  /** pet-mood reset 边沿去重：已演出过的最紧窗口 reset key（与告警机各自独立）。 */
  const moodResetKeyRef = useRef<string | null>(null);
  /**
   * hydrate seed：首轮评估只把已跨过的 reset key 记入记忆、不补闪（开机时
   * 用户没在看）；运行中新跨过的重置点才演 1.2s 闪光。pref 关再开不清 key
   * ref（同一 resetsAt 不演第二次），只在停轮询时复位本标记。
   */
  const moodHydratedRef = useRef(false);
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
  // loaded 档 idle 降速（180→225ms）；running 仍用拖拽倍率。纯表现参数，
  // 不含业务分支（情绪判定在 60s load 回调里）。
  const loadedMoodFactor = quotaMoodEnabled && moodResult?.mood === 'loaded'
    ? LOADED_MOOD_FRAME_FACTOR
    : 1;
  const effectiveFrameIntervalMs = animation === 'idle'
    ? Math.round(frameIntervalMs * loadedMoodFactor)
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
      setQuotaMoodEnabled(pref.quotaMoodEnabled ?? DEFAULT_QUOTA_MOOD_ENABLED);
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
      setQuotaMoodEnabled(pref.quotaMoodEnabled ?? DEFAULT_QUOTA_MOOD_ENABLED);
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
  // mood 也消费这份快照：默认组合（告警关/气泡关/mood 开）下轮询必须仍然开。
  const quotaPollActive = quotaMoodEnabled || quotaAlertEnabled || quotaBubbleMode !== 'off';
  useEffect(() => {
    if (!quotaPollActive) {
      setQuotaDataReady(false);
      setQuotaAggregate(null);
      // 停轮询时复位 mood 展示态与 hydrate 标记；故意不清 moodResetKeyRef：
      // 重新开启后同一 resetsAt 不二次演出（方案 §2.2）。
      setMoodResult(null);
      setResetFlashKey(null);
      moodHydratedRef.current = false;
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
      // 聚合、告警、mood 共用同一时间戳（告警毫秒 / mood 秒由各自层换算）。
      const nowMs = Date.now();
      const aggregate = buildPetQuotaAggregate(outcome.entries, nowMs);
      setQuotaAggregate(aggregate);
      setQuotaDataReady(aggregate.sections.length > 0);

      // 告警表现层：阈值/迟滞/冷却状态机，受告警 pref 闸门。
      if (quotaAlertEnabled) {
        const windows = aggregateToQuotaWindows(aggregate);
        const result = evaluateQuotaAlerts(windows, {
          threshold: quotaAlertThreshold,
          cooldownMs: Math.max(0, quotaAlertCooldownMin) * 60_000,
          nowMs,
          state: quotaAlertStateRef.current,
        });
        quotaAlertStateRef.current = result.state;
        setQuotaAlertActive(result.fired.length > 0 || result.activeKeys.length > 0);
      }

      // mood 表现层：与告警正交（不受 quotaAlertEnabled 闸门约束），只消费同一
      // 份聚合快照。业务判定全在这个 I/O 回调里，渲染层只拼 class。
      if (quotaMoodEnabled) {
        const moodInput = aggregateToMoodInput(aggregate);
        const result = resolvePetMood({
          ...moodInput,
          nowSec: Math.floor(nowMs / 1000),
          lastResetFireKey: moodResetKeyRef.current,
          quotaAlertThreshold,
        });
        setMoodResult(result);
        if (result.resetFiredKey) {
          moodResetKeyRef.current = result.resetFiredKey;
          // hydrate seed：首轮（开机/重开轮询）只记 key 不补闪。
          if (moodHydratedRef.current) setResetFlashKey(result.resetFiredKey);
        }
        moodHydratedRef.current = true;
      }
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
    quotaMoodEnabled,
    quotaAlertThreshold,
    quotaAlertCooldownMin,
  ]);

  // resetting 1.2s 闪光：class 加入时 CSS animation 自然播放一次，到期摘 class。
  // 不用 key 重挂节点——.desktop-pet-sprite 持有 spriteRef/帧时钟命令式写入与
  // pointer capture，重挂会空帧并打断拖拽（方案 §2.3）。
  useEffect(() => {
    if (!resetFlashKey) return;
    const timer = window.setTimeout(() => setResetFlashKey(null), PET_MOOD_RESET_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [resetFlashKey]);

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
   * 把合并气泡的实际尺寸上报 main：默认窗口只在 sprite 上方预留
   * popoverTop-gap=108px、四周 240px 宽的基础占位；气泡本体在 CSS 上是
   * width:max-content + [210,390] 夹取（宽度由内容决定、与窗口宽度无关，
   * 因此宽度测量不会回灌形成循环），超出的宽度由 main 围绕 sprite 中心线对称
   * 扩窗、高度向上扩高（sprite 屏幕位置不动）。
   *
   * 高度反馈环（死循环防护）：上报高度取 body 的 scrollHeight（自然内容高度，
   * 即使 body 当时正被 max-height 钳制也不受影响）；main 在 workArea 顶边允许
   * 范围内全额准予后，bodyMaxHeight 解除、不再滚动。绝不能报 offsetHeight——
   * 那是被 max-height 钳制后的值，窗口永远扩不够、滚动条永远在。ResizeObserver
   * 覆盖今日三态/套餐异步加载/宽度变化引起的文字重排变高，宽→重排→高的二次
   * 上报由同值去重收敛。rAF 微节流，乱序响应只接受最后一次；main 顶边真的不
   * 够（grant < want）时才给 body 加 max-height + 内部滚动兜底。
   */
  useLayoutEffect(() => {
    if (!isBubbleOpen) {
      setGrantedBubbleExtra(0);
      setNaturalBodyHeight(0);
      return;
    }
    const el = bubbleRef.current;
    if (!el) return;
    let cancelled = false;
    let rafId = 0;
    let lastSentKey: string | null = null;
    let latestSeq = 0;
    const report = () => {
      rafId = 0;
      if (cancelled) return;
      const body = bubbleBodyRef.current;
      // scrollHeight = 完整内容高度（含当前因 max-height 被裁掉的部分）；
      // 退回 offset 路径只在 body ref 缺失时发生。
      const naturalHeight = body
        ? body.scrollHeight + BUBBLE_VERTICAL_PADDING_PX
        : el.offsetHeight;
      if (naturalHeight > 0) setNaturalBodyHeight(naturalHeight - BUBBLE_VERTICAL_PADDING_PX);
      const size = { width: el.offsetWidth, height: naturalHeight };
      const key = `${size.width}x${size.height}`;
      if (key === lastSentKey) return;
      lastSentKey = key;
      const seq = ++latestSeq;
      void window.tud.setDesktopPetBubbleBounds(size)
        .then((granted) => {
          if (!cancelled && seq === latestSeq && typeof granted === 'number') {
            setGrantedBubbleExtra(granted);
          }
        })
        .catch(() => { /* IPC 不可用：退回固定预留高度 + 内部滚动 */ });
    };
    const schedule = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(report);
    };
    // 首次同步上报，赶在首帧绘制前把窗口扩到位，避免一帧的裁切。
    report();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    return () => {
      cancelled = true;
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      observer.disconnect();
      window.tud.setDesktopPetBubbleBounds({ width: 0, height: 0 }).catch(() => {});
    };
  }, [isBubbleOpen, scale]);

  const summaryState: 'error' | 'loading' | 'ready' =
    summaryError ? 'error' : summary === null ? 'loading' : 'ready';
  // 仅当 main 受 workArea 顶边所限、准予高度装不下自然内容时才钳制并滚动；
  // 准予足额时不加 max-height（纯函数，宽→重排→高反馈环收敛后滚动条消失）。
  const bodyClip = resolveBubbleBodyClip({
    naturalBodyHeightPx: naturalBodyHeight,
    grantedHeightExtra: grantedBubbleExtra,
    popoverTop: layout.popoverTop,
    gapPx: BUBBLE_GAP_PX,
    verticalPaddingPx: BUBBLE_VERTICAL_PADDING_PX,
  });
  const bodyStyle: CSSProperties | undefined = bodyClip.needsScroll
    ? { maxHeight: bodyClip.maxHeightPx ?? undefined, overflowY: 'auto' }
    : undefined;
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
          ref={bubbleRef}
          style={{
            bottom: spriteHeight + BUBBLE_GAP_PX,
          }}
        >
          <div
            className="desktop-pet-bubble-card"
            onMouseEnter={() => setMouseIgnored(false)}
            style={{
              maxWidth: DESKTOP_PET_POPOVER_MAX_WIDTH,
              minWidth: DESKTOP_PET_POPOVER_MIN_WIDTH,
            }}
          >
            <div
              className="desktop-pet-bubble-body"
              ref={bubbleBodyRef}
              style={bodyStyle}
            >
              {bubbleContent}
            </div>
          </div>
          <span aria-hidden className="desktop-pet-bubble-arrow" />
        </div>
      ) : null}
      <div
        className={[
          'desktop-pet-stage',
          quotaMoodEnabled && moodResult
            ? `pet-mood-${resetFlashKey ? 'resetting' : moodResult.mood}`
            : null,
          // bounce 只由告警 pref 驱动：默认组合（mood 开/告警关）下 ≥阈值只
          // 变红不跳。两表现层正交——让 mood 接管 bounce 会绕过用户显式关闭
          // 告警动画的意图（方案 §1.5）。
          quotaAlertActive ? 'pet-alert-bounce' : null,
        ].filter(Boolean).join(' ')}
        style={{
          width: spriteWidth,
          height: spriteHeight,
          left: layout.spriteLeft,
          bottom: 0,
          '--pet-glow-primary': pet.glow.primary,
          '--pet-glow-accent': pet.glow.accent,
          // mood 伪元素装饰（问号/汗珠/ring/趴窝位移）不在精灵 background 的
          // 缩放链里，固定 px 会在 scale=0.5 下大一倍；CSS 段据此按 scale 缩放。
          '--pet-mood-scale': String(scale),
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
        {/* 动效层：position:absolute inset:0 + z-index:2，在 sprite 上方、stage 内部。
            mood class 由渲染层拼接，CSS 驱动汗滴/脉冲/充能动画。
            不挂 stage 本体（stage 已有 bounce）；不挂 sprite（transform 每帧被帧时钟覆写）。 */}
        <span
          ref={fxRef}
          aria-hidden="true"
          className={quotaMoodEnabled && moodResult
            ? `desktop-pet-fx pet-mood-${resetFlashKey ? 'resetting' : moodResult.mood}`
            : 'desktop-pet-fx'}
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
