// SPDX-License-Identifier: MIT
// renderer/components/PlanBalanceUnifiedCard.tsx — 多 provider 合并到一张大卡（unified 布局）
//
// 架构预留：默认布局是分卡（PlanBalanceCard × N）。当用户偏好「多 Coding Plan 同卡」时，
// 由 PlanBalanceSection 的 layout='unified' 切换到本组件，组件层无需再改。
//
// 与分卡共用同一套纯逻辑（lib/plan-balance-view）与窗口行组件，保证两种布局口径一致。

import { Card, Tabs } from '@heroui/react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { PlanBalance } from '../lib/plan-balance-types';
import {
  WINDOW_TABS,
  hasWindowPct,
  otherWindows,
  planTitle,
  selectWindow,
  windowTone,
  type WindowKey,
} from '../lib/plan-balance-view';
import { PlanBalanceStatusBadge } from './PlanBalanceStatusDot';
import { PlanBalanceWindowRow } from './PlanBalanceWindowRow';

const STATUS_TEXT: Record<string, string> = {
  ready: 'text-success',
  partial: 'text-warning',
  unavailable: 'text-danger',
};

interface Props {
  plans: PlanBalance[];
}

function ProviderRow({ plan }: { plan: PlanBalance }) {
  const [selectedWindow, setSelectedWindow] = useState<WindowKey>('five_hour');
  const mainWindow = selectWindow(plan, selectedWindow);
  const hasMain = hasWindowPct(mainWindow);
  const headPct = hasMain ? mainWindow.remaining_pct : null;
  const rest = otherWindows(plan, mainWindow);
  const title = planTitle(plan);
  const mainTone = mainWindow ? windowTone(mainWindow) : null;

  return (
    <article
      className={cn(
        'space-y-2 rounded-medium border border-default-200/30 p-3',
        plan.status === 'unavailable' && 'opacity-60',
      )}
      aria-label={`${title} 窗口详情`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className="truncate text-sm font-semibold text-foreground">{title}</h4>
          {plan.stale && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
              陈旧
            </span>
          )}
          <PlanBalanceStatusBadge status={plan.status} />
        </div>
        {plan.windows.length > 0 && (
          <Tabs
            aria-label={`${title} 窗口切换`}
            className="w-fit shrink-0 text-center"
            selectedKey={selectedWindow}
            onSelectionChange={(key) => setSelectedWindow(String(key) as WindowKey)}
          >
            <Tabs.ListContainer>
              <Tabs.List
                aria-label={`${title} 窗口切换`}
                className="w-fit *:h-5 *:w-fit *:px-2 *:text-xs *:font-normal *:data-[selected=true]:text-accent-foreground"
              >
                {WINDOW_TABS.map((t) => {
                  const has = plan.windows.some((w) => w.window === t.key);
                  return (
                    <Tabs.Tab
                      id={t.key}
                      key={t.key}
                      isDisabled={!has}
                      className={!has ? 'opacity-40' : undefined}
                    >
                      <span className="text-[11px] font-normal">{t.label}</span>
                      <Tabs.Indicator className="bg-accent" />
                    </Tabs.Tab>
                  );
                })}
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
        )}
      </header>

      {plan.windows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">{plan.message || '无窗口数据'}</p>
      ) : (
        <>
          {hasMain && mainWindow && headPct != null && mainTone && (
            <div className="rounded-medium border border-default-200/40 p-2.5 ring-2 ring-accent">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                  {mainWindow.window_label}
                  {mainWindow.model && (
                    <span className="text-[10px] text-foreground/40">
                      · {mainWindow.model}
                    </span>
                  )}
                  {mainTone.tag && mainTone.tagClass && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-px text-[9px] font-medium leading-tight',
                        mainTone.tagClass,
                      )}
                    >
                      {mainTone.tag}
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
                  className={cn('h-full rounded-full transition-all', mainTone.barClass)}
                  style={{ width: `${mainWindow.used_pct ?? 0}%` }}
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
          {rest.length > 0 && (
            <div className="space-y-1">
              {rest.map((w) => (
                <PlanBalanceWindowRow
                  key={`${w.window}-${w.model ?? ''}`}
                  window={w}
                />
              ))}
            </div>
          )}
          {plan.message && plan.status !== 'ready' && (
            <p className={cn('text-[11px]', STATUS_TEXT[plan.status])} role="status">
              {plan.message}
            </p>
          )}
        </>
      )}
    </article>
  );
}

export function PlanBalanceUnifiedCard({ plans }: Props) {
  const summary = plans.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      acc.total += 1;
      return acc;
    },
    { ready: 0, partial: 0, unavailable: 0, total: 0 } as Record<string, number>,
  );

  return (
    <Card
      className="h-full min-w-0 overflow-hidden rounded-2xl"
      role="region"
      aria-label="Coding Plan 余量（全部 provider）"
    >
      <Card.Header className="flex-row flex-nowrap items-start justify-between gap-2 pb-0">
        <div className="min-w-0 flex-1">
          <Card.Title className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-accent" />
            <span className="truncate">Coding Plan 余量</span>
            <span className="text-xs font-normal text-muted">（{summary.total} provider）</span>
          </Card.Title>
          <Card.Description className="mt-0.5 truncate">
            余量口径来自 plan_balance.py · 与已用 token 正交 · 防双算 · {summary.ready}/
            {summary.total} ready · {summary.partial}/{summary.total} partial ·{' '}
            {summary.unavailable}/{summary.total} unavailable
          </Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4 pt-3">
        {plans.map((p) => (
          <ProviderRow key={p.plan} plan={p} />
        ))}
      </Card.Content>
    </Card>
  );
}
