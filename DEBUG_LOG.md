# 真实调试日志摘要

2026-10-12独立审计。原始运行日志留在本机logs/codex-*.log（已忽略Git）；可提交的三态结果在docs/audit-evidence。初始代码60c0589；初始审计243c56e。下面不包含明文Token。

| 类别 | 实际观察 | 处理与复核 |
|---|---|---|
| P0 | crossAuctionRequestRace出现MySQL1213 Deadlock；高ID钱包在等待低ID钱包时已被占用 | 钱包升序锁；跨场并发、确定锁序、SQL1213/1205整笔重试回归 |
| P0 | 同用户requestId跨场同amount未报冲突 | 核对auctionId+amount；串行化用户钱包，复用/并发/不同金额均对账 |
| P1 | cancel回归期望CANCELLED，实际FINISHED | 独立markCancelled，检查冻结释放与唯一取消结果 |
| P1 | join事件type实际HUMAN，不是PARTICIPANT_JOINED | participantType，不覆盖信封，HTTP/WS事件实测 |
| P1 | OpenAPI已加依赖但常见地址404；最初导出操作为空 | Controller与操作显式Swagger注解、动态/openapi.json及实际路径/方法/security检查 |
| P1 | 非法/缺失amount发生NullPointerException或Solon StatusException、500 | BigDecimal整数/范围检查，绑定错误映射400/1005，无资金副作用检查 |
| P1 | 带空格scopes签发后拒绝；停用用户旧会话仍有效 | 规范化权限、数据库ACTIVE门禁、真实Token有效期/吊销/并发配额 |
| P1 | stop-local复用时wrapperPid=0但仍停止记录的listener | 停止listener亦须wrapper归属，回归验证不调用Stop-Process |
| P2 | Vue卡片输出undefined；旧快照/跨房间及缺口事件处理错误 | 服务端完整摘要+fallback、房间/seq保护与权威快照回归 |
| P2 | PowerShell测试中文标题出现问号；测试场混入演示 | UTF-8 JSON Content-Type；新库测试；显式[DEMO]筛选，不修改历史用户数据 |
| 测试工具 | 两个注入故障断言写RuntimeException，Solon代理实际可抛SQLException | 改异常类型范围为Exception，不改变任何资金/状态/流水回滚断言；不算生产缺陷 |
| 测试工具 | Oracle javapath launcher结束后真实JVM仍占8290，重启失败 | BID_JAVA_EXE/JAVA_HOME直指JDK；仅终止审计自己创建且核实命令行的进程 |
| 编译 | WS快照改调Service后遗留catch(SQLException)，编译器拒绝 | 改快照catch Exception，重新构建；失败构建期间模拟结果不计最终通过 |
| 环境/测试工具 | seed7两次失败：8460未监听但已被另一进程IPv6 Bound；IPv4 loopback检查漏报 | Get-NetTCPConnection全状态与Java wildcard探针确认；保留原进程，改空闲8470，预检改IPv6双栈 |
| 测试夹具 | 浏览器9项PASS后数据库participantCount仅1，外围验收FAIL | B原仅API出价；补正常API join，不降低要求两个参与者的SQL断言 |

最后一项旧构建模拟确实FAIL（25PASS/2FAIL/1NOT_VERIFIED），记录而不改标签。全新库最初仅一个DRAFT导致排序检查NOT_VERIFIED；后续通过管理员API增加第二个独立DRAFT夹具，使原排序断言可观察，不改变排序断言。

完整最新结果/命令/数据库与限制见CODEX_FINAL_AUDIT；任何阶段失败都必须保留FAIL，不能把未跑场景记PASS。用户报告的“外部^C”没有在本轮独立证实，不作为本轮已确认根因。
