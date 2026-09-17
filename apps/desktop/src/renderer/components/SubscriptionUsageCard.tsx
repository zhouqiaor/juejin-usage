import type { ReactNode } from 'react';
import { Card } from '@heroui/react';
import { MetricBarRow } from './SubscriptionMetricBar';
import { useNowTick } from '../lib/useNowTick';
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
  const freshTitle =
    !isStale && data.fetchedAt != null
      ? `数据更新于 ${formatHHmmss(data.fetchedAt)}`
      : undefined;

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl p-3">
      <Card.Content className="grid grid-rows-[1.5rem_auto] gap-2 p-0">
        <div className="flex min-w-0 items-center gap-3">
          {data.icon}
          <p
            className="min-w-0 truncate text-xs font-semibold text-foreground"
            title={freshTitle}
          >
            {data.title}
          </p>
          {isStale ? (
            canRetry ? (
              <button
                type="button"
                className="shrink-0 cursor-pointer bg-transparent p-0 text-[10px] font-medium leading-none disabled:cursor-default disabled:opacity-100"
                style={warnColor ? { color: warnColor } : undefined}
                title={staleTooltip}
                onClick={onRetry}
                disabled={retrying}
              >
                {retrying ? '刷新中…' : staleText || '数据延迟'}
              </button>
            ) : (
              <span
                className="shrink-0 text-[10px] font-medium leading-none"
                style={warnColor ? { color: warnColor } : undefined}
                title={staleTooltip}
              >
                {staleText || '数据延迟'}
              </span>
            )
          ) : null}
        </div>
        {visibleMetrics.length > 0 ? (
          <SubscriptionProgressBars metrics={visibleMetrics} title={data.title} />
        ) : null}
        {data.footer}
      </Card.Content>
    </Card>
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
    <>
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
      {metrics[0]?.resetLabel ? (
        <p className="pl-[68px] pt-0.5 text-[10px] leading-3 text-muted">
          {metrics[0].resetLabel}
        </p>
      ) : null}
    </>
  );
}
