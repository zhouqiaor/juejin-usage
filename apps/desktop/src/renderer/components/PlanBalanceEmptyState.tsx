// SPDX-License-Identifier: MIT
// renderer/components/PlanBalanceEmptyState.tsx — 全 unavailable 时的空态
//
// 风格：与 UsageDistributionCard 的 "暂无数据" + StatusBanner 对齐
//   - Card rounded-2xl + 居中 py-12
//   - HeroUI v3 语义 token (surface / accent / muted / foreground / warning / danger)
//   - 区分 "未配置 Key" vs "后端不可用"，避免给用户错误指引

import { Button, Card } from '@heroui/react';

interface Props {
  hasAnyKey: boolean;
  errorMessage?: string | null;
  onRefresh?: () => void;
}

export function PlanBalanceEmptyState({ hasAnyKey, errorMessage, onRefresh }: Props) {
  if (!hasAnyKey) {
    return (
      <Card
        className="h-full min-w-0 overflow-hidden rounded-2xl border border-default-200/40"
        role="status"
        aria-label="Coding Plan 余量：未配置 API Key"
      >
        <Card.Content className="flex w-full flex-col items-center justify-center gap-2 py-12 text-center">
          <div
            aria-hidden="true"
            className="size-3 rounded-full bg-default-300"
          />
          <p className="text-sm font-medium text-foreground">暂无可用 Coding Plan 余量数据</p>
          <p className="max-w-md text-xs text-muted">
            需在系统环境变量中至少配置以下一组：
            <br />
            <code className="rounded bg-default-100 px-1 py-0.5 font-mono text-[11px]">
              MINIMAX_API_KEY
            </code>
            （MiniMax Coding Plan）或
            <code className="rounded bg-default-100 px-1 py-0.5 font-mono text-[11px]">
              VOLC_ACCESS_KEY_ID
            </code>
            <code className="rounded bg-default-100 px-1 py-0.5 font-mono text-[11px]">
              VOLC_SECRET_ACCESS_KEY
            </code>
            （火山方舟 Coding Plan）后重启桌面。
          </p>
        </Card.Content>
      </Card>
    );
  }
  return (
    <Card
      className="h-full min-w-0 overflow-hidden rounded-2xl border border-warning/30"
      role="status"
      aria-label="Coding Plan 余量：后端不可用"
    >
      <Card.Content className="flex w-full flex-col items-center justify-center gap-2 py-12 text-center">
        <div
          aria-hidden="true"
          className="size-3 rounded-full bg-warning"
        />
        <p className="text-sm font-medium text-warning">Coding Plan 余量后端不可用</p>
        <p className="max-w-md text-xs text-muted">
          拉取 <code className="rounded bg-default-100 px-1 py-0.5 font-mono text-[11px]">
            plan_balance.py
          </code> 失败：{errorMessage ?? 'spawn 超时 / 解析错误 / 后端 5s 内未响应'}
        </p>
        {onRefresh && (
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            onPress={() => onRefresh()}
            aria-label="手动重试 Coding Plan 余量"
          >
            手动重试
          </Button>
        )}
      </Card.Content>
    </Card>
  );
}
