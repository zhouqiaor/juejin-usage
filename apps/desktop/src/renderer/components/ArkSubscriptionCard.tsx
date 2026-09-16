// SPDX-License-Identifier: MIT
// renderer/components/ArkSubscriptionCard.tsx -- Single-card tray component
import { useEffect, useRef, useState } from 'react';
import { SubscriptionUsageCard, type SubscriptionUsageCardData, } from './SubscriptionUsageCard';
import { SUBSCRIPTION_REFRESH_EVENT } from './SubscriptionOverviewSection';

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
        if (snapshot.status === 'ready' && snapshot.limits.length > 0) {
          const sorted = [...snapshot.limits].sort((a, b) => {
            const order: Record<string, number> = { 'five-hour': 0, weekly: 1, monthly: 2 };
            return (order[a.id] ?? 99) - (order[b.id] ?? 99);
          });
          const metrics = sorted.slice(0, 3).map((w, idx) => ({
            color: idx === 0 ? '#f04142' : '#2b7eff',
            label: w.label,
            remainingPercent: arkRemaining(w.usedPercent),
          }));
          setData({
            title: 'Ark Coding',
            icon: <span aria-hidden className="text-base font-bold text-red-600">A</span>,
            metrics,
            stale: snapshot.stale,
          });
        } else {
          setData(null);
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