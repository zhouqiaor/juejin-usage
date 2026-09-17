import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCustomMiniMaxConfiguration,
  parseMiniMaxCredentials,
  _setMiniMaxSubscriptionGateForTest,
} from './minimax-subscription';

// 订阅开关在生产默认关闭（读 desktop-prefs.json）；node:test 无 Electron
// userData，统一注入「开启」闸门让既有取数测试按原语义运行。
_setMiniMaxSubscriptionGateForTest(() => Promise.resolve(true));

const GLOBAL_ORIGIN = 'https://api.minimax.io';
const MAINLAND_ORIGIN = 'https://api.minimaxi.com';

// 老 Coding Plan API 形态：返回 5h + weekly 两个 window
const GOOD_BODY = {
  model_remains: [
    { model_name: 'general', current_interval_remaining_percent: 80, current_weekly_remaining_percent: 70 },
  ],
};
const REGION_ERROR_BODY = { base_resp: { status_code: 2049, status_msg: 'region mismatch' } };

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 400,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function installFetch(handler: (url: string) => Promise<Response> | Response): {
  calls: string[];
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

async function freshMiniMax() {
  const mod = await import('./minimax-subscription.js');
  mod._resetMiniMaxForTest();
  return mod;
}

test('accepts only MiniMax Coding Plan keys with the official sk-cp- prefix', () => {
  assert.deepEqual(parseMiniMaxCredentials('sk-cp-global-prod-token-1234567890'), {
    token: 'sk-cp-global-prod-token-1234567890',
    region: 'global',
  });
  assert.deepEqual(parseMiniMaxCredentials({ apiKey: 'sk-cp-cn-account-token-9876543210' }), {
    token: 'sk-cp-cn-account-token-9876543210',
    region: 'mainland',
  });
  assert.equal(parseMiniMaxCredentials('sk-pay-as-you-go-key-1234'), null);
  assert.equal(parseMiniMaxCredentials('sk-cp-'), null);
  assert.equal(parseMiniMaxCredentials({ apiKey: 'sk-other-token' }), null);
  assert.equal(parseMiniMaxCredentials(null), null);
});

test('accepts only the official MiniMax Code API domains', () => {
  assert.equal(hasCustomMiniMaxConfiguration({}), false);
  assert.equal(hasCustomMiniMaxConfiguration({ MINIMAX_CODE_BASE_URL: 'https://api.minimax.io/' }), false);
  assert.equal(hasCustomMiniMaxConfiguration({ MINIMAX_CODE_BASE_URL: 'https://api.minimaxi.com' }), false);
  assert.equal(hasCustomMiniMaxConfiguration({ MINIMAX_CODE_BASE_URL: 'https://proxy.example/v1' }), true);
});

test('跨区重试二区抛异常且有 lastSuccess 时返回 stale 旧快照（核心回归）', async () => {
  process.env.MINIMAX_API_KEY = 'sk-cp-global-prod-testkey';
  delete process.env.MINIMAX_REGION;
  // 第一轮：global 首跳成功，建立 lastSuccess
  const first = installFetch((url) => {
    assert.ok(url.startsWith(GLOBAL_ORIGIN));
    return mockResponse(200, GOOD_BODY);
  });
  try {
    const mod = await freshMiniMax();
    const ok = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(ok.status, 'ready');
    assert.equal(ok.limits.length, 2);
    assert.equal(ok.stale, false);
    first.restore();

    // 第二轮：global 报 2049，mainland 重试抛网络异常 → staleFallback 保留旧数据
    const second = installFetch((url) => {
      if (url.startsWith(GLOBAL_ORIGIN)) return mockResponse(200, REGION_ERROR_BODY);
      throw new Error('ECONNRESET');
    });
    const stale = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(stale.status, 'ready');
    assert.equal(stale.stale, true, '应返回 lastSuccess 并标记 stale，而不是空 expired');
    assert.equal(stale.limits.length, 2);
    assert.equal(stale.region, 'global');
    assert.match(stale.message ?? '', /2049/);
    assert.match(stale.message ?? '', /网络异常/);
    second.restore();
  } finally {
    first.restore();
    delete process.env.MINIMAX_API_KEY;
  }
});

test('跨区重试二区返回空 limits 且有 lastSuccess 时同样保留 stale 旧快照', async () => {
  process.env.MINIMAX_API_KEY = 'sk-cp-global-prod-testkey2';
  const first = installFetch(() => mockResponse(200, GOOD_BODY));
  try {
    const mod = await freshMiniMax();
    await mod.readMiniMaxSubscription({ forceRefresh: true });
    first.restore();

    const second = installFetch((url) => {
      if (url.startsWith(GLOBAL_ORIGIN)) return mockResponse(200, REGION_ERROR_BODY);
      return mockResponse(200, {}); // 200 但映射不出任何 window
    });
    const stale = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(stale.stale, true);
    assert.equal(stale.limits.length, 2);
    assert.match(stale.message ?? '', /也失败/);
    second.restore();
  } finally {
    first.restore();
    delete process.env.MINIMAX_API_KEY;
  }
});

test('无 lastSuccess 时跨区全败返回 unavailable 空快照', async () => {
  process.env.MINIMAX_API_KEY = 'sk-cp-global-prod-nocache';
  const mocked = installFetch((url) => {
    if (url.startsWith(GLOBAL_ORIGIN)) return mockResponse(200, REGION_ERROR_BODY);
    throw new Error('ETIMEDOUT');
  });
  try {
    const mod = await freshMiniMax();
    const snap = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'temporarily-unavailable');
    assert.equal(snap.limits.length, 0);
    assert.match(snap.message ?? '', /2049/);
  } finally {
    mocked.restore();
    delete process.env.MINIMAX_API_KEY;
  }
});

