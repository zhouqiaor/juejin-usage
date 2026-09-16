import type { ReactNode } from 'react';
import { Card } from '@heroui/react';
import { MetricBarRow } from './SubscriptionMetricBar';

export interface SubscriptionUsageMetric {
  color: string;
  label: string;
  /** 标签悬浮全名（复合信息如重置时间放这里，不挤轨道与数字列） */
  labelTitle?: string;
  remainingPercent: number | null;
  /** Literal value for balances and credits; percentage remains the bar value. */
  valueText?: string;
}

export interface SubscriptionUsageCardData {
  /** Fixed-size LobeHub brand mark rendered in the card title bar. */
  icon?: ReactNode;
  metrics: readonly SubscriptionUsageMetric[];
  /** Optional supplementary block rendered under the progress bars (e.g. Ark 免费推理额度). */
  footer?: ReactNode;
  stale?: boolean;
  title: string;
}

interface SubscriptionUsageCardProps {
  data: SubscriptionUsageCardData;
  loading: boolean;
}

/** Shared tray presentation for subscription allowance progress bars. */
export function SubscriptionUsageCard({
  data,
  loading,
}: SubscriptionUsageCardProps) {
  const visibleMetrics = data.metrics.filter(
    (metric): metric is SubscriptionUsageMetric & { remainingPercent: number } =>
      metric.remainingPercent !== null,
  );

  // Keep the tray focused on subscriptions with usable allowance data. Empty
  // or in-flight channels do not reserve a card-sized gap in the popover.
  // 例外：metrics 为空但带 footer（Ark token-only 账号：无套餐窗口、只有免费推理额度区）
  // 时仍渲染卡片框架，仅不渲染进度条区。
  if (loading || (visibleMetrics.length === 0 && !data.footer)) return null;

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl p-3">
      <Card.Content className="grid grid-rows-[1.5rem_auto] gap-2 p-0">
        <div className="flex min-w-0 items-center gap-3">
          {data.icon}
          <p className="min-w-0 truncate text-xs font-semibold text-foreground">
            {data.title}
          </p>
          {data.stale ? (
            <span className="shrink-0 text-[10px] text-muted">旧</span>
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
    <div className="grid min-h-12 auto-rows-5 content-start gap-1.5">
      {metrics.slice(0, 3).map((metric) => (
        <MetricBarRow
          key={metric.label}
          ariaLabel={`${title} ${metric.label}剩余 ${Math.round(metric.remainingPercent)}%`}
          color={metric.color}
          label={metric.label}
          labelTitle={metric.labelTitle}
          percent={metric.remainingPercent}
          valueText={metric.valueText ?? `${Math.round(metric.remainingPercent)}%`}
        />
      ))}
    </div>
  );
}
