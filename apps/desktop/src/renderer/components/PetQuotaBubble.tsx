// SPDX-License-Identifier: MIT
// renderer/components/PetQuotaBubble.tsx -- 桌面宠物气泡内套餐余量极简展示（无标题）
//
// 每家一行两列（方案 B）：左列 title（长名 ellipsis）+ 同名去重后的窗口标签
// （`Minimax CN · 5h`；primaryLabel 与 title 归一化相同时不显示，消除
// `Cursor · Cursor`）；右列 11px 剩余百分比（色阶）+ 10px 灰色短重置时刻
// （今天 `HH:mm` / 今年跨天 `MM-dd` / 跨年 `YY-MM-dd`，GMT+8 具体时钟）。
// planLabel（Free/Medium 等）不进正文，只进 title 悬浮（`title · planLabel`）。
// 完整中文语义进 aria-label。
//
// 多窗口家（如 Ark 5h/7d/30d）行尾有 9px chevron affordance，点击整行就地
// 展开/收起次级窗口明细（10px 小字，色阶规则与主行一致）；展开态按 provider
// key 记入组件 state，轮询/tick 重渲染保持，气泡关闭重开自然重置。单窗口家
// 无 chevron、不可点。hover 只给 cursor:pointer 与 title 提示，不做悬停展开。
//
// 时刻为分钟级粒度，useNowTick 30s 一跳驱动重渲染；数字全部 tabular-nums，
// tick 时不抖宽。跨年形态（YY-MM-dd，8 字符）极罕见，允许撑宽右列而不截断。
//
// 注意：宠物窗口入口（pet.tsx）只加载 pet.css，没有 tailwind / heroui 主题层，
// 因此本组件只用内联样式，不引 heroui 组件。拉取/轮询/归一化在 DesktopPetView
// + shared/pet-quota-providers.ts；jsdom 缺位下不造组件测试。
import { useState } from 'react';
import type { JSX } from 'react';
import type {
  PetQuotaAggregate,
  PetQuotaCompactRow,
  PetProviderKey,
  PetQuotaWindow,
} from '../../shared/pet-quota-providers';
import {
  formatCompactBubbleRow,
  projectToCompactRows,
} from '../../shared/pet-quota-providers';
import {
  formatResetCountdownShort,
  formatResetCountdownZh,
} from '../../shared/subscription-reset';
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

/** 次级窗口行的渲染投影（局部纯函数，不导出；7d/30d 等 primary 之外的窗口）。 */
interface SecondaryRowView {
  label: string;
  remainingPercent: number;
  resetShort: string | null;
  resetTitle: string | null;
  ariaLabel: string;
}

/**
 * 把一家的非 primary 窗口（归一化层保证 primary 恒为 windows[0]，至多 3 个）
 * 投影成展开区小字行：剩余口径与 projectToCompactRows 一致（100 - usedPercent，
 * used 已在归一化层 clamp），短时刻/中文文案复用订阅卡同款格式化器。
 */
function projectSecondaryRows(
  windows: readonly PetQuotaWindow[],
  nowSec: number,
): SecondaryRowView[] {
  return windows.slice(1, 3).map((win) => {
    const label = win.label.trim();
    const remainingPercent = Math.round(100 - win.usedPercent);
    const resetShort = formatResetCountdownShort(win.resetsAtSec, nowSec);
    const resetZh = formatResetCountdownZh(win.resetsAtSec, nowSec);
    const resetTitle = resetZh
      ? label ? `${label} 窗口 ${resetZh}` : resetZh
      : null;
    const suffix = label ? `${label} 窗口剩余` : '剩余';
    const ariaLabel = resetZh
      ? `剩余 ${remainingPercent}%，${label ? `${label} 窗口 ` : ''}${resetZh}`
      : `${suffix} ${remainingPercent}%`;
    return { label, remainingPercent, resetShort, resetTitle, ariaLabel };
  });
}

/** 9px 纯 CSS chevron：收起指向右（rotate(-45deg)），展开向下（rotate(45deg)）。 */
function Chevron({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        alignSelf: 'center',
        borderColor: COLOR_MUTED,
        borderStyle: 'solid',
        borderWidth: '0 1.5px 1.5px 0',
        display: 'inline-block',
        flexShrink: 0,
        height: '6px',
        margin: '0 1px 0 0',
        opacity: 0.75,
        padding: 0,
        transform: expanded ? 'rotate(45deg)' : 'rotate(-45deg)',
        transition: 'transform 120ms ease',
        width: '6px',
      }}
    />
  );
}

