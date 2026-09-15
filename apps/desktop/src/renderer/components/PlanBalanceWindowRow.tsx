// SPDX-License-Identifier: MIT
// renderer/components/PlanBalanceWindowRow.tsx — 单窗口紧凑行
//
// 风格：与 UsageDistributionCard 的 DistributionRowList 对齐
//   - 圆点 + 标签 + 数值（右对齐 tabular-nums）
//   - 下方进度条（h-1, rounded-full）
//   - 倒计时（10px, foreground/60）
// 不做跨字段相加（HANDOVER §0 铁律 #1）

import { cn } from '@/lib/utils';
import type { PlanWindow } from '../lib/plan-balance-types';

interface Props {
  window: PlanWindow;
  barClass?: string; // 父级传 color（bg-success / bg-warning / bg-danger）
}

const pctText = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);

export function PlanBalanceWindowRow({ window: w, barClass = 'bg-success' }: Props) {
  return (
    <div
      className="rounded-medium px-2 py-1.5"
      role="row"
      aria-label={`${w.window_label} 已用 ${pctText(w.used_pct)}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground/90">{w.window_label}</span>
        <span className="flex items-center gap-2 tabular-nums text-foreground/80">
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
          className={cn('h-full rounded-full transition-all', barClass)}
          style={{ width: `${w.used_pct ?? 0}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-foreground/60 tabular-nums">
        {w.model && <span>{w.model}</span>}
        <span title={w.resets_at ?? ''}>
          {w.resets_at ? `重置 ${w.resets_at}` : '无重置时间'}
        </span>
      </div>
    </div>
  );
}
