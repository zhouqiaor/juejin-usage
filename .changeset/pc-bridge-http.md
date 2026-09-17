---
'@juejin-opensource/jusage-desktop': patch
---

D4 数据通路第一阶段：juejin-usage 桌面端暴露局域网 HTTP 端点 + QR 配对 API。

- 新增 `apps/desktop/src/main/pc-bridge-http.ts`：监听独立端口 `8453`（与 sidecar `8452` 隔离），提供 `GET /api/usage/summary?token=<tmp>`，用一次性临时 token 鉴权，用法来自 local-runtime 的 aggregateCache 聚合。
- 新增 `apps/desktop/src/main/pc-bridge-ipc.ts` 注册 IPC：`pc-bridge:enable` / `pc-bridge:disable` / `pc-bridge:status`，enable 返回 `{ ip, port, token, qrDataUrl }` 供 PlanPulse 扫码配对。
- 纯 `node:http` 实现、`electron`-free，可在 `node:test` 直接单测（5 个用例见 `pc-bridge-http.test.ts`）。

PlanPulse 端（Android）的扫码 / 配对 / 周期同步为后续阶段，不在本变更范围。
