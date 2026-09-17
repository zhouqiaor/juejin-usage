// SPDX-License-Identifier: MIT
// renderer/components/ArkSubscriptionCard.tsx -- Single-card tray component
import { useCallback, useEffect, useRef, useState } from 'react';
import { SubscriptionUsageCard, type SubscriptionUsageCardData, } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { ArkTokenPacksBlock } from './ArkTokenPacksBlock';
import { SUBSCRIPTION_REFRESH_EVENT } from './SubscriptionOverviewSection';
import { arkPlanTitle, arkPlanSubtitle } from '../../shared/ark-subscription';
import { formatResetCountdown } from '../../shared/subscription-reset';

function arkRemaining(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.round((100 - usedPercent) * 100) / 100));
}

export function ArkSubscriptionCard() {
  const [data, setData] = useState<SubscriptionUsageCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  // effect 内的 force 刷新入口挂到 ref，供 stale 角标点击调用（闭包不跨 effect）。
  // 注意：只有这个 ref 跨渲染；请求去重标志 inFlight 必须是 effect 局部变量（见 effect 内注释）。
  const forceRefreshRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 去重标志必须是 effect 局部变量，不能用跨 StrictMode 双挂载共享的 ref：
    // dev 下 effect mount→cleanup→mount，若第二次撞上第一次遗留的 inFlight
    // 会直接早退，而第一次的结果因 cancelled 被丢弃，卡片永久卡在 loading。
    let inFlight = false;
    const fetchData = async (force = false) => {
      if (inFlight) return;
      inFlight = true;
      try {
        const snapshot = await window.tud.getArkSubscription(force ? { forceRefresh: true } : undefined);
        if (cancelled) return;
        // 无套餐窗口但有免费推理额度（免费额度/资源包），或其查询失败需错误出口的账号也要出卡
        if (
          snapshot.status === 'ready' &&
          (snapshot.limits.length > 0 ||
            snapshot.tokenPacks.length > 0 ||
            Boolean(snapshot.tokenPacksError))
        ) {
          const sorted = [...snapshot.limits].sort((a, b) => {
            const order: Record<string, number> = { 'five-hour': 0, weekly: 1, monthly: 2 };
            return (order[a.id] ?? 99) - (order[b.id] ?? 99);
          });
          const nowSec = Math.floor(Date.now() / 1000);
          const metrics = sorted.slice(0, 3).map((w, idx) => ({
            color: idx === 0 ? '#f04142' : '#2b7eff',
            label: w.label,
            remainingPercent: arkRemaining(w.usedPercent),
            resetLabel: formatResetCountdown(w.resetsAt, nowSec) ?? undefined,
          }));
          const showTokenBlock = snapshot.tokenPacks.length > 0 || Boolean(snapshot.tokenPacksError);
          // 档位（官方英文名，如 Medium）显示在标题栏：「火山方舟 Agent Plan · Medium」
          const planSubtitle = arkPlanSubtitle(snapshot.planKind, snapshot.planLabel);
          const planTier = planSubtitle?.replace(/^[^·]*·\s*/, '').trim() || null;
          setData({
            title: planTier
              ? `${arkPlanTitle(snapshot.planKind)} · ${planTier}`
              : arkPlanTitle(snapshot.planKind),
            icon: <SubscriptionBrandIcon brand="volcengine" />,
            metrics,
            // token-only 账号靠 footer 保住卡片框架（见 SubscriptionUsageCard 的空 metrics 例外）
            footer: showTokenBlock ? (
              <ArkTokenPacksBlock
                packs={snapshot.tokenPacks}
                errorText={snapshot.tokenPacksError}
              />
            ) : undefined,
            stale: snapshot.stale,
            fetchedAt: snapshot.fetchedAt,
            errorMessage: snapshot.message,
          });
        } else {
          setData(null);
        }
      } catch (error) {
        // IPC reject / safeStorage 抛错不能变成 unhandled rejection：降级为不出卡
        if (!cancelled) {
          setData(null);
          console.warn('ArkSubscriptionCard: fetch subscription snapshot failed', error);
        }
      } finally {
        inFlight = false;
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void fetchData();
    forceRefreshRef.current = () => fetchData(true);
    const onFocus = () => void fetchData(true);
    window.addEventListener('focus', onFocus);
    const onRefresh = () => void fetchData(true);
    window.addEventListener(SUBSCRIPTION_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      forceRefreshRef.current = null;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(SUBSCRIPTION_REFRESH_EVENT, onRefresh);
    };
  }, []);

  // stale 角标点击：强制刷新。inFlight 是 effect 局部变量、此闭包读不到，
  // 防连点靠 retrying（骨架在 retrying 时也会禁用按钮点击）。
  const handleRetry = useCallback(() => {
    const run = forceRefreshRef.current;
    if (!run || retrying) return;
    setRetrying(true);
    void run().finally(() => setRetrying(false));
  }, [retrying]);

  if (!data) return null;
  return (
    <SubscriptionUsageCard
      data={data}
      loading={loading}
      onRetry={handleRetry}
      retrying={retrying}
    />
  );
}
