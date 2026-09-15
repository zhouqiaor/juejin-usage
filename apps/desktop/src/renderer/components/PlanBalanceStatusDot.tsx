// SPDX-License-Identifier: MIT
// renderer/components/PlanBalanceStatusDot.tsx — 6dp 三态圆点
//
// 状态颜色: 走 HeroUI v3 语义 token，自动适配深浅主题
//   ready     → bg-success
//   partial   → bg-warning
//   unavailable → bg-danger
//
// ARIA: role="status" + aria-label 状态名（屏幕阅读器）
// 可访问性: 不只靠颜色，伴随 text 内嵌（"已用 32% / 5h 窗口"）

import type { PlanStatus } from '../lib/plan-balance-types';

interface Props {
  status: PlanStatus;
  size?: number; // 默认 8 (2 × 4dp base)
  title?: string;
}

const COLOR: Record<PlanStatus, string> = {
  ready: 'bg-success',
  partial: 'bg-warning',
  unavailable: 'bg-danger',
};

const LABEL: Record<PlanStatus, string> = {
  ready: '就绪',
  partial: '部分',
  unavailable: '不可用',
};

export function PlanBalanceStatusDot({ status, size = 8, title }: Props) {
  return (
    <span
      role="status"
      aria-label={`${LABEL[status]}${title ? `: ${title}` : ''}`}
      className={`inline-block rounded-full ${COLOR[status]}`}
      style={{ width: size, height: size }}
      title={title ?? LABEL[status]}
    />
  );
}