function SecondaryWindowRow({ view }: { view: SecondaryRowView }): JSX.Element {
  return (
    <div
      style={{
        alignItems: 'baseline',
        columnGap: '8px',
        display: 'grid',
        gridTemplateColumns: ROW_GRID_TEMPLATE_COLUMNS,
        lineHeight: 1.2,
      }}
      title={view.resetTitle ?? undefined}
    >
      <span
        style={{
          color: COLOR_MUTED,
          fontSize: '10px',
          fontWeight: 400,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {view.label}
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
          aria-label={view.ariaLabel}
          className="pet-bubble-num"
          style={{
            color: remainingColor(view.remainingPercent),
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
            fontSize: '10px',
            fontWeight: 600,
            textAlign: 'right',
            width: '34px',
          }}
        >
          {view.remainingPercent}%
        </strong>
        {view.resetShort ? (
          <span
            aria-hidden
            className="pet-bubble-num"
            style={{
              color: COLOR_MUTED,
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
              fontSize: '10px',
              fontWeight: 500,
              textAlign: 'right',
              width: '5ch',
            }}
          >
            {view.resetShort}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function CompactProviderRow({
  row,
  nowSec,
  sectionWindows,
  expanded,
  onToggle,
}: {
  row: PetQuotaCompactRow;
  nowSec: number;
  /** 该家完整窗口（归一化层已排序、至多 3 个）；>1 时行可点击展开。 */
  sectionWindows: readonly PetQuotaWindow[];
  expanded: boolean;
  onToggle: (key: PetProviderKey) => void;
}): JSX.Element {
  const text = formatCompactBubbleRow(row, nowSec);
  // 行整体悬浮提示：planLabel（Free/Medium 等）只活在 title 里；有重置
  // 信息时附完整中文文案，hover 与读屏均可查到完整语义。
  const planHover = text.planLabel ? `${text.title} · ${text.planLabel}` : text.title;
  const rowTitle = text.resetTitle ? `${planHover}，${text.resetTitle}` : planHover;

  const secondary = projectSecondaryRows(sectionWindows, nowSec);
  const expandable = secondary.length > 0;
  const regionId = `pet-quota-windows-${row.key}`;

  const gridStyle = {
    alignItems: 'baseline',
    columnGap: '8px',
    display: 'grid',
    gridTemplateColumns: ROW_GRID_TEMPLATE_COLUMNS,
    lineHeight: 1.2,
  } as const;

  // 主行内容（名称组 | chevron? 百分比 时刻）；可展开时整行包成 button，
  // 样式全部归零复位以维持与静态行完全相同的视觉。
  const headerInner = (
    <>
      <span
        style={{
          alignItems: 'baseline',
          // 名称与 .desktop-pet-stat-label 同档：11px / 400 / muted，
          // 视觉重点交给右列百分比（600 + 色阶）。
          color: COLOR_MUTED,
          display: 'inline-flex',
          fontSize: '11px',
          fontWeight: 400,
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
        {expandable ? <Chevron expanded={expanded} /> : null}
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
    </>
  );

  return (
    <div>
      {expandable ? (
        <button
          aria-controls={regionId}
          aria-expanded={expanded}
          onClick={() => onToggle(row.key)}
          style={{
            ...gridStyle,
            appearance: 'none',
            background: 'none',
            border: 0,
            color: 'inherit',
            cursor: 'pointer',
            font: 'inherit',
            margin: 0,
            padding: 0,
            width: '100%',
          }}
          title={rowTitle}
          type="button"
        >
          {headerInner}
        </button>
      ) : (
        <div style={gridStyle} title={rowTitle}>
          {headerInner}
        </div>
      )}
      <div
        aria-hidden={!expanded}
        id={regionId}
        role="group"
        style={{
          display: expanded ? 'grid' : 'none',
          gap: '1px',
          // 与主行名称左缘对齐（不额外缩进）；上下留 1px 呼吸。
          marginTop: '1px',
        }}
      >
        {secondary.map((view) => (
          <SecondaryWindowRow key={view.label || 'window'} view={view} />
        ))}
      </div>
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
  // 展开态按 provider key 记 Set：多家可各自独立展开；tick/轮询重渲染
  // （rows 每次重新投影排序）不丢状态；组件随气泡关闭卸载即自然重置。
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<PetProviderKey>>(
    () => new Set<PetProviderKey>(),
  );

  if (rows.length === 0) return null;

  const windowsByKey = new Map(
    aggregate.sections.map((section) => [section.provider, section.windows] as const),
  );

  const toggleRow = (key: PetProviderKey): void => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div style={{ display: 'grid', gap: '2px', minWidth: 0, textAlign: 'left' }}>
      {rows.map((row) => (
        <CompactProviderRow
          key={row.key}
          row={row}
          nowSec={nowSec}
          sectionWindows={windowsByKey.get(row.key) ?? []}
          expanded={expandedKeys.has(row.key)}
          onToggle={toggleRow}
        />
      ))}
    </div>
  );
}
