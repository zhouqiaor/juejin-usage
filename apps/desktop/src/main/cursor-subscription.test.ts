import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCursorSessionCookie,
  extractCursorUserId,
  hasCursorCredentials,
  readCursorSubscription,
  _setCursorSubscriptionGateForTest,
} from './cursor-subscription';

function jwt(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('extracts the Cursor user id from common JWT subjects', () => {
  assert.equal(extractCursorUserId(jwt({ sub: 'auth0|user_abc123' })), 'user_abc123');
  assert.equal(extractCursorUserId(jwt({ sub: 'google-oauth2|person-id' })), 'google-oauth2|person-id');
  assert.equal(extractCursorUserId('invalid'), null);
});

test('encodes the Cursor dashboard session cookie', () => {
  assert.equal(
    buildCursorSessionCookie('auth0|user', 'a.b-c_d'),
    'WorkosCursorSessionToken=auth0|user%3A%3Aa.b-c_d',
  );
});

test('readCursorSubscription: 默认闸门（无 Electron prefs）返回 disabled 且不发请求', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('disabled 时不允许任何网络请求');
  }) as typeof fetch;
  try {
    const snap = await readCursorSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'disabled');
    assert.equal(snap.plan, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readCursorSubscription: 闸门开启但本机未安装时返回 not-installed（不抛错）', async () => {
  const previousDb = process.env.CURSOR_STATE_DB_PATH;
  process.env.CURSOR_STATE_DB_PATH = '~/nonexistent-cursor-for-test/state.vscdb';
  _setCursorSubscriptionGateForTest(() => Promise.resolve(true));
  try {
    const snap = await readCursorSubscription({ forceRefresh: true });
    assert.equal(snap.status, 'not-installed');
  } finally {
    _setCursorSubscriptionGateForTest(null);
    if (previousDb === undefined) delete process.env.CURSOR_STATE_DB_PATH;
    else process.env.CURSOR_STATE_DB_PATH = previousDb;
  }
});

test('hasCursorCredentials: 只读探测，无安装时返回 false 且不抛错', async () => {
  const previousDb = process.env.CURSOR_STATE_DB_PATH;
  process.env.CURSOR_STATE_DB_PATH = '~/nonexistent-cursor-for-test/state.vscdb';
  try {
    assert.equal(await hasCursorCredentials(), false);
  } finally {
    if (previousDb === undefined) delete process.env.CURSOR_STATE_DB_PATH;
    else process.env.CURSOR_STATE_DB_PATH = previousDb;
  }
});
