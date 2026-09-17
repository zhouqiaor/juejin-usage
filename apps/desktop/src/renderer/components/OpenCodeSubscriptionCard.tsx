import { useCallback, useEffect, useRef, useState } from 'react';
import {
  openCodeRemainingPercent,
  type OpenCodeSubscriptionSnapshot,
} from '../../shared/opencode-subscription';
import { SubscriptionUsageCard } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { formatResetCountdown } from '../../shared/subscription-reset';

const INITIAL_SNAPSHOT: OpenCodeSubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  limits: [],
  fetchedAt: null,
  stale: false,
  message: null,
};

/** Compact OpenCode Go subscription allowance summary for the macOS tray. */
export function OpenCodeSubscriptionCard() {
  const [snapshot, setSnapshot] = useState<OpenCodeSubscriptionSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);

  const reload = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      setSnapshot(await window.tud.getOpenCodeSubscription());
    } catch {
      setSnapshot({ ...INITIAL_SNAPSHOT, message: '暂时无法读取 OpenCode Go 订阅信息' });
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="opencode" />,
        metrics: snapshot.limits.map((limit, index) => ({
          color: index === 0 && snapshot.limits.length > 1 ? '#7dcf00' : '#2b7eff',
          label: limit.label,
          remainingPercent: openCodeRemainingPercent(limit.usedPercent),
          resetLabel: formatResetCountdown(limit.resetsAt, nowSec) ?? undefined,
        })),
        stale: snapshot.stale,
        title: 'OpenCode',
      }}
      loading={loading}
    />
  );
}