test('lastGoodRegion 命中后首跳直打记忆区，不再先打启发式区域', async () => {
  // 无 cn 子串 → detectRegion 首判 global，但真实可用区是 mainland
  process.env.MINIMAX_API_KEY = 'sk-cp-global-prod-misdetect';
  const first = installFetch((url) => {
    if (url.startsWith(GLOBAL_ORIGIN)) return mockResponse(200, REGION_ERROR_BODY);
    return mockResponse(200, GOOD_BODY);
  });
  try {
    const mod = await freshMiniMax();
    const learned = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(learned.region, 'mainland');
    assert.ok(first.calls[0].startsWith(GLOBAL_ORIGIN));
    assert.ok(first.calls.some((u) => u.startsWith(MAINLAND_ORIGIN)));
    first.restore();

    // 第二轮：记忆区 mainland 必须首跳，global 一次都不打
    const second = installFetch((url) => {
      if (url.startsWith(MAINLAND_ORIGIN)) return mockResponse(200, GOOD_BODY);
      throw new Error(`unexpected request to ${url}`);
    });
    const snap = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'ready');
    assert.equal(snap.region, 'mainland');
    assert.equal(second.calls.length, 1);
    assert.ok(second.calls[0].startsWith(MAINLAND_ORIGIN), `首跳应为记忆区，实际：${second.calls[0]}`);
    second.restore();
  } finally {
    first.restore();
    delete process.env.MINIMAX_API_KEY;
  }
});

