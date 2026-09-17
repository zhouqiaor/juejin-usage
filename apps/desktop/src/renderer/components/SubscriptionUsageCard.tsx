import type { ReactNode } from 'react';
import { Card, Tooltip } from '@heroui/react';
import { ClockIcon } from 'lucide-react';
import { MetricBarRow } from './SubscriptionMetricBar';
import { useNowTick } from '../hooks/useNowTick';
import {
  buildResetTooltipText,
  type ResetTooltipWindow,
} from '../../shared/subscription-reset';
import {
  buildStaleTooltip,
  formatHHmmss,
  formatRelativeUpdate,
  freshnessColor,
  freshnessLevel,
} from '../../shared/freshness';

export interface SubscriptionUsageMetric {
  color: string;
  label: string;
  /** 标签悬浮全名（复合信息如重置时间放这里，不挤轨道与数字列） */
  labelTitle?: string;
  remainingPercent: number | null;
  /** Literal value for balances and credits; percentage remains the bar value. */
  valueText?: string;
  /** 窗口重置时刻（GMT+8 具体时钟，10px muted，进度条下方缩进对齐轨道）；不传/过期不渲染。 */
  resetLabel?: string;
}

export interface SubscriptionUsageCardData {
  /** Fixed-size LobeHub brand mark rendered in the card title bar. */
  icon?: ReactNode;
  metrics: readonly SubscriptionUsageMetric[];
  /** Optional supplementary block rendered under the progress bars (e.g. Ark 免费推理额度). */
  footer?: ReactNode;
  stale?: boolean;
  /** 快照抓取时间（unix 秒），用于角标分级与「更新于 …」实时时间。 */
  fetchedAt?: number | null;
  /** 最近一次刷新失败原因（IPC 快照里的 message），进 stale 角标 tooltip。 */
  errorMessage?: string | null;
  title: string;
  /**
   * Title hover tooltip 用的完整名（不被 truncate 截断）。仅当 title 在窄托盘里
   * 被截断时由调用方传入；不传则 hover 只显 stale/freshTitle（若有）。
   */
  titleFull?: string;
  /**
   * 副标题（10px muted）渲染在标题正下方：套餐档位/品牌模型这类「不进最大标题
   * 但需要可视」的元信息。不传则不渲染，不挤卡片头部。
   */
  subtitle?: ReactNode;
  /**
   * 卡片右上角「重置时间」图标按钮的 tooltip 多行文本。
   * 由调用方算好后传入（保持渲染层无业务语义），空/undefined 时按钮整体不渲染。
   * 调用方通常直接传 buildResetTooltipText(windows, nowSec)。
   */
  resetTooltip?: string | null;
  /**
   * 用于在 resetTooltip 未预计算时由卡片现算 tooltip 的窗口数据。
   * 与 resetTooltip 二选一：resetTooltip 优先（已算好的字符串跳过二次格式化）。
   * 给 Ark/MiniMax/Cursor 的窗口数据原始 resetsAt 传入，
   * 卡片用自身 useNowTick（30s 一跳）刷新 tooltip 文案。
   */
  resetWindows?: ReadonlyArray<ResetTooltipWindow>;
}

interface SubscriptionUsageCardProps {
  data: SubscriptionUsageCardData;
  loading: boolean;
  /** 传入后 stale 角标/更新时间可点击触发强制刷新；不传则不可点（其他卡零回归）。 */
  onRetry?: () => void;
  /** 强制刷新进行中：角标显「刷新中…」且暂时不可点。 */
  retrying?: boolean;
}

/** Shared tray presentation for subscription allowance progress bars. */
export function SubscriptionUsageCard({
  data,
  loading,
  onRetry,
  retrying = false,
}: SubscriptionUsageCardProps) {
  // 30s 一跳，让「n 分钟前更新」随墙钟走动；hook 必须在早返回之前调用。
  const nowSec = Math.floor(useNowTick() / 1000);

  const visibleMetrics = data.metrics.filter(
    (metric): metric is SubscriptionUsageMetric & { remainingPercent: number } =>
      metric.remainingPercent !== null,
  );

  // Keep the tray focused on subscriptions with usable allowance data. Empty
  // or in-flight channels do not reserve a card-sized gap in the popover.
  // 例外：metrics 为空但带 footer（Ark token-only 账号：无套餐窗口、只有免费推理额度区）
  // 时仍渲染卡片框架，仅不渲染进度条区。
  if (loading || (visibleMetrics.length === 0 && !data.footer)) return null;

  const level = freshnessLevel(Boolean(data.stale), data.fetchedAt, nowSec);
  const warnColor = freshnessColor(level);
  const isStale = level !== 'fresh';
  const canRetry = Boolean(onRetry) && !retrying;
  const staleTooltip = isStale
    ? buildStaleTooltip(data.fetchedAt, data.errorMessage, canRetry)
    : undefined;

  // 正常态：绝对时间不占视觉层级，只挂标题行 tooltip；stale 态：显相对时间（分钟粒度，本就无秒），跟随警告色。
  const staleText =
    isStale && data.fetchedAt != null
      ? formatRelativeUpdate(data.fetchedAt, nowSec)
      : '';
  // 标题 hover tooltip：titleFull（truncate 后备全名）与 fresh 数据时间双行拼接；
  // stale 态不显 fresh 数据时间（信息已被 stale 角标接管）。
  const freshHover =
    !isStale && data.fetchedAt != null
      ? `数据更新于 ${formatHHmmss(data.fetchedAt)}`
      : undefined;
  const titleHover = data.titleFull
    ? [data.titleFull, freshHover].filter(Boolean).join('\n')
    : freshHover;

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl p-3">
      <Card.Content className="grid grid-rows-[auto_auto] gap-2 p-0">
        <SubscriptionHeader
          data={data}
          nowSec={nowSec}
          staleBadge={renderStaleBadge({
            isStale,
            canRetry,
            warnColor,
            staleText,
            staleTooltip,
            onRetry,
            retrying,
          })}
          titleHover={titleHover}
        />
        {visibleMetrics.length > 0 ? (
          <SubscriptionProgressBars metrics={visibleMetrics} title={data.title} />
        ) : null}
        {data.footer}
      </Card.Content>
    </Card>
  );
}

