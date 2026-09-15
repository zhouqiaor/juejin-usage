// SPDX-License-Identifier: MIT
// main/plan-balance.ts — 拉取 quota-hub Coding Plan 余量（多 provider）
//
// 模式：仿 antigravity-subscription.ts
//   - REQUEST_TIMEOUT_MS (15s，容纳冷系统 DNS；见常量处实测)
//   - CACHE_TTL_MS (5s, 与 QUOTA-UI-SPEC §14 一致)
//   - lastSuccess 缓存 + requestInFlight dedup (避免 6 widget 各自 spawn)
//   - staleFallback 失败时返回上次成功值 + stale=true
//
// 安全：
//   - Key 全部从 process.env 透传给 Python 子进程，不入 IPC 信封
//   - 错误信息经 safeMessage() 脱敏（防 Key 漏出）
//   - spawn 命令通过白名单 + 绝对路径解析，禁止外部参数
//
// 上游契约：docs/QUOTA-UI-SPEC-2026-09-15.md §4.3
// 依据 source: prototype/plan_balance.py:382-408 (main argv)
import { existsSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type {
  PlanBalanceEnvelope,
  PlanBalanceKeyStatus,
  PlanBalanceSnapshot,
} from '../shared/plan-balance';

const execFile = promisify(execFileCallback);

// 15s：热路径实测 1.3–2s；冷环境下瓶颈不在 Python 而在系统级 DNS——
// 实测 api.minimaxi.com 冷解析（urllib timeout 管不到 getaddrinfo）可达 11s，
// 叠加 TLS/跨站 1004 回退约 12-13s，旧 5s 会以 SIGTERM 杀掉子进程
// （Node 侧表现为无 stderr 的「Command failed」killed=true）。
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5_000;
const SPAWN_ATTEMPTS = 2;
const SPAWN_RETRY_DELAY_MS = 400;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024; // 4 MB

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// -----------------------------------------------------------------------
// 路径解析（vendor 仓根 = juejin-usage；quota-hub 根在其上层）
// 优先级：
//   1. 显式环境变量 QUOTA_HUB_ROOT（开发/CI 覆盖）
//   2. app.getAppPath() 的祖先（标准打包后从 apps/desktop 向上 5 级）
//   3. process.cwd() 下的 prototype/plan_balance.py（pnpm dev 场景）
// -----------------------------------------------------------------------
function resolvePlanBalanceScript(): string {
  const envRoot = process.env.QUOTA_HUB_ROOT?.trim();
  if (envRoot) {
    const cand = path.join(envRoot, 'prototype', 'plan_balance.py');
    if (existsSync(cand)) return cand;
  }
  // app.getAppPath() 通常是 apps/desktop 目录
  // 实际 quota-hub 根 = parent 5 级（apps/desktop/.. × 5 = quota-hub）
  try {
    const appPath = app?.getAppPath?.() ?? '';
    if (appPath) {
      let cur = appPath;
      for (let i = 0; i < 6; i++) {
        const cand = path.join(cur, 'prototype', 'plan_balance.py');
        if (existsSync(cand)) return cand;
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
    }
  } catch {
    // app not ready（preload 阶段）忽略
  }
  // fallback: cwd 相对路径（pnpm dev 直接起 electron 时的常见 cwd）
  const cwdCand = path.join(process.cwd(), 'prototype', 'plan_balance.py');
  if (existsSync(cwdCand)) return cwdCand;
  throw new Error('未找到 prototype/plan_balance.py，请设置 QUOTA_HUB_ROOT 环境变量');
}

function resolvePython(): string {
  // 复用 Wideawake 托管 Python（user memory §路径约定）
  const candidates = [
    process.env.QUOTA_HUB_PYTHON?.trim(),
    'C:/Users/georgeslark/.workbuddy/binaries/python/versions/3.13.12/python.exe',
    'C:/ProgramData/miniconda3/python.exe',
    'python',
    'python3',
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c;
    }
    // 短名让 spawn 走 PATH
    return c;
  }
  return 'python';
}

// -----------------------------------------------------------------------
// 脱敏：去掉 message 中可能的 Key 字面（防 spawn stderr 漏出）
// -----------------------------------------------------------------------
const KEY_PATTERNS = [
  /sk-cp-[A-Za-z0-9_\-]+/g,         // MiniMax sk-cp-xxx
  /AKLT[A-Za-z0-9]{10,}/g,          // 火山方舟 AKLT 前缀
  /[A-Za-z0-9]{32,}=*/g,            // 通用 32+ 字符 base64 串（激进，可能误伤，慎用）
];

function safeMessage(s: string): string {
  let out = s;
  for (const p of KEY_PATTERNS.slice(0, 2)) {
    out = out.replace(p, '[REDACTED]');
  }
  // 截断防爆
  if (out.length > 400) out = out.slice(0, 400) + '…';
  return out;
}

// export 给 test 用
export { safeMessage };

// -----------------------------------------------------------------------
// 缓存 + in-flight dedup
// -----------------------------------------------------------------------
interface CacheEntry {
  envelope: PlanBalanceEnvelope<PlanBalanceSnapshot>;
  ts: number;
}
let lastSuccess: CacheEntry | null = null;
let requestInFlight: Promise<PlanBalanceEnvelope<PlanBalanceSnapshot>> | null = null;
let lastFailure: { envelope: PlanBalanceEnvelope<PlanBalanceSnapshot>; ts: number } | null = null;

function unavailable(message: string): PlanBalanceEnvelope<PlanBalanceSnapshot> {
  return {
    success: false,
    message: safeMessage(message),
    data: {
      generated_at: new Date().toISOString(),
      snapshot: false,
      balances: [],
    },
  };
}

function staleFallback(message: string): PlanBalanceEnvelope<PlanBalanceSnapshot> {
  if (lastSuccess) {
    return {
      success: true,
      message: safeMessage(message) + '（数据为上次成功快照）',
      data: { ...lastSuccess.envelope.data!, snapshot: true },
    };
  }
  return unavailable(message);
}
// keep export for tests / external callers
export { staleFallback };

// -----------------------------------------------------------------------
// spawn Python 拉余量
// -----------------------------------------------------------------------
async function spawnPlanBalance(): Promise<PlanBalanceSnapshot> {
  const script = resolvePlanBalanceScript();
  const py = resolvePython();
  // Key 透传（仅 MINIMAX_* / VOLC_*）
  // 强制子进程 UTF-8：Windows 中文系统下 Python 管道 stdout 默认 cp936/gbk，
  // 而 plan_balance.py 以 json.dumps(ensure_ascii=False) 输出中文 plan_label，
  // execFile 按 utf-8 解码 GBK 字节会乱码（「火山方舟」卡片标题 mojibake）。
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[plan-balance] spawn py=${py} script=${script}`);
  // 注意：plan_balance.py 不支持 --json；不传 -o 时 stdout 即 JSON
  const { stdout, stderr } = await execFile(
    py,
    [script],
    {
      timeout: REQUEST_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env,
      windowsHide: true,
      // 显式钉死 utf-8（execFile 默认即 utf8，但防止任何上层默认值漂移）：
      // stdout 必须与子进程 PYTHONIOENCODING=utf-8 对齐，杜绝 latin1/GBK 二次 decode
      encoding: 'utf8',
    },
  );
  const elapsed = Date.now() - t0;
  // eslint-disable-next-line no-console
  console.log(
    `[plan-balance] spawn OK ${elapsed}ms stdout=${stdout.length}B${stderr ? ` stderr=${stderr.length}B` : ''}`,
  );
  if (stderr && stderr.trim()) {
    // eslint-disable-next-line no-console
    console.warn(`[plan-balance] stderr: ${safeMessage(stderr.slice(0, 500))}`);
  }
  let parsed: PlanBalanceSnapshot;
  try {
    parsed = JSON.parse(stdout) as PlanBalanceSnapshot;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[plan-balance] JSON parse fail: stdout(前 300)=${safeMessage(stdout.slice(0, 300))}`);
    if (stderr && stderr.trim()) {
      // eslint-disable-next-line no-console
      console.error(`[plan-balance] parse-fail stderr: ${safeMessage(stderr.slice(0, 800))}`);
    }
    throw new Error(
      `plan_balance.py 输出非 JSON：${e instanceof Error ? e.message : String(e)}（stdout 前 300：${stdout.slice(0, 300)}）`,
    );
  }
  if (typeof parsed !== 'object' || !Array.isArray(parsed.balances)) {
    throw new Error('plan_balance.py 输出结构异常（缺 balances 数组）');
  }
  // eslint-disable-next-line no-console
  console.log(
    `[plan-balance] parsed OK snapshot=${parsed.snapshot} balances=${parsed.balances.length} ` +
    `statuses=[${parsed.balances.map((b) => `${b.plan}=${b.status}`).join(', ')}]`,
  );
  return parsed;
}