// [fork fix] 记忆区连续 2 次网络失败后清除记忆，下一轮回落 detectRegion 启发式首跳
test('lastGoodRegion 连续 2 次网络失败后清除记忆，第三轮首跳回退启发式区域', async () => {
  // 无 cn 子串 → 启发式 global；通过 2049 跨区成功学习到 mainland
  process.env.MINIMAX_API_KEY = 'sk-cp-global-prod-memoryreset';
  const learn = installFetch((url) => {
    if (url.startsWith(GLOBAL_ORIGIN)) return mockResponse(200, REGION_ERROR_BODY);
    return mockResponse(200, GOOD_BODY);
  });
  try {
    const mod = await freshMiniMax();
    const learned = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(learned.region, 'mainland');
    learn.restore();

    // 第 1 次记忆区网络失败：返回 stale 旧快照，记忆仍在
    const fail1 = installFetch((url) => {
      assert.ok(url.startsWith(MAINLAND_ORIGIN), `失败轮首跳仍应为记忆区，实际：${url}`);
      throw new Error('ECONNRESET');
    });
    const stale1 = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(stale1.stale, true);
    assert.equal(fail1.calls.length, 1);
    fail1.restore();

    // 第 2 次记忆区网络失败：同样 stale，失败计数达 2，记忆在本轮后被清除
    const fail2 = installFetch((url) => {
      assert.ok(url.startsWith(MAINLAND_ORIGIN), `第 2 次失败轮首跳仍应为记忆区，实际：${url}`);
      throw new Error('ETIMEDOUT');
    });
    const stale2 = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(stale2.stale, true);
    assert.equal(fail2.calls.length, 1);
    fail2.restore();

    // 第 3 轮：首跳必须回落到启发式 global，不再打记忆区 mainland
    const fallback = installFetch((url) => {
      if (url.startsWith(GLOBAL_ORIGIN)) return mockResponse(200, GOOD_BODY);
      throw new Error(`unexpected request to ${url}`);
    });
    const recovered = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(recovered.status, 'ready');
    assert.equal(fallback.calls.length, 1);
    assert.ok(fallback.calls[0].startsWith(GLOBAL_ORIGIN), `应回落启发式区域 global，实际：${fallback.calls[0]}`);
    fallback.restore();
  } finally {
    learn.restore();
    delete process.env.MINIMAX_API_KEY;
  }
});

// [fork fix] 鉴权失败（401）行为不受记忆区失败计数影响：持续返回 expired，不跨区重试
test('记忆区返回 401 时持续返回 expired 重新登录提示，不触发跨区重试', async () => {
  process.env.MINIMAX_API_KEY = 'sk-cp-global-prod-memoryauth';
  const learn = installFetch((url) => {
    if (url.startsWith(GLOBAL_ORIGIN)) return mockResponse(200, REGION_ERROR_BODY);
    return mockResponse(200, GOOD_BODY);
  });
  try {
    const mod = await freshMiniMax();
    assert.equal((await mod.readMiniMaxSubscription({ forceRefresh: true })).region, 'mainland');
    learn.restore();

    for (let round = 1; round <= 2; round += 1) {
      const auth = installFetch((url) => {
        if (url.startsWith(MAINLAND_ORIGIN)) return mockResponse(401, {});
        throw new Error(`unexpected request to ${url}`);
      });
      const snap = await mod.readMiniMaxSubscription({ forceRefresh: true });
      assert.equal(snap.status, 'expired', `第 ${round} 轮 401 应返回 expired`);
      assert.equal(snap.limits.length, 0);
      assert.match(snap.message ?? '', /重新登录/);
      assert.equal(auth.calls.length, 1, '401 不应触发跨区重试');
      auth.restore();
    }
  } finally {
    learn.restore();
    delete process.env.MINIMAX_API_KEY;
  }
});

test('开关关闭：短路在凭据探测/网络之前，返回 disabled 快照', async () => {
  process.env.MINIMAX_API_KEY = 'sk-cp-global-prod-disabled';
  const spy = installFetch(() => {
    throw new Error('disabled 时不允许任何网络请求');
  });
  _setMiniMaxSubscriptionGateForTest(() => Promise.resolve(false));
  try {
    const mod = await freshMiniMax();
    const snap = await mod.readMiniMaxSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'disabled');
    assert.equal(snap.limits.length, 0);
    assert.equal(spy.calls.length, 0, '关闭时不得发出请求');
  } finally {
    _setMiniMaxSubscriptionGateForTest(() => Promise.resolve(true));
    spy.restore();
    delete process.env.MINIMAX_API_KEY;
  }
});
