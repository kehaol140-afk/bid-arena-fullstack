export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.max(0, ms)));

export function now(): number {
  return Date.now();
}

/** 等到目标时刻（epoch ms）；已过则立即返回 */
export async function waitUntil(targetEpochMs: number): Promise<void> {
  const d = targetEpochMs - Date.now();
  if (d > 0) await sleep(d);
}

export function fmtTs(ms: number): string {
  return new Date(ms).toISOString();
}

export function j(v: unknown): string {
  return JSON.stringify(v);
}

/** 带超时的轮询 */
export async function pollUntil(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return await fn();
}
