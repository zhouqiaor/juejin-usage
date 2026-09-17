// SPDX-License-Identifier: MIT
// renderer/components/ArkTokenPacksBlock.tsx -- 火山方舟免费推理额度（免费额度 / 免费推理资源包）
import { useState } from 'react';
import type { ArkTokenPack } from '../../shared/ark-subscription';
import {
  COLLAPSE_MODEL_THRESHOLD,
  TOKEN_PACKS_SOURCE_TOOLTIP,
  countArkTokenModels,
  formatArkTokenCount,
  shouldCollapseTokenPacks,
  summarizeArkTokenPacks,
  type ArkTokenPacksSummary,
} from '../../shared/ark-token-packs';
import { MetricBarRow } from './SubscriptionMetricBar';

/**
 * Token 行右值列宽。tray popover（430px 宽）下单卡内容宽仅 170px：
 * label w-14(56) + gap-3×2(24) 后 value 列上限 90px，超出必把右值顶出卡边。
 * 数字用 10px（与本区块标题同号；JetBrains Mono 0.6em 等宽）：
 * 「222.9万 / 400万」≈86px 可容纳；「12.3亿 / 100.0亿」≈92px 极端值由 MetricBarRow truncate 兜底。
 */
const TOKEN_VALUE_WIDTH = 'w-[90px]';
/** 右值降一号到 10px 以贴合 90px 列宽；外层 span 的 tabular-nums/nowrap/右对齐继续继承 */
function TokenValueText({ children }: { children: string }) {
  return <span className="text-[10px]">{children}</span>;
}

function PackRow({ pack }: { pack: ArkTokenPack }) {
  const color = pack.usedPercent >= 90 ? '#f04142' : '#2b7eff';
  return (
    <MetricBarRow
      ariaLabel={`${pack.displayName} ${pack.label}已用 ${Math.round(pack.usedPercent)}%`}
      color={color}
      label={pack.displayName}
      labelTitle={`${pack.displayName} · ${pack.label}`}
      percent={pack.usedPercent}
      valueText={(
        <TokenValueText>
          {`${formatArkTokenCount(pack.remaining)} / ${formatArkTokenCount(pack.total)}`}
        </TokenValueText>
      )}
      valueWidth={TOKEN_VALUE_WIDTH}
      // 已用语义：0% 已用时轨道保留浅蓝零态圆点，区别于「无数据不渲染该行」
      zeroBaseline
    />
  );
}

function SummaryRow({ summary }: { summary: ArkTokenPacksSummary }) {
  const pct = summary.usedPct ?? 0;
  const color = pct >= 90 ? '#f04142' : '#2b7eff';
  return (
    <MetricBarRow
      ariaLabel={`免费推理额度汇总已用 ${Math.round(pct)}%（${TOKEN_PACKS_SOURCE_TOOLTIP}）`}
      color={color}
      label="汇总"
      labelTitle={TOKEN_PACKS_SOURCE_TOOLTIP}
      // 视觉宽度 clamp 到 100（track 裁切）；原始未 clamp 口径见 summary.usedPct 与 tooltip
      percent={Math.max(0, Math.min(100, pct))}
      valueText={(
        <TokenValueText>
          {`${formatArkTokenCount(summary.totalRemaining)} / ${formatArkTokenCount(summary.total)}`}
        </TokenValueText>
      )}
      valueWidth={TOKEN_VALUE_WIDTH}
      // 汇总同为已用语义：全部模型 0% 已用时同样给零态指示
      zeroBaseline
    />
  );
}

export interface ArkTokenPacksBlockProps {
  packs: readonly ArkTokenPack[];
  /** 免费推理额度查询失败时的原始错误；packs 为空且有 error 时展示一行弱提示 */
  errorText?: string | null;
}

export function ArkTokenPacksBlock({ packs, errorText = null }: ArkTokenPacksBlockProps) {
  // 模型余量按模型展开可能数十行：>=2 个模型时折叠为一条汇总行（标题行 + 单条汇总进度条，卡片高度最小），
  // 点击标题行展开逐模型明细；0/1 个模型直接展示明细且不显示展开按钮。
  const [expanded, setExpanded] = useState(false);

  // 无 packs：有错误时给出弱提示出口（tokenPacksError 不能零 UI），无错误则不占区块
  if (packs.length === 0) {
    if (!errorText) return null;
    return (
      <div className="mt-1 border-t border-surface-secondary pt-1.5">
        <p className="text-[10px] text-muted" title={errorText}>
          免费推理额度暂不可用
        </p>
      </div>
    );
  }

  if (!shouldCollapseTokenPacks(packs)) {
    return (
      <div className="mt-1 grid gap-1 border-t border-surface-secondary pt-1.5">
        {packs.map((pack, idx) => (
          <PackRow pack={pack} key={`${pack.model}-${pack.label}-${idx}`} />
        ))}
      </div>
    );
  }

  // 折叠阈值与标题均按去重模型数：单模型的「免费额度 + 资源包」两行不算 2 个模型
  const modelCount = countArkTokenModels(packs);
  const summary = summarizeArkTokenPacks(packs);
  return (
    <div className="mt-1 grid gap-1 border-t border-surface-secondary pt-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={expanded}
        title={expanded ? undefined : TOKEN_PACKS_SOURCE_TOOLTIP}
      >
        <span className="text-[10px] font-semibold text-muted">
          免费推理额度 · {modelCount} 个模型（粗口径汇总）
        </span>
        <span className="shrink-0 pl-2 text-[10px] font-medium text-[#2b7eff]">
          {expanded ? '收起 ▴' : '展开 ▾'}
        </span>
      </button>
      {expanded
        ? packs.map((pack, idx) => (
            <PackRow pack={pack} key={`${pack.model}-${pack.label}-${idx}`} />
          ))
        : <SummaryRow summary={summary} />}
    </div>
  );
}

// 纯逻辑真源在 shared/ark-token-packs；此处 re-export 兼容既有调用点（PetQuotaBubble 等）
export { COLLAPSE_MODEL_THRESHOLD, formatArkTokenCount };
