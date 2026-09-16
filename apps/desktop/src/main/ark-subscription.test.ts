// SPDX-License-Identifier: MIT
// main/ark-subscription.test.ts -- 凭据解析/缺失态测试（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 用 env 注入方式验证 resolveArkCredentials 优先 env；缺凭据态返回 null
// 安全：测试用 fake AK/SK，不暴露也不读取真实键
test('resolveArkCredentials: 无 env + 无 stored 时返回 null 或抛 Electron 缺失', async () => {
  delete process.env.VOLC_ACCESS_KEY_ID;
  delete process.env.VOLC_SECRET_ACCESS_KEY;
  const { resolveArkCredentials } = await import('./subscription-keystore.js');
  let out: ReturnType<typeof resolveArkCredentials> | undefined = undefined;
  try { out = resolveArkCredentials(); } catch { /* Electron 上下文缺失，预期 */ }
  // 期望：要么返回 null，要么抛（safeStorage 在测试环境不可用）
  if (out !== undefined) assert.ok(out === null || typeof out.accessKeyId === 'string');
});

test('resolveArkCredentials prefers env over stored (env present returns env value)', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTENVTEST';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKENVTEST';
  const { resolveArkCredentials } = await import('./subscription-keystore.js');
  const out = resolveArkCredentials();
  assert.ok(out, 'env should produce a credential');
  assert.equal(out!.accessKeyId, 'AKLTENVTEST');
  delete process.env.VOLC_ACCESS_KEY_ID;
  delete process.env.VOLC_SECRET_ACCESS_KEY;
});

test('resolveMiniMaxCredentials: 无 env + 无 stored 时返回 null 或抛 Electron 缺失', async () => {
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_CODING_KEY;
  const { resolveMiniMaxCredentials } = await import('./subscription-keystore.js');
  let out: ReturnType<typeof resolveMiniMaxCredentials> | undefined = undefined;
  try { out = resolveMiniMaxCredentials(); } catch { /* Electron 上下文缺失，预期 */ }
  if (out !== undefined) assert.ok(out === null || typeof out.token === 'string');
});

test('resolveMiniMaxCredentials prefers env over stored', async () => {
  process.env.MINIMAX_API_KEY = 'sk-cp-env-test';
  const { resolveMiniMaxCredentials } = await import('./subscription-keystore.js');
  const out = resolveMiniMaxCredentials();
  assert.ok(out, 'env should produce a credential');
  assert.equal(out!.token, 'sk-cp-env-test');
  assert.equal(out!.region, 'auto');
  delete process.env.MINIMAX_API_KEY;
});

test('readArkSubscription: ListModelChargeItems 失败（AuthFailure）只写 tokenPacksError，主快照照常 ready', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTTOKTEST';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKTOKTEST';
  const originalFetch = globalThis.fetch;
  let tokenRequestUrl = '';
  globalThis.fetch = (async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    let body: Record<string, unknown>;
    if (url.includes('Action=ListModelChargeItems')) {
      tokenRequestUrl = url;
      body = { ResponseMetadata: { Error: { Code: 'AuthFailure.SSOSignInRequired', Message: 'sso only' } } };
    } else if (url.includes('Action=GetAFPUsage')) {
      body = { Result: { PlanType: 'pro', AFPFiveHour: { Quota: 100, Used: 20 } } };
    } else {
      body = { Result: { QuotaUsage: [] } };
    }
    return { json: async () => body } as unknown as Response;
  }) as typeof fetch;
  try {
    const { readArkSubscription, _resetArkForTest } = await import('./ark-subscription.js');
    _resetArkForTest();
    const snap = await readArkSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'ready');
    assert.ok(snap.limits.length > 0);
    assert.deepEqual(snap.tokenPacks, []);
    assert.ok(snap.tokenPacksError, 'tokenPacksError should carry the failure');
    assert.match(snap.tokenPacksError!, /sso only/);
    assert.match(tokenRequestUrl, /Action=ListModelChargeItems/);
    assert.match(tokenRequestUrl, /PageSize=100/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
  }
});

test('readArkSubscription: ListModelChargeItems 成功时 tokenPacks 进入快照', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTTOKTEST2';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKTOKTEST2';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    let body: Record<string, unknown>;
    if (url.includes('Action=ListModelChargeItems')) {
      body = {
        Result: {
          Items: [
            { FoundationModelName: 'doubao-x', InferenceFreeUsage: { Total: 50_000, Consumed: 5_000 } },
          ],
        },
      };
    } else if (url.includes('Action=GetAFPUsage')) {
      body = { Result: { AFPWeekly: { Quota: 1000, Used: 100 } } };
    } else {
      body = { Result: { QuotaUsage: [] } };
    }
    return { json: async () => body } as unknown as Response;
  }) as typeof fetch;
  try {
    const { readArkSubscription, _resetArkForTest } = await import('./ark-subscription.js');
    _resetArkForTest();
    const snap = await readArkSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'ready');
    assert.equal(snap.tokenPacksError, null);
    assert.equal(snap.tokenPacks.length, 1);
    assert.equal(snap.tokenPacks[0].label, '免费额度');
    assert.equal(snap.tokenPacks[0].remaining, 45_000);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
  }
});

function mockArkFetch(routes: {
  afp: Record<string, unknown>;
  coding: Record<string, unknown>;
  items: Record<string, unknown>;
}) {
  globalThis.fetch = (async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    let body: Record<string, unknown>;
    if (url.includes('Action=ListModelChargeItems')) body = routes.items;
    else if (url.includes('Action=GetAFPUsage')) body = routes.afp;
    else body = routes.coding;
    return { json: async () => body } as unknown as Response;
  }) as typeof fetch;
}

