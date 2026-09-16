// SPDX-License-Identifier: MIT
// renderer/components/SubscriptionOverviewSection.tsx -- shared subscription grid
// Used by both TrayPopoverView (macOS) and DashboardPage (Windows / cross-platform).
import { useState } from 'react';
import { CodexSubscriptionCard } from './CodexSubscriptionCard';
import { ClaudeSubscriptionCard } from './ClaudeSubscriptionCard';
import { CursorSubscriptionCard } from './CursorSubscriptionCard';
import { GrokSubscriptionCard } from './GrokSubscriptionCard';
import { KimiSubscriptionCard } from './KimiSubscriptionCard';
import { ZcodeSubscriptionCard } from './ZcodeSubscriptionCard';
import { AntigravitySubscriptionCard } from './AntigravitySubscriptionCard';
import { QoderSubscriptionCard } from './QoderSubscriptionCard';
import { MiniMaxSubscriptionCard } from './MiniMaxSubscriptionCard';
import { DeepSeekSubscriptionCard } from './DeepSeekSubscriptionCard';
import { OpenCodeSubscriptionCard } from './OpenCodeSubscriptionCard';
import { TraeSubscriptionGroup } from './TraeSubscriptionGroup';
import { WorkBuddySubscriptionGroup } from './WorkBuddySubscriptionGroup';
import { ArkSubscriptionCard } from './ArkSubscriptionCard';

// [fork extension] 自定义事件：所有订阅卡组件监听，触发 force refresh
export const SUBSCRIPTION_REFRESH_EVENT = 'tud:subscription-refresh';

export function SubscriptionOverviewSection() {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_REFRESH_EVENT));
    // 150ms 后复位旋转图标（实际拉数由各卡自己完成）
    window.setTimeout(() => setRefreshing(false), 1500);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">订阅额度</h3>
        <button
          aria-label="刷新订阅额度"
          className="flex h-7 items-center gap-1 rounded-medium px-2 text-xs text-muted transition hover:bg-default-100 disabled:opacity-50"
          disabled={refreshing}
          type="button"
          onClick={onRefresh}
        >
          <svg
            aria-hidden="true"
            className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 4v6h6M20 20v-6h-6M20 8a8 8 0 00-14.94-3M4 16a8 8 0 0014.94 3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>刷新</span>
        </button>
      </div>
      <section aria-label="订阅额度" className="grid grid-cols-2 gap-2.5 empty:hidden">
        <CodexSubscriptionCard />
        <ClaudeSubscriptionCard />
        <CursorSubscriptionCard />
        <GrokSubscriptionCard />
        <KimiSubscriptionCard />
        <ZcodeSubscriptionCard />
        <AntigravitySubscriptionCard />
        <QoderSubscriptionCard />
        <MiniMaxSubscriptionCard />
        <ArkSubscriptionCard />
        <DeepSeekSubscriptionCard />
        <OpenCodeSubscriptionCard />
        <WorkBuddySubscriptionGroup />
        <TraeSubscriptionGroup />
      </section>
    </div>
  );
}