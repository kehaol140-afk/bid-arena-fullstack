# 管理员钱包白屏修复报告

日期：2026-10-13。分支 audit/codex-final。范围：仅钱包链路，未触碰 BidTransaction/WalletRepository/SettlementService/Agent 与资金模型。

## 1. 根因与实际API响应

隔离复现（Docker演示环境，真实管理员账号）：

| 场景 | 实际响应 | 前端后果 |
|---|---|---|
| 管理员 GET /wallets/me/ledger（零流水） | `{"code":0,"message":"ok"}`（**data缺失**；个别调用还观测到 `[{"code":0,"message":"ok"}]` 数组包裹形态） | `request()` 对 code=0 缺 data 返回 `undefined` → `this.ledger = undefined` → `ledger.length` TypeError → **白屏**（与报错完全一致） |
| 有流水的普通用户 | `{"code":0,"message":"ok","data":[...]}` | 正常（普通用户从未触发） |

链路结论：Solon `SqlUtils.queryRowList` 在零行时返回 **null**；`ApiResult.ok(null)` 的 data 被序列化省略（null 泛型偶发渲染为数组包裹）。后端/前端/DB 的 UTF-8 与资金逻辑无涉。对照组证据：手工构建的非null空列表端点（agent-tokens）稳定返回 `data:[]`。

## 2. 修复（三层最小防御）

| 层 | 文件 | 改动 |
|---|---|---|
| 后端契约 | backend/.../WalletController.java | `rows != null ? rows : List.of()`——空流水统一 `data:[]`（实测3/3稳定） |
| 前端API层 | frontend/src/api/wallet.ts | `getLedgerApi` 类型验证：null/undefined→`[]`（T4兼容）；非数组对象→抛 ApiError 9999（不掩盖异常）；403/500等经 `request()` 原样抛出（不误判为空） |
| Store层 | frontend/src/stores/wallet.ts | `refreshAll` try/catch + `Array.isArray` 赋值守卫 + `error` 状态；任何失败保留既有数据 |
| 视图层 | frontend/src/views/WalletView.vue | 错误提示条 + 重试按钮；`ledger.length` 前有数组保证，杜绝白屏 |

## 3. 回归测试结果

| 项 | 结果 |
|---|---|
| Vitest（新增10项：T1管理员零流水/T2 FREEZE-PAY保留/T3空数组/T4 null兼容/T5异常不白屏+403不吞错/T6 clear后恢复） | **PASS 34/34**（原24项全保留） |
| 前端 build | PASS |
| 修复后真实API：管理员零流水 | `{"code":0,"message":"ok","data":[]}` ×3 稳定 |
| 浏览器E2E（真实headless Edge，截图 docs/e2e_screenshots/wallet-fix/） | **PASS 4/4**：W1管理员钱包1000/0+“暂无流水记录”无白屏；W2刷新页面正常；W3重新登录普通用户流水行含冻结/扣款/#1拍卖引用；W4手动刷新保持2行 |
| 普通用户流水回归 | bidder_a（用户操作过的演示库）PAY/FREEZE 行显示不变 |
| 影响面 | 后端仅1个只读端点；房间页调用的是 `refresh()` 未改动；20人模拟与Agent不经过该端点，不受影响 |

## 4. 资金语义（只读核对，未改动）

SettlementService 仅两类写：赢家 hold→PAY（负额扣款，bidder_a 实测 `-140 win auction 1`）、其余 UNFREEZE；无任何向管理员/卖家入账逻辑 → **积分消耗模型**，符合原始任务书“赢家冻结转扣款、失败者释放”。已在 docs/USER_GUIDE.md §3 添加一句说明。管理员余额保持 1000 不变（实测）。

## 5. 部署

需重建 **backend 和 frontend** 两个Docker镜像（本轮已重建 bid-arena-demo 并验证；bid-arena-codex-check 仍是旧镜像，如需同步运行 `docker compose -p bid-arena-codex-check --profile full up -d --build`）。数据卷无需变动。

## 6. 备注

- 工作区中 docs/audit-evidence/ 4个文件为本轮之前用户重跑20人模拟产生的未提交更新（PASS计数不变），按保护要求未纳入本提交。
- Solon 对其他 list 端点在零行时存在同类 null-data 形态风险（如 bids/events 空列表），前端房间页已有 catch 兜底不会白屏；按"仅修钱包"范围未动，特此记录。
