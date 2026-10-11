/**
 * 检查报告器：每条断言必须落为 PASS / FAIL / NOT_VERIFIED 三态之一。
 * - PASS：对真实后端响应断言成立
 * - FAIL：真实响应违反契约/预期（附证据）
 * - NOT_VERIFIED：前置条件不满足（服务不可用、账号状态异常等），无法得出结论
 * 退出码：0=无 FAIL；1=存在 FAIL；2=环境不可用。
 */

export type Status = "PASS" | "FAIL" | "NOT_VERIFIED";

export interface CheckRecord {
  id: string;
  group: string;
  name: string;
  status: Status;
  details: string;
  at: number;
}

export class Reporter {
  readonly records: CheckRecord[] = [];
  readonly startedAt = Date.now();
  readonly meta: Record<string, unknown>;

  constructor(meta: Record<string, unknown>) {
    this.meta = meta;
  }

  private record(id: string, group: string, name: string, status: Status, details: string): void {
    this.records.push({ id, group, name, status, details, at: Date.now() });
    const icon = status === "PASS" ? "✔" : status === "FAIL" ? "✘" : "？";
    console.log(`  [${icon} ${status}] ${id} ${name}${details ? ` — ${details}` : ""}`);
  }

  pass(id: string, group: string, name: string, details = ""): void {
    this.record(id, group, name, "PASS", details);
  }

  fail(id: string, group: string, name: string, details = ""): void {
    this.record(id, group, name, "FAIL", details);
  }

  notVerified(id: string, group: string, name: string, reason = ""): void {
    this.record(id, group, name, "NOT_VERIFIED", reason);
  }

  /** 条件断言：true→PASS，false→FAIL */
  check(id: string, group: string, name: string, cond: boolean, detailsFail = "", detailsPass = ""): boolean {
    this.record(id, group, name, cond ? "PASS" : "FAIL", cond ? detailsPass : detailsFail);
    return cond;
  }

  get counts(): { PASS: number; FAIL: number; NOT_VERIFIED: number } {
    const c = { PASS: 0, FAIL: 0, NOT_VERIFIED: 0 };
    for (const r of this.records) c[r.status]++;
    return c;
  }

  get hasFail(): boolean {
    return this.records.some((r) => r.status === "FAIL");
  }

  printSummary(): void {
    const c = this.counts;
    const durS = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    console.log("\n================ 模拟结果汇总 ================");
    for (const r of this.records) {
      console.log(`${r.status.padEnd(12)} ${r.id.padEnd(14)} ${r.name}`);
    }
    console.log("===============================================");
    console.log(`PASS=${c.PASS}  FAIL=${c.FAIL}  NOT_VERIFIED=${c.NOT_VERIFIED}  (耗时 ${durS}s)`);
    const verdict = c.FAIL > 0 ? "FAIL" : c.NOT_VERIFIED > 0 ? "PASS_WITH_NOT_VERIFIED" : "ALL_PASS";
    console.log(`总体判定: ${verdict}`);
  }

  toJson(): string {
    return JSON.stringify(
      {
        meta: { ...this.meta, finishedAt: new Date().toISOString(), durationMs: Date.now() - this.startedAt },
        counts: this.counts,
        verdict: this.hasFail ? "FAIL" : this.counts.NOT_VERIFIED > 0 ? "PASS_WITH_NOT_VERIFIED" : "ALL_PASS",
        records: this.records,
      },
      null,
      2,
    );
  }
}

export function evidence(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
}
