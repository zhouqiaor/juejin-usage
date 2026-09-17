// SPDX-License-Identifier: MIT
// renderer/components/SubscriptionOverviewSection.tsx -- shared subscription grid
// Used by both TrayPopoverView (macOS) and DashboardPage (Windows / cross-platform).
import { useState } from 'react';
import { ArrowsRotateRight } from '@gravity-ui/icons';
import { Button, Tooltip } from '@heroui/react';
import { cn } from '@/lib/utils';
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
    <div className="space-y-1.5">
      <div className="flex justify-end">
        <Tooltip closeDelay={80} delay={100}>
          <Button
            aria-label="刷新订阅额度"
            className="h-5 min-h-5 w-5 min-w-5 rounded-full p-0 text-muted"
            isDisabled={refreshing}
            isIconOnly
            size="sm"
            variant="ghost"
            onPress={onRefresh}
          >
            <ArrowsRotateRight
              className={cn('size-3.5', refreshing && 'animate-spin')}
            />
          </Button>
          <Tooltip.Content
            className="px-2 py-1 text-xs"
            placement="top"
            showArrow
          >
            刷新订阅额度
          </Tooltip.Content>
        </Tooltip>
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