// SPDX-License-Identifier: MIT
// renderer/components/PlanBalanceStatusDot.tsx — 6dp 三态圆点 + 三态徽章
//
// 状态颜色: 走 HeroUI v3 语义 token，自动适配深浅主题
//   ready     → bg-success
//   partial   → bg-warning
//   unavailable → bg-danger
//
// 无障碍铁律：状态不能只靠颜色。
//   - 圆点带 role="status" + aria-label（屏幕阅读器）
//   - PlanBalanceStatusBadge 同时给图标 + 中文文字（视力通道也不靠颜色）
//
// 2026-09-15 UX polish：新增 PlanBalanceStatusBadge（图标+文字），供分卡/合卡共用。

import { AlertTriangle, Check, CloudOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanStatus } from '../lib/plan-balance-types';
import { STATUS_BADGE_CLASS, STATUS_LABEL } from '../lib/plan-balance-view';

interface DotProps {
  status: PlanStatus;
  size?: number; // 默认 8 (2 × 4dp base)
  title?: string;
}

const DOT_COLOR: Record<PlanStatus, string> = {
  ready: 'bg-success',
  partial: 'bg-warning',
  unavailable: 'bg-danger',
};

const DOT_ARIA: Record<PlanStatus, string> = {
  ready: '就绪',
  partial: '部分可用',
  unavailable: '不可用',
};

const STATUS_ICON: Record<PlanStatus, LucideIcon> = {
  ready: Check,
  partial: AlertTriangle,
  unavailable: CloudOff,
};

export function PlanBalanceStatusDot({ status, size = 8, title }: DotProps) {
  return (
    <span
      role="status"
      aria-label={`${DOT_ARIA[status]}${title ? `: ${title}` : ''}`}
      className={cn('inline-block rounded-full', DOT_COLOR[status])}
      style={{ width: size, height: size }}
      title={title ?? DOT_ARIA[status]}
    >
      {/* 非颜色通道：屏幕阅读器始终拿到中文状态名（sr-only 兜底，aria-label 已表达） */}
      <span className="sr-only">{DOT_ARIA[status]}</span>
    </span>
  );
}

interface BadgeProps {
  status: PlanStatus;
  className?: string;
}

/** 三态徽章：底色 + 图标 + 中文文字（ready/partial/unavailable 不能仅靠颜色区分） */
export function PlanBalanceStatusBadge({ status, className }: BadgeProps) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5',
        'text-[10px] font-semibold tracking-wide text-white',
        STATUS_BADGE_CLASS[status],
        className,
      )}
      title="就绪=全字段齐全 · 部分可用=部分字段缺失 · 不可用=无数据/鉴权失败"
    >
      <Icon aria-hidden="true" className="size-2.5" strokeWidth={2.5} />
      {STATUS_LABEL[status]}
    </span>
  );
}
