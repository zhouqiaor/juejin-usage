// SPDX-License-Identifier: MIT
// renderer/components/PetQuotaBubble.tsx -- 桌面宠物气泡内「套餐余量」极简展示
//
// 视觉对齐上区 PetStatRow：每家一行——左侧短名（+「旧」+ 套餐小字），
// 右侧大字剩余百分比。每家只给一个数字（5h 优先，无 5h 退化到最敏感窗口），
// 10 家也能在笔记本气泡内完整显示。7d/30d/tokenPacks 不进气泡（告警仍用
// 完整窗口，见 shared/pet-quota-integration.ts）。
//
// 注意：宠物窗口入口（pet.tsx）只加载 pet.css，没有 tailwind / heroui 主题层，
// 因此本组件只用内联样式，不引 heroui 组件。拉取/轮询/归一化在 DesktopPetView
// + shared/pet-quota-providers.ts；jsdom 缺位下不造组件测试。
import type { JSX } from 'react';
import type { PetQuotaAggregate, PetQuotaCompactRow } from '../../shared/pet-quota-providers';
import { projectToCompactRows } from '../../shared/pet-quota-providers';

const COLOR_TEXT = '#171717';
const COLOR_MUTED = '#737373';
/** 剩余 ≤20% 红、≤40% 橙、否则常规色（剩余越少越危险）。 */
const COLOR_DANGER = '#f04142';
const COLOR_WARN = '#f59e0b';

const gridStyle = {
  display: 'grid',
  gap: '2px',
  minWidth: 0,
  textAlign: 'left',
} as const;

function remainingColor(remainingPercent: number): string {
  if (remainingPercent <= 20) return COLOR_DANGER;
  if (remainingPercent <= 40) return COLOR_WARN;
  return COLOR_TEXT;
}

function CompactProviderRow({ row }: { row: PetQuotaCompactRow }) {
  const titleText = row.planLabel ? `${row.title} · ${row.planLabel}` : row.title;
  return (
    <div
      style={{
        alignItems: 'baseline',
        display: 'flex',
        gap: '4px',
        lineHeight: 1.2,
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: COLOR_TEXT,
          flexShrink: 0,
          fontSize: '11px',
          fontWeight: 600,
          maxWidth: '62%',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={titleText}
      >
        {row.title}
      </span>
      {row.stale ? (
        <span
          aria-label="数据可能已过期"
          style={{ color: COLOR_MUTED, flexShrink: 0, fontSize: '10px' }}
        >
          旧
        </span>
      ) : null}
      {row.planLabel ? (
        <span
          aria-hidden
          style={{
            color: COLOR_MUTED,
            flex: 1,
            fontSize: '10px',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={row.planLabel}
        >
          {row.planLabel}
        </span>
      ) : (
        <span aria-hidden style={{ flex: 1, minWidth: 0 }} />
      )}
      <span
        aria-hidden
        style={{ color: COLOR_MUTED, flexShrink: 0, fontSize: '9px' }}
      >
        {row.primaryLabel}
      </span>
      <strong
        aria-label={`${row.title} ${row.primaryLabel} 窗口剩余 ${row.remainingPercent}%`}
        style={{
          color: remainingColor(row.remainingPercent),
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
          fontSize: '13px',
          fontWeight: 600,
          textAlign: 'right',
          width: '34px',
        }}
      >
        {row.remainingPercent}%
      </strong>
    </div>
  );
}

/**
 * 套餐余量气泡内容（每家一行的极简投影）。
 * 纯展示：数据由 DesktopPetView 统一聚合拉取后通过 props 传入；
 * 无任何 provider 有有效数据时调用方根本不渲染本组件。
 */
export function PetQuotaBubble({ aggregate }: { aggregate: PetQuotaAggregate }): JSX.Element | null {
  const rows = projectToCompactRows(aggregate);
  if (rows.length === 0) return null;

  return (
    <div style={gridStyle}>
      <span
        style={{
          color: COLOR_TEXT,
          fontSize: '11px',
          fontWeight: 600,
          lineHeight: 1.2,
          marginBottom: '2px',
        }}
      >
        套餐余量
      </span>
      {rows.map((row) => (
        <CompactProviderRow key={row.key} row={row} />
      ))}
    </div>
  );
}
