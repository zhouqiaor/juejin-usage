// SPDX-License-Identifier: MIT
// renderer/hooks/usePlanBalance.ts — Coding Plan 余量数据 hook
//
// 模式：仿 useDashboardData.ts (renderer/hooks/useDashboardData.ts:42-86)
// 差异（按 docs/QUOTA-UI-SPEC-2026-09-15.md §8）：
//   - POLL_MS = 30_000（余量变化慢，10s 浪费）
//   - retry 1 次（指数退避 1s/3s, 仿 cc-switch useQuotaKeepLastGood）
//   - 失败时保留 lastSuccess + 标 stale（不破坏 UI）
//   - visibilitychange + focus 立即拉一次
//   - 不依赖 rangeDays / selectedDate（余量是 per-provider，不是 per-range）
import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { TudApi } from '../../preload';
import type { PlanBalanceEnvelope, PlanBalanceSnapshot } from '../lib/plan-balance-types';

const POLL_MS = 30_000;
const STALE_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000];

export type PlanBalanceDataSource = 'api' | 'cache';

export interface PlanBalanceState {
  data: PlanBalanceSnapshot | null;
  source: PlanBalanceDataSource;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdated: Date | null;
  /** IPC 自身是否成功（false 时 data 仍可能 stale 有值） */
  fetchOk: boolean;
}

const empty: PlanBalanceState = {
  data: null,
  source: 'api',
  loading: true,
  refreshing: false,
  error: null,
  lastUpdated: null,
  fetchOk: false,
};

const tudApi = (): TudApi['api'] | undefined => (window as unknown as { tud?: TudApi }).tud?.api;

const getPlanBalance = (): Promise<PlanBalanceEnvelope<PlanBalanceSnapshot>> => {
  const fn = tudApi()?.getPlanBalance;
  if (!fn) {
    return Promise.resolve({
      success: false,
      message: 'preload 未暴露 getPlanBalance（IPC 未注册？）',
      data: { generated_at: new Date().toISOString(), snapshot: false, balances: [] },
    });
  }
  return fn();
};

const refreshPlanBalance = (): Promise<PlanBalanceEnvelope<PlanBalanceSnapshot>> => {
  const fn = tudApi()?.refreshPlanBalance;
  if (!fn) return getPlanBalance();
  return fn();
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Coding Plan 余量数据 hook。
 *
 * 返回: { data, source, loading, refreshing, error, lastUpdated, fetchOk, refresh }
 *
 * 行为:
 *   - 30s 轮询
 *   - visibilitychange + focus 立即拉一次
 *   - 失败 retry 1 次（指数退避 1s/3s）
 *   - 失败时保留 lastSuccess + 标 stale（不破坏 UI）
 */
export function usePlanBalance() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<PlanBalanceState>(empty);
  const cancelledRef = useRef(false);
  const lastSuccessRef = useRef<{
    data: PlanBalanceSnapshot;
    ts: number;
  } | null>(null);

  const fetchOnce = useCallback(async (isRefresh: boolean) => {
    if (cancelledRef.current) return;
    const start = Date.now();

    // 真实拉取（含 retry 1 次）
    let envelope: PlanBalanceEnvelope<PlanBalanceSnapshot> | null = null;
    let lastError: string | null = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        envelope = isRefresh && attempt === 0
          ? await refreshPlanBalance()
          : await getPlanBalance();
        if (envelope.success) break;
        lastError = envelope.message ?? 'unavailable';
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        envelope = null;
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }

    if (cancelledRef.current) return;

    if (envelope?.success && envelope.data) {
      // 成功
      lastSuccessRef.current = { data: envelope.data, ts: Date.now() };
      startTransition(() => {
        setState({
          data: envelope!.data!,
          source: 'api',
          loading: false,
          refreshing: false,
          error: null,
          lastUpdated: new Date(),
          fetchOk: true,
        });
      });
    } else {
      // 失败：保留 lastSuccess（stale fallback）
      const last = lastSuccessRef.current;
      const isStale = last && Date.now() - last.ts > STALE_MS;
      startTransition(() => {
        setState({
          data: last?.data ?? null,
          source: last ? 'cache' : 'api',
          loading: false,
          refreshing: false,
          error: lastError,
          lastUpdated: last ? new Date(last.ts) : null,
          fetchOk: false,
        });
      });
      // 仅用于提示，isStale 不影响渲染（lastUpdated 已透出时间）
      void isStale;
    }
    void start;
  }, []);

  // 首次 + 轮询 + revision 触发
  useEffect(() => {
    cancelledRef.current = false;
    const tick = () => fetchOnce(false);
    tick();
    const id = setInterval(tick, POLL_MS);

    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    const onFocus = () => tick();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelledRef.current = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchOnce, revision]);

  const refresh = useCallback(() => {
    setRevision((c) => c + 1);
    return fetchOnce(true);
  }, [fetchOnce]);

  return { ...state, refresh };
}
