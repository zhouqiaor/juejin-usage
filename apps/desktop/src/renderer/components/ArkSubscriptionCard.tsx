// SPDX-License-Identifier: MIT
// renderer/components/ArkSubscriptionCard.tsx -- Single-card tray component
import { useEffect, useRef, useState } from 'react';
import { SubscriptionUsageCard, type SubscriptionUsageCardData, } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { ArkTokenPacksBlock } from './ArkTokenPacksBlock';
import { SUBSCRIPTION_REFRESH_EVENT } from './SubscriptionOverviewSection';
import { arkPlanTitle, arkPlanSubtitle } from '../../shared/ark-subscription';

function arkRemaining(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.round((100 - usedPercent) * 100) / 100));
}

export function ArkSubscriptionCard() {
  const [data, setData] = useState<SubscriptionUsageCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async (force = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
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
          const metrics = sorted.slice(0, 3).map((w, idx) => ({
            color: idx === 0 ? '#f04142' : '#2b7eff',
            label: w.label,
            remainingPercent: arkRemaining(w.usedPercent),
          }));
          const showTokenBlock = snapshot.tokenPacks.length > 0 || Boolean(snapshot.tokenPacksError);
          // 副标题：Agent 档位按官方英文名规范化（small→Small），与「Agent Plan ·」组合
          const planSubtitle = arkPlanSubtitle(snapshot.planKind, snapshot.planLabel);
          setData({
            title: arkPlanTitle(snapshot.planKind),
            icon: <SubscriptionBrandIcon brand="volcengine" />,
            metrics,
            // planLabel 是套餐档位，作 10px 小字展示，不拼进标题撑宽；
            // token-only 账号也靠 footer 保住卡片框架（见 SubscriptionUsageCard 的空 metrics 例外）
            footer:
              planSubtitle || showTokenBlock ? (
                <>
                  {planSubtitle ? (
                    <p
                      className="text-[10px] leading-4 text-muted"
                      title={`套餐档位：${planSubtitle}`}
                    >
                      {planSubtitle}
                    </p>
                  ) : null}
                  {showTokenBlock ? (
                    <ArkTokenPacksBlock
                      packs={snapshot.tokenPacks}
                      errorText={snapshot.tokenPacksError}
                    />
                  ) : null}
                </>
              ) : undefined,
            stale: snapshot.stale,
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
        if (!cancelled) {
          setLoading(false);
          inFlight.current = false;
        }
      }
    };
    void fetchData();
    const onFocus = () => void fetchData(true);
    window.addEventListener('focus', onFocus);
    const onRefresh = () => void fetchData(true);
    window.addEventListener(SUBSCRIPTION_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(SUBSCRIPTION_REFRESH_EVENT, onRefresh);
    };
  }, []);

  if (!data) return null;
  return <SubscriptionUsageCard data={data} loading={loading} />;
}