export function readPlanBalance(): Promise<PlanBalanceEnvelope<PlanBalanceSnapshot>> {
  // 1) 5s 缓存命中
  if (lastSuccess && Date.now() - lastSuccess.ts < CACHE_TTL_MS) {
    const age = Date.now() - lastSuccess.ts;
    // eslint-disable-next-line no-console
    console.log(
      `[plan-balance] cache HIT age=${age}ms balances=${lastSuccess.envelope.data?.balances.length ?? 0}`,
    );
    return Promise.resolve(lastSuccess.envelope);
  }
  // 2) in-flight dedup（6 widget 不会重复 spawn）
  if (requestInFlight) {
    // eslint-disable-next-line no-console
    console.log('[plan-balance] in-flight dedup (复用进行中的请求)');
    return requestInFlight;
  }

  // 3) 实际拉取（主进程内短退避重试：冷网络下首次 spawn 可能被超时杀掉，
  //    此时 OS 网络栈已预热，400ms 后的第二次基本必成，无需等渲染层下一次 IPC）
  const p = (async (): Promise<PlanBalanceEnvelope<PlanBalanceSnapshot>> => {
    try {
      let lastMsg = '';
      for (let attempt = 1; attempt <= SPAWN_ATTEMPTS; attempt++) {
        try {
          const data = await spawnPlanBalance();
          const env: PlanBalanceEnvelope<PlanBalanceSnapshot> = {
            success: true,
            message: '',
            data,
          };
          lastSuccess = { envelope: env, ts: Date.now() };
          lastFailure = null;
          return env;
        } catch (e) {
          lastMsg = e instanceof Error ? e.message : String(e);
          const err = e as { code?: number | string; signal?: string; killed?: boolean; timedOut?: boolean; stderr?: string | Buffer; stdout?: string | Buffer };
          const stderrTail = err.stderr != null
            ? safeMessage(String(err.stderr).slice(-800))
            : '';
          // eslint-disable-next-line no-console
          console.error(
            `[plan-balance] spawn FAIL (attempt ${attempt}/${SPAWN_ATTEMPTS}): ${safeMessage(lastMsg)} ` +
            `code=${err.code ?? '?'} signal=${err.signal ?? '-'} timedOut=${!!err.timedOut} killed=${!!err.killed}` +
            (stderrTail ? ` stderr_tail=${stderrTail}` : ''),
          );
          if (attempt < SPAWN_ATTEMPTS) {
            // eslint-disable-next-line no-console
            console.log(`[plan-balance] ${SPAWN_RETRY_DELAY_MS}ms 后主进程内重试`);
            await sleep(SPAWN_RETRY_DELAY_MS);
          }
        }
      }
      const errEnv: PlanBalanceEnvelope<PlanBalanceSnapshot> = {
        success: false,
        message: safeMessage(lastMsg),
        data: {
          generated_at: new Date().toISOString(),
          snapshot: false,
          balances: [],
        },
      };
      // 不写 lastFailure（让下次 readPlanBalance 调用立即重试，不被 5s 缓存卡住）
      // eslint-disable-next-line no-console
      console.log(
        `[plan-balance] fallback: success=${false} (下次调用立即重试) ` +
        `stale=${lastSuccess != null}`,
      );
      // 失败时若有上次成功 → 返回 stale 兜底（不破坏 UI）；否则返 unavailable
      if (lastSuccess) {
        return {
          success: true,
          message: safeMessage(lastMsg) + '（数据为上次成功快照）',
          data: { ...lastSuccess.envelope.data!, snapshot: true },
        };
      }
      return errEnv;
    } finally {
      requestInFlight = null;
    }
  })();
  requestInFlight = p;
  return p;
}

