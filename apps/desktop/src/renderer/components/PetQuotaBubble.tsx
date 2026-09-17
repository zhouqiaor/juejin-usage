// SPDX-License-Identifier: MIT
// renderer/components/PetQuotaBubble.tsx -- 桌面宠物气泡内「套餐余量」极简展示
//
// 每家一行两列（方案 B）：左列 title（长名 ellipsis）+ 同名去重后的窗口标签
// （`Minimax CN · 5h`；primaryLabel 与 title 归一化相同时不显示，消除
// `Cursor · Cursor`）；右列 11px 剩余百分比（色阶）+ 10px 灰色短重置时刻
// （今天 `HH:mm` / 今年跨天 `MM-dd` / 跨年 `YY-MM-dd`，GMT+8 具体时钟）。
// planLabel（Free/Medium 等）不进正文，只进 title 悬浮（`title · planLabel`）。
// 完整中文语义进 aria-label。
//
// 时刻为分钟级粒度，useNowTick 30s 一跳驱动重渲染；数字全部 tabular-nums，
// tick 时不抖宽。跨年形态（YY-MM-dd，8 字符）极罕见，允许撑宽右列而不截断；
// 7d/30d/tokenPacks 不进气泡（告警仍用完整窗口，见
// shared/pet-quota-integration.ts）。
//
// 注意：宠物窗口入口（pet.tsx）只加载 pet.css，没有 tailwind / heroui 主题层，
// 因此本组件只用内联样式，不引 heroui 组件。拉取/轮询/归一化在 DesktopPetView
// + shared/pet-quota-providers.ts；jsdom 缺位下不造组件测试。
import type { JSX } from 'react';
import type { PetQuotaAggregate, PetQuotaCompactRow } from '../../shared/pet-quota-providers';
import {
  formatCompactBubbleRow,
  projectToCompactRows,
} from '../../shared/pet-quota-providers';
import { useNowTick } from '../lib/useNowTick';

const COLOR_TEXT = '#171717';
const COLOR_MUTED = '#737373';
/** 剩余 ≤20% 红、≤40% 橙、否则常规色（剩余越少越危险）。 */
const COLOR_DANGER = '#f04142';
const COLOR_WARN = '#f59e0b';

/** 气泡行左右两列网格：左列 1fr 自适应（窄时 truncate），右列 auto 撑住
 *  `<percent>% <reset短形态>`，整行不挤压。 */
const ROW_GRID_TEMPLATE_COLUMNS = 'minmax(0, 1fr) auto';

function remainingColor(remainingPercent: number): string {
  if (remainingPercent <= 20) return COLOR_DANGER;
  if (remainingPercent <= 40) return COLOR_WARN;
  return COLOR_TEXT;
}

function CompactProviderRow({ row, nowSec }: { row: PetQuotaCompactRow; nowSec: number }) {
  const text = formatCompactBubbleRow(row, nowSec);
  // 行整体悬浮提示：planLabel（Free/Medium 等）只活在 title 里；有重置
  // 信息时附完整中文文案，hover 与读屏均可查到完整语义。
  const planHover = text.planLabel ? `${text.title} · ${text.planLabel}` : text.title;
  const rowTitle = text.resetTitle ? `${planHover}，${text.resetTitle}` : planHover;
  return (
    <div
      style={{
        alignItems: 'baseline',
        columnGap: '8px',
        display: 'grid',
        gridTemplateColumns: ROW_GRID_TEMPLATE_COLUMNS,
        lineHeight: 1.2,
      }}
      title={rowTitle}
    >
      <span
        style={{
          alignItems: 'baseline',
          color: COLOR_TEXT,
          display: 'inline-flex',
          fontSize: '11px',
          fontWeight: 600,
          gap: '4px',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            flex: '0 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {text.title}
        </span>
        {text.primaryLabel ? (
          <span
            aria-hidden
            style={{
              color: COLOR_MUTED,
              flexShrink: 0,
              fontSize: '10px',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ marginRight: '3px', opacity: 0.6 }}>·</span>
            {text.primaryLabel}
          </span>
        ) : null}
      </span>
      <span
        style={{
          alignItems: 'baseline',
          display: 'inline-flex',
          gap: '4px',
          justifyContent: 'flex-end',
          textAlign: 'right',
          whiteSpace: 'nowrap',
        }}
      >
        <strong
          aria-label={text.ariaLabel}
          className="pet-bubble-num"
          style={{
            color: remainingColor(text.remainingPercent),
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
            fontSize: '11px',
            fontWeight: 600,
            // 固定等宽列：三位数 + % 在 JetBrains Mono 11px 下实测 31px，
            // 34px 留余量不截断；两行以上时百分比左缘对齐成竖列。
            textAlign: 'right',
            width: '34px',
          }}
        >
          {text.remainingPercent}%
        </strong>
        {text.resetShort ? (
          <span
            aria-hidden
            className="pet-bubble-num"
            style={{
              color: COLOR_MUTED,
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
              fontSize: '10px',
              fontWeight: 500,
              // 固定列宽覆盖常规形态（HH:mm / MM-dd 均 5 字符）；ch 按
              // JetBrains Mono 的 "0" 字宽计算，5ch 不截断，tick/跨天不再
              // 推挤卡宽。跨年 YY-MM-dd（8 字符，极罕见）靠 nowrap 自然撑宽，
              // 不截断时刻。
              textAlign: 'right',
              width: '5ch',
            }}
          >
            {text.resetShort}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * 套餐余量气泡内容（每家一行的极简投影）。
 * 纯展示：数据由 DesktopPetView 统一聚合拉取后通过 props 传入；
 * 无任何 provider 有有效数据时调用方根本不渲染本组件。
 */
export function PetQuotaBubble({ aggregate }: { aggregate: PetQuotaAggregate }): JSX.Element | null {
  // 30s tick：时刻是分钟级粒度，无需每秒重渲染。
  const nowMs = useNowTick();
  const nowSec = Math.floor(nowMs / 1000);
  const rows = projectToCompactRows(aggregate);
  if (rows.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: '2px', minWidth: 0, textAlign: 'left' }}>
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
        <CompactProviderRow key={row.key} row={row} nowSec={nowSec} />
      ))}
    </div>
  );
}
