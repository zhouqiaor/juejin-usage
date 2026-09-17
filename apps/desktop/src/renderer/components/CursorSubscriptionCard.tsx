import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cursorRemainingPercent,
  type CursorSubscriptionSnapshot,
} from '../../shared/cursor-subscription';
import { SubscriptionUsageCard, type SubscriptionUsageMetric } from './SubscriptionUsageCard';
import { SubscriptionBrandIcon } from './SubscriptionBrandIcon';
import { useNowTick } from '../lib/useNowTick';
import { formatResetCountdown } from '../../shared/subscription-reset';
import { useSubscriptionPrefs } from '../lib/useSubscriptionPrefs';

const INITIAL_SNAPSHOT: CursorSubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  cursorModels: null,
  otherModels: null,
  plan: null,
  fetchedAt: null,
  stale: false,
  message: null,
};

/** Cursor subscription pools from the locally signed-in desktop account. */
export function CursorSubscriptionCard() {
  const subscriptionPrefs = useSubscriptionPrefs();
  const enabled = subscriptionPrefs.cursor;
  const [snapshot, setSnapshot] = useState<CursorSubscriptionSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef(false);

  const reload = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      setSnapshot(await window.tud.getCursorSubscription());
    } catch {
      setSnapshot({
        ...INITIAL_SNAPSHOT,
        message: '暂时无法读取 Cursor 订阅信息',
      });
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 开关关 = 完全不拉取；开关广播到达后 effect 重跑即时显隐。
    if (!enabled) return;
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload, enabled]);

  // 倒计时随 30s tick 重算；billingCycleEnd 缺失/过期时 formatResetCountdown 返回 null 不渲染
  const nowSec = Math.floor(useNowTick() / 1000);

  // 开关关闭：所有 hook 必须在此行之前调用（useNowTick 也是 hook）。
  if (!enabled) return null;
  const resetFor = (window: { resetsAt: number | null } | null): string | undefined =>
    window ? formatResetCountdown(window.resetsAt, nowSec) ?? undefined : undefined;

  const metrics: SubscriptionUsageMetric[] = snapshot.plan
    ? [{
        color: '#2b7eff',
        label: 'Plan',
        remainingPercent: cursorRemainingPercent(snapshot.plan.usedPercent),
        resetLabel: resetFor(snapshot.plan),
      }]
    : [
        {
          color: '#7dcf00',
          label: '套餐模型',
          labelTitle: 'cursor-auto 套餐内模型：包含在订阅套餐中的模型用量',
          remainingPercent: snapshot.cursorModels
            ? cursorRemainingPercent(snapshot.cursorModels.usedPercent)
            : null,
          resetLabel: resetFor(snapshot.cursorModels),
        },
        {
          color: '#2b7eff',
          label: 'API 模型',
          labelTitle: '其他模型按 API 用量计费（非套餐内模型池）',
          remainingPercent: snapshot.otherModels
            ? cursorRemainingPercent(snapshot.otherModels.usedPercent)
            : null,
          resetLabel: resetFor(snapshot.otherModels),
        },
      ];

  return (
    <SubscriptionUsageCard
      data={{
        icon: <SubscriptionBrandIcon brand="cursor" />,
        metrics,
        stale: snapshot.stale,
        fetchedAt: snapshot.fetchedAt,
        errorMessage: snapshot.message,
        title: 'Cursor',
      }}
      loading={loading}
    />
  );
}