test('planKind: 仅 GetCodingPlanUsage 返回窗口时为 coding', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTPLANCODE';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKPLANCODE';
  const originalFetch = globalThis.fetch;
  mockArkFetch({
    afp: { Result: {} },
    coding: {
      Result: {
        QuotaUsage: [
          { Level: 'session', Percent: 10 },
          { Level: 'weekly', Percent: 20 },
        ],
      },
    },
    items: { Result: { Items: [] } },
  });
  try {
    const { readArkSubscription, _resetArkForTest } = await import('./ark-subscription.js');
    _resetArkForTest();
    const snap = await readArkSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'ready');
    assert.equal(snap.planKind, 'coding');
    assert.equal(snap.limits.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
  }
});

test('planKind: AFP(Agent Plan) 回落路径为 agent 且透传 PlanType', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTPLANAFP';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKPLANAFP';
  const originalFetch = globalThis.fetch;
  mockArkFetch({
    afp: { Result: { PlanType: 'pro', AFPFiveHour: { Quota: 100, Used: 30 } } },
    coding: { Result: { QuotaUsage: [] } },
    items: { Result: { Items: [] } },
  });
  try {
    const { readArkSubscription, _resetArkForTest } = await import('./ark-subscription.js');
    _resetArkForTest();
    const snap = await readArkSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'ready');
    assert.equal(snap.planKind, 'agent');
    assert.equal(snap.planLabel, 'pro');
    assert.equal(snap.limits[0].id, 'five-hour');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
  }
});

test('planKind: 两接口后续皆空窗口走 staleFallback 时保留上次 agent 种类', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTPLANSTALE';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKPLANSTALE';
  const originalFetch = globalThis.fetch;
  try {
    const { readArkSubscription, _resetArkForTest } = await import('./ark-subscription.js');
    _resetArkForTest();

    // 首次：AFP 有窗口 → agent 进入 lastSuccess 缓存
    mockArkFetch({
      afp: { Result: { PlanType: 'pro', AFPFiveHour: { Quota: 100, Used: 30 } } },
      coding: { Result: { QuotaUsage: [] } },
      items: { Result: { Items: [] } },
    });
    const first = await readArkSubscription({ forceRefresh: true });
    assert.equal(first.planKind, 'agent');
    assert.equal(first.stale, false);

    // 二次：两接口皆空窗口 → limits.length===0 → staleFallback 展开 lastSuccess
    mockArkFetch({
      afp: { Result: {} },
      coding: { Result: { QuotaUsage: [] } },
      items: { Result: { Items: [] } },
    });
    const second = await readArkSubscription({ forceRefresh: true });
    assert.equal(second.status, 'ready');
    assert.equal(second.stale, true);
    assert.equal(second.planKind, 'agent');
    assert.equal(second.planLabel, 'pro');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
  }
});
test('allSettled: GetCodingPlanUsage reject 不连坐，AFP 窗口照常 ready', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTSETTLED1';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKSETTLED1';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes('Action=GetCodingPlanUsage')) {
      throw new Error('http-error:AgentPlanNotSupported:no coding plan');
    }
    if (url.includes('Action=ListModelChargeItems')) {
      return { json: async () => ({ Result: { Items: [] } }) } as unknown as Response;
    }
    return {
      json: async () => ({ Result: { PlanType: 'pro', AFPFiveHour: { Quota: 100, Used: 40 } } }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const { readArkSubscription, _resetArkForTest } = await import('./ark-subscription.js');
    _resetArkForTest();
    const snap = await readArkSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'ready');
    assert.equal(snap.planKind, 'agent');
    assert.equal(snap.limits.length, 1);
    assert.equal(snap.limits[0].id, 'five-hour');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
  }
});

test('allSettled: GetCodingPlanUsage 错误信封同样按该路无数据处理', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTSETTLED2';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKSETTLED2';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes('Action=GetCodingPlanUsage')) {
      return {
        json: async () => ({
          ResponseMetadata: { Error: { Code: 'InvalidParameter', Message: 'not supported' } },
        }),
      } as unknown as Response;
    }
    if (url.includes('Action=ListModelChargeItems')) {
      return { json: async () => ({ Result: { Items: [] } }) } as unknown as Response;
    }
    return {
      json: async () => ({ Result: { AFPWeekly: { Quota: 1000, Used: 100 } } }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const { readArkSubscription, _resetArkForTest } = await import('./ark-subscription.js');
    _resetArkForTest();
    const snap = await readArkSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'ready');
    assert.equal(snap.limits[0].id, 'weekly');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
  }
});

test('allSettled: 两路均 reject 且无缓存时返回 unavailable（temporarily-unavailable）', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTSETTLED3';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKSETTLED3';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  try {
    const { readArkSubscription, _resetArkForTest } = await import('./ark-subscription.js');
    _resetArkForTest();
    const snap = await readArkSubscription({ forceRefresh: true });
    assert.notEqual(snap.status, 'ready');
    assert.match(snap.status, /unavailable|auth-error/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
  }
});

test('allSettled: 两路均鉴权失败时返回 auth-error 且错误信息中文化', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTSETTLED4';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKSETTLED4';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    json: async () => ({
      ResponseMetadata: {
        Error: { Code: 'SignatureDoesNotMatch', Message: 'signature mismatch' },
      },
    }),
  })) as unknown as typeof fetch;
  try {
    const { readArkSubscription, _resetArkForTest } = await import('./ark-subscription.js');
    _resetArkForTest();
    const snap = await readArkSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'auth-error');
    assert.match(snap.message ?? '', /签名不匹配/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
  }
});
