# 3–5分钟本人录屏计划

不是已完成录屏。推荐直接使用独立Docker演示环境（`powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action up` → http://localhost:25173，自带全新库：一个默认DRAFT、两真人账户、独立AGENT用户、1000初始积分；操作详见docs/USER_GUIDE.md）。不要对正在使用的bid_arena清库。提前签发受限Token放独立终端环境，录屏不显示签发响应/Token/数据库密码。

1. 0:00–0:25：展示README入口和DRAFT，管理员手动启动默认180秒；说明100/10、最后5秒最多3次延时。
2. 0:25–0:55：两个独立浏览器真人A/B加入，依次110/120；展示被超通知、领先者姓名、冻结差额与释放。
3. 0:55–1:25：展示20人独立测试库模拟命令及本次完整三态报告。模拟完整约2分钟，应在录屏开始前启动专用库进程并在此展示收尾，不能把预跑剪辑冒充实时即时完成，也不要对真人演示场直接消耗预算。
4. 1:25–1:50：运行公开受限API Agent，终端只显示场/user/预算与出价UUID；页面参与者标AGENT。管理员确认预算、绑定场和有效期，不露Token。
5. 2:50–3:25：默认180秒场接近截止，两真人或Agent在最后5秒合法出价，展示endTime加10秒与extendCount；最多3次，勿改服务器时钟或伪造UI。
6. 3:25–4:15：等待真实自动结算，页面完整显示赢家及成交价；开赢家与被超者钱包及流水，解释PAY仅一次、冻结归零和余额守恒。
7. 4:15–4:45：展示最终三态报告、Docker实测验收证据（docs/DOCKER_VALIDATION.md，17/17 PASS；如愿意可现场演示 `powershell -ExecutionPolicy Bypass -File scripts/demo-docker.ps1 -Action status`）、AI_USAGE本人确认项及Git本地分支。不要声称本轮已push/main已合并。

如180秒拍卖因第3项操作耗时已结束，重新规划预跑模拟时间，不用延迟剪辑改变事实。Agent预算应足够继续参与，但不应与两真人价格安排发生无法继续合法出价的冲突。录制后由本人逐帧检查敏感信息，且能解释锁顺序、requestId、结算恢复和多实例WS边界。
