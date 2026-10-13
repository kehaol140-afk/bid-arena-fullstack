# AI使用说明（需本人补全）

## 可确认来源

用户说明项目由OpenCode + GLM5.3完成多轮开发和集成；这是用户提供的开发背景，Codex没有逐轮核实其全部对话或作者身份。现有Git历史及源码提供实际实现证据，不等于每一设计由本人决定。

本轮Codex：完整阅读原PDF、只读源码审计、先提交CODEX_AUDIT_REPORT；真实MySQL失败复现；最小资金/幂等/取消/事件/绑定/鉴权/展示/代理修复；独立受限Token竞拍Agent；隔离测试库、强化浏览器断言；运行测试；补交付文档。没有调用收费LLM、训练模型、自动推送或合并main。

Codex之后的后续轮次（同为OpenCode/GLM工具执行，非本人手工；**是否认可为本人的交付内容待本人确认**）：

1. Docker真实验收轮（commit 2388c88）：隔离Compose部署、容器内Java17实测、17项业务验收、SETTLING恢复与重启持久化，产出docs/DOCKER_VALIDATION.md。期间验收脚本自身缺陷（编码/变量/死锁）均已定位，非项目缺陷。
2. 演示环境与UI轮（commit 9c20f9e）：乱码根因实证（客户端编码）、独立bid-arena-demo演示环境（scripts/demo-docker.ps1）、最小UI提示改进、docs/USER_GUIDE.md与docs/DEMO_UX_REVIEW.md、真实Edge E2E 9/9。
3. 钱包白屏修复轮（commit bfbb310）：空流水null-data契约修复+三层前端防御，Vitest 34/34、钱包E2E 4/4，docs/WALLET_FIX_REPORT.md。

## 本人确认区（禁止代填）

- 本人代码/AI代码比例及统计方法：**待本人确认**，不能从提交数量推断比例。
- 本人主导设计1（事务与锁）：**待本人确认具体选择、理由及能否解释**。
- 本人主导设计2（结算恢复与事件）：**待本人确认**。
- 本人主导设计3（Token及Agent策略）：**待本人确认**。
- 本人未采用方案1、2及理由：**待本人确认**；DECISIONS中的本轮审计备选不作为本人历史行为。
- 仍不能独立解释的代码及补习计划：**待本人逐项确认**，不能替本人写"无"。建议逐一解释BidTransaction、Solon代理事务、SettlementService、Token限流、AuctionChannel。
- 本人最终检视、录屏、测试复跑日期：**待本人确认**。
- 是否认可Codex后三轮（Docker验收/演示环境/钱包修复，见上）计入本人交付：**待本人确认**。
- 公开演示密码（Admin123456!/Test123456!）在正式提交前是否替换：**待本人决定**。

## 实际错误与修复证据

已实测错误包括跨场requestId错误重放、逆序钱包锁/1213、取消写FINISHED、join信封被HUMAN覆盖、缺号提前推进seq、摘要缺领先者、scope空格误拒绝、停用用户会话仍有效、非法amount返回500。DEBUG_LOG记录可核对的复现与日志。另有审计测试期自身错误：异常类型断言与实际代理异常不同、Java javapath子进程退出而真实JVM仍驻留、WS改为Service快照后遗留checked catch导致编译失败；均明确标记为测试/工具问题，不拿它们夸大业务缺陷。

AI协助不替代本人责任：提交前需理解设计、确认未验证项，并如实说明双实例WS为进程内广播（Docker运行与Java17容器已实测通过，见docs/DOCKER_VALIDATION.md）、录屏及本人决策仍待补。
