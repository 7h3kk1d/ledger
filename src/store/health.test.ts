import { afterEach, describe, expect, it } from "vitest";
import { applyHealthUrl, checkPushUrl, chosenHealthUrl, syncHealth, type HealthStatus } from "./health";

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

describe("the served receiver", () => {
  const plugin = (pushUrl?: string) => {
    const set: string[] = [];
    const h = {
      status: async () => ({ available: true, asked: true, waiting: 0, hasToken: true, pushUrl }) as HealthStatus,
      setPush: async (o: { url: string }) => (set.push(o.url), {} as HealthStatus),
    };
    return { h: h as unknown as Parameters<typeof applyHealthUrl>[1], set };
  };
  const SERVED = { healthUrl: "https://healthkit.example/ingest" };

  it("a new phone takes the Ledger server's; one already sending there isn't touched", async () => {
    const fresh = plugin();
    await applyHealthUrl(chosenHealthUrl(SERVED, {}), fresh.h);
    expect(fresh.set).toEqual(["https://healthkit.example/ingest"]);
    const same = plugin("https://healthkit.example/ingest");
    await applyHealthUrl(chosenHealthUrl(SERVED, {}), same.h);
    expect(same.set).toEqual([]);
  });

  it("the phone's own choice wins, including keeping it on the phone; with neither, what's there stays", async () => {
    const off = plugin("https://healthkit.example/ingest");
    await applyHealthUrl(chosenHealthUrl({ ...SERVED, healthUrl: "https://mine.example/ingest" }, { healthUrl: "" }), off.h);
    expect(off.set).toEqual([""]);
    const own = plugin("https://older.example/ingest");
    await applyHealthUrl(chosenHealthUrl({}, {}), own.h);
    expect(own.set).toEqual([]);
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