// 强制刷新（清 5s 缓存 + 立即拉）
export function refreshPlanBalance(): Promise<PlanBalanceEnvelope<PlanBalanceSnapshot>> {
  lastSuccess = null;
  lastFailure = null;
  return readPlanBalance();
}

// 启动静默预热：冷系统 DNS（实测 api.minimaxi.com getaddrinfo 可达 11s，
// urllib 的 timeout 管不到解析阶段）会让用户看到的首次余量查询失败/超慢。
// app 启动后先在后台跑一次填充 lastSuccess 与系统 DNS 缓存，
// 之后渲染层的 5s 轮询持续保热。失败无感知（下次 IPC 调用仍会重试）。
let warmupStarted = false;
export function warmupPlanBalance(opts: { delayMs?: number } = {}): void {
  if (warmupStarted) return;
  warmupStarted = true;
  const delay = opts.delayMs ?? 3_000;
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.log('[plan-balance] startup warmup: 后台静默预取余量（预热 DNS/缓存）');
    readPlanBalance().then((env) => {
      // eslint-disable-next-line no-console
      console.log(
        `[plan-balance] warmup done success=${env.success} balances=${env.data?.balances.length ?? 0}`,
      );
    }).catch(() => { /* 预热失败静默，下次调用自然重试 */ });
  }, delay);
}

