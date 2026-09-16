// SPDX-License-Identifier: MIT
// renderer/components/SubscriptionMetricBar.tsx -- 订阅额度卡片统一进度条行
// 三列固定栅格：固定宽标签（truncate + title 全名）+ flex 轨道（固定起止）+ 固定宽右对齐等宽数字列。
import type { ReactNode } from 'react';
import { ProgressBar } from '@heroui/react';

/** 默认数字列宽：百分比 / ¥金额 / 短「已用/总额」均可容纳 */
export const METRIC_BAR_DEFAULT_VALUE_WIDTH = 'w-[72px]';

export interface MetricBarRowProps {
  /** 进度条填充颜色 */
  color: string;
  /** 左标签原文（固定宽、超长 truncate） */
  label: string;
  /** 标签悬浮 title；缺省用 label 本身 */
  labelTitle?: string;
  /** 进度条数值（0-100；如需视觉 clamp 由调用方处理） */
  percent: number;
  /** 无障碍标注，保持各卡片原有文案 */
  ariaLabel: string;
  /** 右值列内容（短等宽值：百分比 / 金额 / 单值） */
  valueText: ReactNode;
  /** 右值列宽类名（长复合值由调用方传更宽档位） */
  valueWidth?: string;
}

/**
 * 统一的订阅额度行：label(w-14) + gap-3 + track(flex-1, h-1.5) + gap-3 + value(固定宽右对齐)。
 * 列宽固定保证同一卡片内每行轨道左右起止完全一致。
 */
export function MetricBarRow({
  color,
  label,
  labelTitle,
  percent,
  ariaLabel,
  valueText,
  valueWidth = METRIC_BAR_DEFAULT_VALUE_WIDTH,
}: MetricBarRowProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className="w-14 shrink-0 truncate text-[11px] font-medium text-muted"
        title={labelTitle ?? label}
      >
        {label}
      </span>
      <ProgressBar
        aria-label={ariaLabel}
        className="min-w-0 flex-1"
        maxValue={100}
        size="sm"
        style={{
          gap: 0,
          gridTemplateAreas: '"track"',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gridTemplateRows: 'auto',
        }}
        value={percent}
      >
        <ProgressBar.Track className="h-1.5 rounded-full bg-surface-secondary">
          <ProgressBar.Fill className="rounded-full" style={{ backgroundColor: color }} />
        </ProgressBar.Track>
      </ProgressBar>
      <span
        className={`${valueWidth} shrink-0 truncate text-right text-[11px] font-medium tabular-nums text-foreground`}
      >
        {valueText}
      </span>
    </div>
  );
}
