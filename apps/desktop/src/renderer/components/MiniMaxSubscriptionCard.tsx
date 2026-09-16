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

const INITIAL_SNAPSHOT: MiniMaxSubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  region: null,
  limits: [],
  fetchedAt: null,
  stale: false,
  message: null,
};

/** Unix 秒时间戳 → "X 分钟/小时/天后重置" */
function formatReset(resetsAt: number | null, now: number): string {
  if (!resetsAt) return '';
  const sec = resetsAt - now;
  if (sec <= 0) return '即将重置';
  if (sec < 60) return `${sec} 秒后重置`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟后重置`;
  if (sec < 86400) return `${Math.round(sec / 3600)} 小时后重置`;
  const d = Math.round(sec / 86400);
  const h = Math.round((sec - d * 86400) / 3600);
  return h > 0 ? `${d} 天 ${h} 小时后重置` : `${d} 天后重置`;
}

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

  const titleText = snapshot.region === 'mainland' ? 'Minimax CN' : snapshot.region === 'global' ? 'Minimax' : 'Minimax';

  const rateLimited = snapshot.limits.some((l) => l.rateLimited);
  const models = Array.from(new Set(snapshot.limits.map((l) => l.modelName).filter(Boolean) as string[]));
  const titleSuffix = [
    rateLimited ? '· 限流' : '',
    models.length > 0 ? `· ${models.join('/')}` : '',
  ].filter(Boolean).join(' ');
  const fullTitle = titleSuffix ? `${titleText} ${titleSuffix}` : titleText;

  const metrics = snapshot.limits.map((limit: MiniMaxRateLimitWindow, index) => {
    const resetText = formatReset(limit.resetsAt, now);
    // MiniMax coding_plan/remains 只有百分比有信息量（count 恒为 0）：右值主显示
    // 剩余百分比（与其余 14 张订阅卡及进度条填充口径一致）；真实已用 count 仅在
    // usedCount/totalCount 均 >0 时降级进 tooltip（labelTitle 的「已用 x/y」）。
    const quotaText = miniMaxHasRealCount(limit)
      ? `${formatCount(limit.usedCount)}/${formatCount(limit.totalCount)}`
      : '';
    const labelTitle = [quotaText ? `已用 ${quotaText}` : '', resetText]
      .filter(Boolean)
      .join(' · ') || undefined;
    const remainingPercent = Number.isFinite(limit.usedPercent)
      ? miniMaxRemainingPercent(limit.usedPercent)
      : 0;
    return {
      color: index === 0 && snapshot.limits.length > 1 ? '#ff6a00' : '#2b7eff',
      label: snapshot.stale && index === 0 ? `${limit.label} 旧` : limit.label,
      labelTitle,
      remainingPercent,
      valueText: miniMaxRemainingPercentText(limit.usedPercent),
    };
  });

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="minimax" />,
        metrics,
        stale: snapshot.stale,
        title: fullTitle,
      }}
      loading={loading}
    />
  );
}