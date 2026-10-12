# 修复前独立失败证据

日期2026-10-12；原始代码60c0589，先生成/提交只读审计243c56e。原始日志在本机logs/codex-*.log；没有改写前任历史报告。

1. 原前端20项独立通过。新增/强化的23项修复前3FAIL：领跑者undefined、缺号推进seq、跨房间/旧快照。修复后新增演示筛选达到24项。
2. 首批真实MySQL回归14项，最初7FAIL/1ERROR。其中两项是审计者异常类型预期错误（RuntimeException与实际SQLException），不计生产缺陷，修正异常类型后资金/流水回滚断言不变。实质失败包括requestId跨场复用、跨场并发SQL1213、逆序钱包锁、取消FINISHED、join.type=HUMAN、列表缺leader/result。
3. 后补scope空格和停用用户会话各实际失败，再补规范化/ACTIVE查询；非法amount原为500（缺失NPE、非数字StatusException），修复后400且无写入。
4. OpenAPI原常见地址404；初次动态生成因未标@Api而paths为空，添加实际操作注解后校验完整路径/方法/请求body/security。
5. 首次完整HTTP在Oracle javapath包装器退出后真实JVM残留，重启占用8290；确认属于审计创建的进程后停止，改实际JDK路径。后续真实双实例及重启通过。不是用户已有8090服务问题。
6. WS快照代码改调用Service后残留checked catch，构建FAIL；当时误启动旧target/classes的seed42明确25PASS/2FAIL/1NOT_VERIFIED，不计最终验收。
7. 新库仅一场导致原排序检查NOT_VERIFIED；新增独立管理员DRAFT夹具后原断言能检验排序（42项，而非前任41项）。不删数据、不改断言。
8. seed7两次BindException/Readiness timeout；8460是WPS PID6616的IPv6 Bound（未监听），原loopback预检漏报；Java wildcard绑定探针确认。保留WPS，改8470、双栈预检。失败启动本身保留FAIL，不以“重跑就好”代替定位。
9. 浏览器首轮8PASS/1FAIL，详browser-before-wait-fix.json：S2在auth写localStorage后、router.push完成前读path=/login，随后S3–S9成功。LoginView/Store源码确认顺序；测试改同时等待有效token与自动导航，不改S2必须离开/login的断言、不用手工跳转制造S2成功。
10. 下一轮浏览器9项虽全PASS，外围真实SQL要求两个participants却查得1，整体验证明确FAIL（browser-participant-fixture-before.json）。原脚本B只API出价没join；补B正常公开join流程，不把断言改成1。补充JVM命令一次因PowerShell未引号的-Dserver.port被拆成生命周期.port，属于工具调用错误；统一入口的引号参数正确。

stop-local复用组件wrapperPid=0但仍停止listener的安全缺陷经源码确认，补模拟进程命令的测试验证“不调用Stop-Process”；不通过终止用户真实进程演示故障。

故障注入只在bid_arena_codex_*独立库创建审计拥有的触发器/探针并恢复删除，保留业务数据与结果。新增测试不是保证所有未来执行顺序无风险；完整最新三态、边界和命令见CODEX_FINAL_AUDIT。
