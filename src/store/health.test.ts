import { afterEach, describe, expect, it } from "vitest";
import { checkPushUrl, syncHealth, type HealthStatus } from "./health";

const g = globalThis as { Capacitor?: unknown };
afterEach(() => void delete g.Capacitor);

function fakeApp(status: Partial<HealthStatus>) {
  const calls: string[] = [];
  const s: HealthStatus = { available: true, asked: true, waiting: 0, hasToken: false, ...status };
  g.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LedgerHealth: {
        status: async () => (calls.push("status"), s),
        sync: async () => (calls.push("sync"), { ...s, lastReadCount: 3 }),
      },
    },
  };
  return calls;
}

describe("health sync", () => {
  it("does nothing in a browser", async () => {
    expect(await syncHealth(true)).toBeUndefined();
  });

  it("reads only once HealthKit was connected", async () => {
    const calls = fakeApp({ asked: false });
    expect((await syncHealth(true))?.asked).toBe(false);
    expect(calls).toEqual(["status"]);
  });

  it("reads at most once a minute unless asked to", async () => {
    const calls = fakeApp({});
    const t = 1_800_000_000_000;
    expect((await syncHealth(false, t))?.lastReadCount).toBe(3);
    expect(await syncHealth(false, t + 30_000)).toBeUndefined();
    expect((await syncHealth(true, t + 30_000))?.lastReadCount).toBe(3);
    expect(calls).toEqual(["status", "sync", "status", "sync"]);
  });
});

describe("receiver urls", () => {
  it("takes https addresses, or none", () => {
    expect(checkPushUrl("")).toBeUndefined();
    expect(checkPushUrl("https://healthkit.home.abanduk.com/ingest")).toBeUndefined();
    expect(checkPushUrl("http://localhost:18099/ingest")).toBeUndefined();
    expect(checkPushUrl("http://healthkit.example/ingest")).toMatch(/https/);
    expect(checkPushUrl("healthkit.example/ingest")).toMatch(/https/);
  });
});
