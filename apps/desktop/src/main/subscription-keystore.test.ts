// SPDX-License-Identifier: MIT
// main/subscription-keystore.test.ts -- keystore 健壮性（P1）单测
// 运行环境：node --test（纯 node，无 Electron 运行时，safeStorage/app 为 undefined，
// 恰好等价于 P1-③「safeStorage 瞬态不可用」场景）。不触网、不读写真实用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  serializeStore,
  parseStore,
  atomicWriteFile,
  mask,
  getKeyStatus,
  saveKeys,
  clearKeys,
} from './subscription-keystore.js';

// ============ parseStore：逐字段容错（P1-①） ============
test('parseStore: 正常对象解析出 minimax + ark', () => {
  const cipherObj = {
    'minimax|apiKey': 'ENC_A',
    'minimax|region': 'ENC_B',
    'ark|accessKeyId': 'ENC_C',
    'ark|secretAccessKey': 'ENC_D',
  };
  const dec = (c: string): string => `DEC_${c}`;
  const { store, corruptFieldCount } = parseStore(cipherObj, dec);
  assert.equal(corruptFieldCount, 0);
  assert.equal(store.minimax?.apiKey, 'DEC_ENC_A');
  assert.equal(store.minimax?.region, 'DEC_ENC_B');
  assert.equal(store.ark?.accessKeyId, 'DEC_ENC_C');
  assert.equal(store.ark?.secretAccessKey, 'DEC_ENC_D');
});

test('parseStore: 单字段解密失败仅跳过该字段，保留其余（P1-①）', () => {
  const cipherObj = {
    'minimax|apiKey': 'GOOD',
    'minimax|region': 'BAD',
    'ark|accessKeyId': 'GOOD2',
    'ark|secretAccessKey': 'BAD2',
  };
  let calls = 0;
  const dec = (c: string): string => {
    calls++;
    if (c.startsWith('BAD')) throw new Error('decrypt failed');
    return `DEC_${c}`;
  };
  const { store, corruptFieldCount } = parseStore(cipherObj, dec);
  assert.equal(corruptFieldCount, 2, '两个坏字段应被计入');
  assert.equal(calls, 4, '每个字段都尝试解密');
  // 好字段仍在
  assert.equal(store.minimax?.apiKey, 'DEC_GOOD');
  assert.equal(store.ark?.accessKeyId, 'DEC_GOOD2');
  // 坏字段被跳过
  assert.equal(store.minimax?.region, undefined);
  assert.equal(store.ark?.secretAccessKey, undefined);
});

test('parseStore: 全部字段损坏返回空 store 且不抛（P1-①）', () => {
  const cipherObj = { 'minimax|apiKey': 'X', 'ark|accessKeyId': 'Y' };
  const dec = (): string => { throw new Error('boom'); };
  const { store, corruptFieldCount } = parseStore(cipherObj, dec);
  assert.equal(corruptFieldCount, 2);
  assert.deepEqual(store, {});
});

test('parseStore: 非法 key（无分隔符）与未知 group 计为损坏且不抛', () => {
  const cipherObj = { 'noSeparator': 'V', 'unknown|foo': 'V2' };
  const dec = (c: string): string => `D_${c}`;
  const { store, corruptFieldCount } = parseStore(cipherObj, dec);
  assert.equal(corruptFieldCount, 2);
  assert.deepEqual(store, {});
});

// ============ serializeStore 往返（P1-② 加密层） ============
test('serializeStore: 与 parseStore 加解密函数配对可往返', () => {
  const store = {
    minimax: { apiKey: 'ak', region: 'auto' as const },
    ark: { accessKeyId: 'id', secretAccessKey: 'sk', region: 'cn-beijing' },
  };
  const enc = (s: string): string => `E(${s})`;
  const dec = (s: string): string => s.slice(2, -1);
  const obj = serializeStore(store, enc);
  assert.equal(obj['minimax|apiKey'], 'E(ak)');
  assert.equal(obj['ark|secretAccessKey'], 'E(sk)');
  const back = parseStore(obj, dec);
  assert.equal(back.corruptFieldCount, 0);
  assert.equal(back.store.minimax?.apiKey, 'ak');
  assert.equal(back.store.ark?.secretAccessKey, 'sk');
});

// ============ atomicWriteFile（P1-② 原子写） ============
test('atomicWriteFile: 写入后目标存在且无残留 .tmp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks-test-'));
  try {
    const p = join(dir, 'keys.enc.json');
    atomicWriteFile(p, '{"a":1}');
    assert.equal(readFileSync(p, 'utf8'), '{"a":1}');
    assert.equal(existsSync(`${p}.tmp`), false, '不应残留临时文件');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('atomicWriteFile: 覆盖旧文件且不留临时文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks-test-'));
  try {
    const p = join(dir, 'keys.enc.json');
    atomicWriteFile(p, 'old');
    atomicWriteFile(p, 'new');
    assert.equal(readFileSync(p, 'utf8'), 'new');
    assert.equal(existsSync(`${p}.tmp`), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ============ mask（纯函数） ============
test('mask: 短串全掩码，长串保留末 4 位', () => {
  assert.equal(mask('ab'), '****');
  assert.equal(mask('sk-1234'), '****1234');
});

// ============ 降级路径（P1-③：electron 不可用时不崩溃、友好失败） ============
test('getKeyStatus: 无 env 且无 electron 时不抛，返回 none', () => {
  delete process.env.MINIMAX_API_KEY; delete process.env.MINIMAX_CODING_KEY;
  delete process.env.VOLC_ACCESS_KEY_ID; delete process.env.VOLC_SECRET_ACCESS_KEY;
  const status = getKeyStatus();
  assert.equal(status.length, 2);
  assert.ok(status.every((s) => s.source === 'none'));
});

test('saveKeys: electron 不可用时返回失败而非抛异常（P1-③）', () => {
  const r = saveKeys({ minimax: { apiKey: 'x' } });
  assert.equal(r.success, false);
  assert.match(r.message, /加密存储/);
});

test('clearKeys: electron 不可用时返回失败而非抛异常（P1-③）', () => {
  const r = clearKeys('ark');
  assert.equal(r.success, false);
});
