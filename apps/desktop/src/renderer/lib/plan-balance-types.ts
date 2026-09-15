// SPDX-License-Identifier: MIT
// renderer/lib/plan-balance-types.ts — barrel re-export for renderer 内部路径稳定
//
// renderer 组件按相对路径 `../lib/plan-balance-types` 引；转发到真正的 shared 定义。
// 这样未来即使 shared 位置变更，renderer 端 import 路径不受影响。

export * from '../../shared/plan-balance';
