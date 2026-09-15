// SPDX-License-Identifier: MIT
// renderer/components/PlanBalanceWindowRow.tsx — 单窗口紧凑行
//
// 风格：与 UsageDistributionCard 的 DistributionRowList 对齐
//   - 标签 + 数值（右对齐 tabular-nums）
//   - 下方进度条（h-1, rounded-full）
//   - 倒计时（10px, foreground/60）
// 不做跨字段相加（HANDOVER §0 铁律 #1）
//
// 2026-09-15 UX polish：
//   - 进度条颜色改为 windowTone（used_pct 阈值 75/90），不再吃 provider 状态色
//   - 双语义标签：5h 窗口紧张 → 紫色「限流」；周/月紧张 → 琥珀/红「预算」
//     （颜色始终伴随文字，不能仅靠颜色）

import { cn } from '@/lib/utils';
import type { PlanWindow } from '../lib/plan-balance-types';
import { windowTone } from '../lib/plan-balance-view';

interface Props {
  window: PlanWindow;
}

const pctText = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);

export function PlanBalanceWindowRow({ window: w }: Props) {
  const tone = windowTone(w);
  return (
    <div
      className="rounded-medium px-2 py-1.5"
      role="row"
      aria-label={`${w.window_label} 已用 ${pctText(w.used_pct)}${tone.tag ? `（${tone.tag}）` : ''}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground/90">
          <span className="truncate">{w.window_label}</span>
          {tone.tag && tone.tagClass && (
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium leading-tight',
                tone.tagClass,
              )}
            >
              {tone.tag}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums text-foreground/80">
          <span>
            <span className="text-foreground/50">已用</span>{' '}
            <span className="font-semibold">{pctText(w.used_pct)}</span>
          </span>
          <span className="text-foreground/40">·</span>
          <span>
            <span className="text-foreground/50">剩余</span>{' '}
            <span className="font-semibold">{pctText(w.remaining_pct)}</span>
          </span>
        </span>
      </div>
      <div
        className="mt-1 h-1 w-full overflow-hidden rounded-full bg-default-100"
        role="progressbar"
        aria-valuenow={Math.round(w.used_pct ?? 0)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full transition-all', tone.barClass)}
          style={{ width: `${w.used_pct ?? 0}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-foreground/60 tabular-nums">
        <span>
          {w.model}
          {w.model && w.quota != null && w.used != null && w.quota > 0 && (
            <span className="ml-1.5">
              {Math.round(w.used).toLocaleString()} / {Math.round(w.quota).toLocaleString()}
            </span>
          )}
        </span>
        <span title={w.resets_at ?? ''}>
          {w.resets_at ? `重置 ${w.resets_at}` : '无重置时间'}
        </span>
      </div>
    </div>
  );
}
