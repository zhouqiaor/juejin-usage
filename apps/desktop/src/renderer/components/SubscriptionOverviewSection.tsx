// SPDX-License-Identifier: MIT
// renderer/components/SubscriptionOverviewSection.tsx -- shared subscription grid
// Used by both TrayPopoverView (macOS) and DashboardPage (Windows / cross-platform).
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

export function SubscriptionOverviewSection() {
  return (
    <section
      aria-label="订阅额度"
      className="grid grid-cols-2 gap-2.5 empty:hidden"
    >
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
  );
}