// SPDX-License-Identifier: MIT
// renderer/components/PlanBalanceEmptyState.tsx — 全 unavailable 时的空态
//
// 风格：与 UsageDistributionCard 的 "暂无数据" + StatusBanner 对齐
//   - Card rounded-2xl + 居中 py-12
//   - HeroUI v3 语义 token (surface / accent / muted / foreground / warning / danger)
//   - 区分 "未配置 Key" vs "后端不可用"，避免给用户错误指引
//
// 2026-09-15 UX polish：无 key 时补可操作指引——「去设置」按钮（AppShell 会把
//   /settings 路由转成设置弹窗）+ 环境变量名提示（只显示变量名，绝不显示 key 值）。

import { Button, Card } from '@heroui/react';
import { useNavigate } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';

interface Props {
  hasAnyKey: boolean;
  errorMessage?: string | null;
  onRefresh?: () => void;
}

export function PlanBalanceEmptyState({ hasAnyKey, errorMessage, onRefresh }: Props) {
  const navigate = useNavigate();
  if (!hasAnyKey) {
    return (
      <Card
        className="h-full min-w-0 overflow-hidden rounded-2xl border border-default-200/40"
        role="status"
        aria-label="Coding Plan 余量：未配置 API Key"
      >
        <Card.Content className="flex w-full flex-col items-center justify-center gap-2 py-12 text-center">
          <KeyRound aria-hidden="true" className="size-4 text-muted" />
          <p className="text-sm font-medium text-foreground">暂无可用 Coding Plan 余量数据</p>
          <p className="max-w-md text-xs text-muted">
            在设置中填写，或在系统环境变量中至少配置以下一组后重启桌面：
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
            （火山方舟 Coding Plan）。
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="primary"
            onPress={() => void navigate({ to: '/settings' })}
            aria-label="前往设置配置 Coding Plan API Key"
          >
            去设置
          </Button>
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