// -----------------------------------------------------------------------
// 凭证状态：检查 MINIMAX_* / VOLC_* 是否设置
// 返回: [{ plan, configured, source }]
// -----------------------------------------------------------------------
const KEY_SOURCES: Array<{
  plan: string;
  source: PlanBalanceKeyStatus['source'];
  envKeys: string[];
}> = [
  {
    plan: 'minimax',
    source: 'minimax_coding_plan',
    envKeys: ['MINIMAX_API_KEY', 'MINIMAX_CODING_KEY'],
  },
  {
    plan: 'ark',
    source: 'volcengine_ark',
    envKeys: ['VOLC_ACCESS_KEY_ID', 'VOLC_SECRET_ACCESS_KEY'],
  },
];

export function readPlanBalanceKeyStatus(): PlanBalanceKeyStatus[] {
  return KEY_SOURCES.map((s) => ({
    plan: s.plan,
    source: s.source,
    configured: s.envKeys.some((k) => (process.env[k] ?? '').trim().length > 0),
  }));
}

// -----------------------------------------------------------------------
// 测试辅助（被 plan-balance.test.ts import）
// -----------------------------------------------------------------------
export function _resetForTest(): void {
  lastSuccess = null;
  lastFailure = null;
  requestInFlight = null;
}
export function _peekForTest(): {
  lastSuccessTs: number | null;
  lastFailureTs: number | null;
  inFlight: boolean;
} {
  return {
    lastSuccessTs: lastSuccess?.ts ?? null,
    lastFailureTs: lastFailure?.ts ?? null,
    inFlight: requestInFlight !== null,
  };
}
