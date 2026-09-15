// SPDX-License-Identifier: MIT
// renderer/components/PlanBalanceCard.tsx — 单个 Coding Plan 供应商余量卡（分卡布局）
//
// 2026-09-15 用户拍板：
//   - 多 provider 独立一卡，卡片标题=供应商名（MiniMax Coding / 火山方舟）
//   - 去除 per-card 5h/周/月 Tabs，主窗口固定 5h，周/月紧凑行
//   - section 标题栏下沉：每张卡头右侧放 "上次刷新" + 刷新按钮（HeroUI tertiary 与排行榜同款）
//   - 去除左边颜色圆点（状态点用 status 徽章文字表达：READY/PARTIAL/UNAVAILABLE）
//   - 5h 进度条样式清理：去掉 ring/border 装饰，只用 bg-default-50 容器
//   - 去掉底部"部分窗口缺少..."提示（窗口行内已显式标"无重置时间"，状态徽章 + tooltip 足够）
//   - partial 文案（fda262e 后的"产品系列名"替换）：使用 plan_label 直传
//
// 风格：与 UsageDistributionCard / ToolModelUsagePanel 对齐
//   - Card rounded-2xl + Card.Header flex-row + Card.Title/Description
//   - HeroUI v3 语义 token (surface / accent / muted / foreground / success/warning/danger)
//
// 纯展示逻辑（排序/窗口选择等）抽到 lib/plan-balance-view.ts 以便分层单测。

import { Button, Card } from '@heroui/react';
import { cn } from '@/lib/utils';
import type { PlanBalance } from '../lib/plan-balance-types';
import {
  hasWindowPct,
  otherWindows,
  planTitle,
  selectWindow,
} from '../lib/plan-balance-view';
import { PlanBalanceWindowRow } from './PlanBalanceWindowRow';

const STATUS_BG: Record<string, string> = {
  ready: 'bg-success',
  partial: 'bg-warning',
  unavailable: 'bg-danger',
};

interface Props {
  plan: PlanBalance;
  lastUpdated: Date | null;
  onRefresh: () => void | Promise<void>;
}

export function PlanBalanceCard({ plan, lastUpdated, onRefresh }: Props) {
  // 主窗口固定 5h；周/月作为紧凑行展示
  const mainWindow = selectWindow(plan, 'five_hour');
  const hasMain = hasWindowPct(mainWindow);
  const headPct = hasMain ? mainWindow.remaining_pct : null;
  const rest = otherWindows(plan, mainWindow);
  const title = planTitle(plan);

  return (
    <Card
      className="h-full min-w-0 overflow-hidden rounded-2xl"
      role="region"
      aria-label={`${title} Coding Plan 余量`}
    >
      {/* 卡头：供应商名 + 状态徽章 + 上次刷新 + 刷新按钮（per-card 控件） */}
      <Card.Header className="flex-row flex-nowrap items-start justify-between gap-2 pb-0">
        <div className="min-w-0 flex-1">
          <Card.Title className="flex flex-wrap items-center gap-2">
            <span className="truncate">{title}</span>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white',
                STATUS_BG[plan.status],
              )}
              title="ready=全字段齐全 · partial=部分字段缺失 · unavailable=无数据/鉴权失败"
            >
              {plan.status}
            </span>
            {plan.stale && (
              <span
                className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning"
                title="数据可能陈旧（熔断 / 限流 / 超时）"
              >
                stale
              </span>
            )}
          </Card.Title>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5 text-[11px] text-muted">
          {lastUpdated && (
            <span className="tabular-nums" title={lastUpdated.toISOString()}>
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button
            className="h-7 min-h-7 shrink-0 px-2 text-[11px] font-normal"
            size="sm"
            variant="tertiary"
            onPress={() => {
              void onRefresh();
            }}
            aria-label={`手动刷新 ${title} Coding Plan 余量`}
          >
            刷新
          </Button>
        </div>
      </Card.Header>

      <Card.Content className="flex flex-col gap-3 pt-3">
        {plan.windows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">
            {'无窗口数据'}
          </p>
        ) : (
          <>
            {/* 主窗口大进度条（固定 5h） */}
            {hasMain && mainWindow && headPct != null && (
              <div className="space-y-1.5 rounded-medium bg-default-50/50 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-muted">
                    {mainWindow.window_label}
                    {mainWindow.model && (
                      <span className="ml-1 text-[10px] text-foreground/40">
                        · {mainWindow.model}
                      </span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-1.5 tabular-nums">
                    <strong className="text-2xl font-semibold tracking-tight text-foreground">
                      {headPct.toFixed(0)}%
                    </strong>
                    <span className="text-[11px] text-muted">剩余</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-default-100">
                  <div
                    className={cn('h-full rounded-full transition-all', STATUS_BG[plan.status])}
                    style={{ width: `${mainWindow.used_pct}%` }}
                    role="progressbar"
                    aria-valuenow={Math.round(mainWindow.used_pct ?? 0)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`已用 ${mainWindow.used_pct?.toFixed(1)}%`}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-foreground/60 tabular-nums">
                  <span>
                    已用{' '}
                    <span className="font-semibold text-foreground/80">
                      {mainWindow.used_pct?.toFixed(1)}%
                    </span>
                    {mainWindow.quota != null && mainWindow.used != null && (
                      <span className="ml-2">
                        {Math.round(mainWindow.used).toLocaleString()} /{' '}
                        {Math.round(mainWindow.quota).toLocaleString()}
                      </span>
                    )}
                  </span>
                  <span title={mainWindow.resets_at ?? ''}>
                    {mainWindow.resets_at ? `重置 ${mainWindow.resets_at}` : '无重置时间'}
                  </span>
                </div>
              </div>
            )}

            {/* 其它窗口（紧凑行；同 tier 不同 model 也会显示） */}
            {rest.length > 0 && (
              <div className="space-y-1">
                {rest.map((w) => (
                  <PlanBalanceWindowRow
                    key={`${w.window}-${w.model ?? ''}`}
                    window={w}
                    barClass={STATUS_BG[plan.status]}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </Card.Content>
    </Card>
  );
}
