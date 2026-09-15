// SPDX-License-Identifier: MIT
// renderer/components/PlanBalanceSection.tsx — Dashboard 顶层 Coding Plan 余量区块
//
// 2026-09-15 用户拍板：
//   - section 标题栏去除，刷新按钮 + 上次刷新时间下沉到每张卡（per-card 控件）
//   - section 副标题删除（技术口径写到 docs/QUOTA-UI-SPEC §3 防双算契约）
//   - section aria-label 保留（无障碍）
//
// 风格: 与 UsageDistributionCard / ToolModelUsagePanel 一致（Card rounded-2xl）

import { Card } from '@heroui/react';
import { useEffect, useState } from 'react';
import type { TudApi } from '../../preload';
import { usePlanBalance } from '../hooks/usePlanBalance';
import type { PlanBalance } from '../lib/plan-balance-types';
import {
  DEFAULT_PLAN_BALANCE_LAYOUT,
  SEPARATE_GRID_CLASS,
  resolveLayout,
  sortBalances,
  type PlanBalanceLayout,
} from '../lib/plan-balance-view';
import { PlanBalanceCard } from './PlanBalanceCard';
import { PlanBalanceUnifiedCard } from './PlanBalanceUnifiedCard';
import { PlanBalanceEmptyState } from './PlanBalanceEmptyState';

type KeyStatus = { plan: string; configured: boolean; source: string };
type KeyStatusEnvelope = { success: boolean; message?: string; data?: KeyStatus[] };
const tudApi = (): TudApi['api'] | undefined => (window as unknown as { tud?: TudApi }).tud?.api;

// 布局单一事实源：默认分卡。将来改成读用户偏好（hook / localStorage / 设置）即可。
const LAYOUT: PlanBalanceLayout = resolveLayout(DEFAULT_PLAN_BALANCE_LAYOUT);

function SkeletonCard() {
  return (
    <Card className="h-full min-w-0 overflow-hidden rounded-2xl" variant="default">
      <Card.Content className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-default-100" />
        <div className="h-10 w-full animate-pulse rounded bg-default-50" />
      </Card.Content>
    </Card>
  );
}

export function PlanBalanceSection() {
  const { data, loading, error, lastUpdated, fetchOk, refreshing, refresh } = usePlanBalance();
  const [hasAnyKey, setHasAnyKey] = useState<boolean | null>(null);

  // 查凭证状态（一次性）
  useEffect(() => {
    let cancelled = false;
    const fn = tudApi()?.getPlanBalanceKeyStatus;
    if (!fn) {
      setHasAnyKey(false);
      return;
    }
    fn()
      .then((env: KeyStatusEnvelope) => {
        if (cancelled) return;
        setHasAnyKey(env.data?.some((s) => s.configured) ?? false);
      })
      .catch(() => {
        if (!cancelled) setHasAnyKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const balances = data?.balances ?? [];
  const hasData = balances.length > 0;
  const showSkeleton = loading && !data;
  const sorted: PlanBalance[] = sortBalances(balances);

  return (
    <section role="region" aria-label="Coding Plan 余量" className="mb-4 mt-4 space-y-4">
      {/* stale/fetchOk=false 指示已下沉到卡头（上次更新 x 分钟前 + 重试按钮），此处不再重复横幅 */}

      {showSkeleton ? (
        <div className={SEPARATE_GRID_CLASS}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : !hasData ? (
        <PlanBalanceEmptyState
          hasAnyKey={hasAnyKey !== false}
          errorMessage={error ?? undefined}
          onRefresh={refresh}
        />
      ) : LAYOUT === 'unified' ? (
        <PlanBalanceUnifiedCard plans={sorted} />
      ) : (
        <div className={SEPARATE_GRID_CLASS}>
          {sorted.map((plan) => (
            <PlanBalanceCard
              key={plan.plan}
              plan={plan}
              lastUpdated={lastUpdated}
              onRefresh={refresh}
              fetchOk={fetchOk}
              refreshing={refreshing}
            />
          ))}
        </div>
      )}
    </section>
  );
}
