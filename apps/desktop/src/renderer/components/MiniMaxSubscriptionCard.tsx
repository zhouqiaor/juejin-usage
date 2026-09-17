// SPDX-License-Identifier: MIT
// renderer/components/MiniMaxSubscriptionCard.tsx — fork 扩展版
// 在上游基础上加：reset 倒计时、quota 数字（已用/总）、model 名、限流 badge、刷新事件
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  miniMaxHasRealCount,
  miniMaxRemainingPercent,
  miniMaxRemainingPercentText,
  retainMiniMaxSnapshotOnEmpty,
  type MiniMaxRateLimitWindow,
  type MiniMaxSubscriptionSnapshot,
} from '../../shared/minimax-subscription';
import { SubscriptionUsageCard } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { SUBSCRIPTION_REFRESH_EVENT } from './SubscriptionOverviewSection';
import { formatResetCountdown } from '../../shared/subscription-reset';

const INITIAL_SNAPSHOT: MiniMaxSubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  region: null,
  limits: [],
  fetchedAt: null,
  stale: false,
  message: null,
};

/** 形如 1234 / 1.2k / 1.2M */
function formatCount(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
}

export function MiniMaxSubscriptionCard() {
  const [snapshot, setSnapshot] = useState<MiniMaxSubscriptionSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const requestInFlight = useRef(false);

  const reload = useCallback(async (force = false) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const snap = await window.tud.getMiniMaxSubscription(force ? { forceRefresh: true } : undefined);
      setSnapshot((prev) => retainMiniMaxSnapshotOnEmpty(prev, snap));
      setNow(Math.floor(Date.now() / 1000));
    } catch {
      setSnapshot((prev) => retainMiniMaxSnapshotOnEmpty(
        prev,
        { ...INITIAL_SNAPSHOT, message: '暂时无法读取 MiniMax Code 订阅信息' },
      ));
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload(true);
    const onRefresh = () => void reload(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener(SUBSCRIPTION_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(SUBSCRIPTION_REFRESH_EVENT, onRefresh);
    };
  }, [reload]);

  // reset 倒计时每 30s 重算一次（避免 stale 文案）
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // stale 角标点击：强制刷新；in-flight 时忽略（角标显「刷新中…」）
  const handleRetry = useCallback(() => {
    if (requestInFlight.current) return;
    setRetrying(true);
    void reload(true).finally(() => setRetrying(false));
  }, [reload]);

  const titleText = snapshot.region === 'mainland' ? 'Minimax CN' : snapshot.region === 'global' ? 'Minimax' : 'Minimax';

  const rateLimited = snapshot.limits.some((l) => l.rateLimited);
  const models = Array.from(new Set(snapshot.limits.map((l) => l.modelName).filter(Boolean) as string[]));
  const titleSuffix = [
    rateLimited ? '· 限流' : '',
    models.length > 0 ? `· ${models.join('/')}` : '',
  ].filter(Boolean).join(' ');
  const fullTitle = titleSuffix ? `${titleText} ${titleSuffix}` : titleText;

  const metrics = snapshot.limits.map((limit: MiniMaxRateLimitWindow, index) => {
    const resetText = formatResetCountdown(limit.resetsAt, now);
    // MiniMax coding_plan/remains 只有百分比有信息量（count 恒为 0）：右值主显示
    // 剩余百分比（与其余 14 张订阅卡及进度条填充口径一致）；真实已用 count 仅在
    // usedCount/totalCount 均 >0 时降级进 tooltip（labelTitle 的「已用 x/y」）。
    const quotaText = miniMaxHasRealCount(limit)
      ? `${formatCount(limit.usedCount)}/${formatCount(limit.totalCount)}`
      : '';
    const labelTitle = quotaText ? `已用 ${quotaText}` : undefined;
    const remainingPercent = Number.isFinite(limit.usedPercent)
      ? miniMaxRemainingPercent(limit.usedPercent)
      : 0;
    return {
      color: index === 0 && snapshot.limits.length > 1 ? '#ff6a00' : '#2b7eff',
      // stale 不再用「旧」后缀：统一由骨架的更新时间/「数据延迟」chip 表达（见 freshness.ts）
      label: limit.label,
      labelTitle,
      remainingPercent,
      resetLabel: resetText ?? undefined,
      valueText: miniMaxRemainingPercentText(limit.usedPercent),
    };
  });

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="minimax" />,
        metrics,
        stale: snapshot.stale,
        fetchedAt: snapshot.fetchedAt,
        errorMessage: snapshot.message,
        title: fullTitle,
      }}
      loading={loading}
      onRetry={handleRetry}
      retrying={retrying}
    />
  );
}