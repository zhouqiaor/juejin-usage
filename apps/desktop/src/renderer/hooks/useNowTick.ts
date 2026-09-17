// SPDX-License-Identifier: MIT
// renderer/hooks/useNowTick.ts — 轻量定时重渲染 hook
//
// 用于让「n 分钟前更新」这类相对时间随墙钟走动。30s 一跳即可（订阅卡
// 刷新粒度本身是 60s），不要用每秒 tick 制造无意义渲染。
import { useEffect, useState } from 'react';

/** 当前墙钟（毫秒），每 intervalMs 触发一次重渲染。 */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