function renderStaleBadge({
  isStale,
  canRetry,
  warnColor,
  staleText,
  staleTooltip,
  onRetry,
  retrying,
}: {
  isStale: boolean;
  canRetry: boolean;
  warnColor: string | null;
  staleText: string;
  staleTooltip: string | undefined;
  onRetry: (() => void) | undefined;
  retrying: boolean;
}): ReactNode {
  if (!isStale) return null;
  const colorStyle = warnColor ? { color: warnColor } : undefined;
  if (canRetry) {
    return (
      <button
        type="button"
        className="shrink-0 cursor-pointer bg-transparent p-0 text-[10px] font-medium leading-none disabled:cursor-default disabled:opacity-100"
        style={colorStyle}
        title={staleTooltip}
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? '刷新中…' : staleText || '数据延迟'}
      </button>
    );
  }
  return (
    <span
      className="shrink-0 text-[10px] font-medium leading-none"
      style={colorStyle}
      title={staleTooltip}
    >
      {staleText || '数据延迟'}
    </span>
  );
}

function SubscriptionHeader({
  data,
  nowSec,
  staleBadge,
  titleHover,
}: {
  data: SubscriptionUsageCardData;
  nowSec: number;
  staleBadge: ReactNode;
  titleHover: string | undefined;
}) {
  // resetTooltip 优先取已算好的字符串（Ark/MiniMax 自带 now tick 的卡片可直通），
  // 否则从 resetWindows 现算：让卡片自身的 useNowTick 30s 一跳驱动重置文案刷新。
  const resetTooltip =
    data.resetTooltip ??
    (data.resetWindows ? buildResetTooltipText(data.resetWindows, nowSec) : null);
  const hasSubtitle = data.subtitle != null && data.subtitle !== '' && data.subtitle !== false;
  return (
    <div className="flex min-w-0 items-start gap-3">
      {data.icon ? <div className="mt-0.5 shrink-0">{data.icon}</div> : null}
      <div className="min-w-0 flex-1">
        <p
          className="min-w-0 truncate text-xs font-semibold leading-5 text-foreground"
          title={titleHover}
        >
          {data.title}
        </p>
        {hasSubtitle ? (
          <p className="truncate text-[10px] leading-4 text-muted">{data.subtitle}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {resetTooltip ? (
          <Tooltip closeDelay={80} delay={100}>
            <button
              type="button"
              aria-label="重置时间"
              className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent p-0 text-muted transition-colors duration-150 hover:bg-surface-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
            >
              <ClockIcon aria-hidden className="size-3.5" />
            </button>
            <Tooltip.Content
              className="whitespace-pre-line px-2 py-1 text-[11px] leading-4"
              placement="top"
            >
              {resetTooltip}
            </Tooltip.Content>
          </Tooltip>
        ) : null}
        {staleBadge}
      </div>
    </div>
  );
}

function SubscriptionProgressBars({
  metrics,
  title,
}: {
  metrics: readonly (SubscriptionUsageMetric & { remainingPercent: number })[];
  title: string;
}) {
  return (
    <div className="grid min-h-12 auto-rows-5 content-start gap-1.5">
      {metrics.slice(0, 3).map((metric) => (
        <MetricBarRow
          key={metric.label}
          ariaLabel={`${title} ${metric.label}剩余 ${Math.round(metric.remainingPercent)}%`}
          color={metric.color}
          label={metric.label}
          // 重置时刻并入 label tooltip：与既有说明/「已用 x/y」用 · 连接；无附加信息时退化为重置文案
          labelTitle={
            [metric.labelTitle, metric.resetLabel].filter(Boolean).join(' · ') || undefined
          }
          percent={metric.remainingPercent}
          valueText={metric.valueText ?? `${Math.round(metric.remainingPercent)}%`}
        />
      ))}
    </div>
  );
}
