import { describe, expect, it } from "vitest";
import {
  chooseSetting,
  forgetLedger,
  isDocUrl,
  knownLedgers,
  localSettings,
  mergeConfig,
  rememberLedger,
  resolveSyncUrl,
  servedConfig,
  setLocalSetting,
  type Store,
} from "./config";

const memory = (): Store => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

describe("config", () => {
  it("a served config without syncUrl still syncs at /sync, as Ledger always did", () => {
    expect(mergeConfig({ rootUrl: "automerge:abc", signalsUrl: "/signals" }, {})).toEqual({
      syncUrl: "/sync",
      rootUrl: "automerge:abc",
      signalsUrl: "/signals",
    });
  });

  it("with nothing served (the iOS app), nothing syncs until set", () => {
    expect(mergeConfig(undefined, {})).toEqual({ syncUrl: undefined, rootUrl: undefined, signalsUrl: undefined });
  });

  it("settings win; an empty one turns the served value off", () => {
    const served = { syncUrl: "/sync", rootUrl: "automerge:abc" };
    expect(mergeConfig(served, { syncUrl: "wss://elsewhere/sync" }).syncUrl).toBe("wss://elsewhere/sync");
    expect(mergeConfig(served, { syncUrl: "" }).syncUrl).toBeUndefined();
    expect(mergeConfig(served, { rootUrl: "automerge:def" }).rootUrl).toBe("automerge:def");
  });

  it("choosing what the host serves drops the override", () => {
    const store = memory();
    const served = { rootUrl: "automerge:abc" };
    chooseSetting("rootUrl", "automerge:def", served, store);
    expect(localSettings(store)).toEqual({ rootUrl: "automerge:def" });
    chooseSetting("rootUrl", "automerge:abc", served, store);
    expect(localSettings(store)).toEqual({});
    // the implied /sync counts as served too
    chooseSetting("syncUrl", "/sync", served, store);
    expect(localSettings(store)).toEqual({});
    setLocalSetting("syncUrl", "", store);
    expect(localSettings(store)).toEqual({ syncUrl: "" });
  });

  it("resolves a path on the app's own host", () => {
    expect(resolveSyncUrl("/sync", { protocol: "https:", host: "ledger.example" })).toBe("wss://ledger.example/sync");
    expect(resolveSyncUrl("sync", { protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/sync");
    expect(resolveSyncUrl("wss://x/sync", { protocol: "capacitor:", host: "localhost" })).toBe("wss://x/sync");
  });
});

describe("ledgers on this device", () => {
  it("keeps the most recently opened first, once each", () => {
    const store = memory();
    rememberLedger("automerge:a", "Mine", store, new Date("2026-11-20T10:00:00Z"));
    rememberLedger("automerge:b", undefined, store, new Date("2026-11-20T11:00:00Z"));
    rememberLedger("automerge:a", "Mine", store, new Date("2026-11-20T12:00:00Z"));
    expect(knownLedgers(store)).toEqual([
      { url: "automerge:a", name: "Mine", openedAt: "2026-11-20T12:00:00.000Z" },
      { url: "automerge:b", openedAt: "2026-11-20T11:00:00.000Z" },
    ]);
    forgetLedger("automerge:a", store);
    expect(knownLedgers(store).map((l) => l.url)).toEqual(["automerge:b"]);
  });

  it("recognises doc urls", () => {
    expect(isDocUrl("automerge:2H9qGxsq1VSzRXo4aFsCPXo8TS2a")).toBe(true);
    expect(isDocUrl(" automerge:2H9qGxsq1VSzRXo4aFsCPXo8TS2a ")).toBe(true);
    expect(isDocUrl("2H9qGxsq1VSzRXo4aFsCPXo8TS2a")).toBe(false);
    expect(isDocUrl("automerge:0OIl")).toBe(false);
  });
});

describe("served config", () => {
  const json = (body: unknown) => (async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })) as typeof fetch;
  const notFound = (async () => new Response("", { status: 404 })) as typeof fetch;
  const html = (async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
  const offline = (async () => { throw new TypeError("Load failed"); }) as typeof fetch;

  it("keeps a copy for offline starts", async () => {
    const store = memory();
    expect(await servedConfig(store, json({ rootUrl: "automerge:abc" }))).toEqual({ rootUrl: "automerge:abc" });
    expect(await servedConfig(store, offline)).toEqual({ rootUrl: "automerge:abc" });
  });

  it("forgets the copy once the host answers without one (the iOS app, a bare dev server)", async () => {
    for (const none of [notFound, html]) {
      const store = memory();
      await servedConfig(store, json({ rootUrl: "automerge:abc" }));
      expect(await servedConfig(store, none)).toBeUndefined();
      expect(await servedConfig(store, offline)).toBeUndefined();
    }
  });
});

describe("served config in the iOS app", () => {
  it("a failed fetch means no config, not a cached one", async () => {
    const store = memory();
    const json = (async () => new Response(JSON.stringify({ rootUrl: "automerge:dev" }), { headers: { "content-type": "application/json" } })) as typeof fetch;
    const missing = (async () => { throw new TypeError("Load failed"); }) as typeof fetch;
    await servedConfig(store, json);
    expect(await servedConfig(store, missing, false)).toBeUndefined();
    expect(await servedConfig(store, missing)).toBeUndefined(); // and the old copy is gone
  });
});

describe("a Ledger server (the iOS app)", () => {
  const LEDGER = { rootUrl: "automerge:abc", syncUrl: "/sync", signalsUrl: "/signals", healthUrl: "https://healthkit.example/ingest" };
  /** The bundled config.json names the server; the server's names the rest. */
  const hosts = (bundled: unknown, server: unknown) =>
    (async (u: string) => {
      const body = u === "/config.json" ? bundled : u === "https://ledger.example/config.json" ? server : undefined;
      if (body === undefined) throw new TypeError("Load failed");
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
  const offline = (async () => { throw new TypeError("Load failed"); }) as typeof fetch;

  it("one built-in address supplies every endpoint, as full urls on that server", async () => {
    const store = memory();
    const served = await servedConfig(store, hosts({ server: "https://ledger.example" }, LEDGER), false);
    expect(mergeConfig(served, localSettings(store))).toEqual({
      server: "https://ledger.example",
      rootUrl: "automerge:abc",
      syncUrl: "wss://ledger.example/sync",
      signalsUrl: "https://ledger.example/signals",
      healthUrl: "https://healthkit.example/ingest",
    });
  });

  it("a server's config without syncUrl syncs at its /sync, as a Ledger host always did", async () => {
    const served = await servedConfig(memory(), hosts({ server: "https://ledger.example/" }, { rootUrl: "automerge:abc" }), false);
    expect(served?.syncUrl).toBe("wss://ledger.example/sync");
  });

  it("keeps the server's copy for offline starts, but not across servers", async () => {
    const store = memory();
    await servedConfig(store, hosts({ server: "https://ledger.example" }, LEDGER), false);
    // offline: the bundled file is still there, the server isn't
    const bundledOnly = hosts({ server: "https://ledger.example" }, undefined);
    expect((await servedConfig(store, bundledOnly, false))?.signalsUrl).toBe("https://ledger.example/signals");
    setLocalSetting("server", "https://other.example", store);
    expect((await servedConfig(store, bundledOnly, false))?.signalsUrl).toBeUndefined();
  });

  it("the device's own server, or none, overrides the built-in one; its settings override the server", async () => {
    const store = memory();
    setLocalSetting("server", "", store);
    expect(await servedConfig(store, hosts({ server: "https://ledger.example" }, LEDGER), false)).toEqual({ server: "https://ledger.example" });
    setLocalSetting("server", "https://ledger.example", store);
    setLocalSetting("signalsUrl", "https://mine.example/signals", store);
    const served = await servedConfig(store, hosts(undefined, LEDGER), false);
    expect(mergeConfig(served, localSettings(store)).signalsUrl).toBe("https://mine.example/signals");
    expect(mergeConfig(served, localSettings(store)).syncUrl).toBe("wss://ledger.example/sync");
  });

  it("nothing built in and nothing set: the welcome screen, as before", async () => {
    expect(await servedConfig(memory(), offline, false)).toBeUndefined();
  });
});

describe("checking urls", () => {
  it("takes a server's address", async () => {
    const { checkUrl } = await import("./config");
    for (const ok of ["", "https://ledger.example", "https://ledger.example/", "http://localhost:5173"]) expect(checkUrl("server", ok)).toBeUndefined();
    for (const bad of ["ledger.example", "https://ledger.example/sync", "wss://ledger.example"]) expect(checkUrl("server", bad)).toMatch(/https:/);
  });

  it("takes ws(s) urls, paths and empty for the sync server", async () => {
    const { checkUrl } = await import("./config");
    for (const ok of ["", "/sync", "wss://ledger.example/sync", "ws://localhost:3030"]) expect(checkUrl("syncUrl", ok)).toBeUndefined();
    for (const bad of ["was://ledger.example/sync", "ledger.example/sync", "https://ledger.example/sync", "wss://"])
      expect(checkUrl("syncUrl", bad)).toMatch(/wss:/);
    expect(checkUrl("signalsUrl", "https://x/signals")).toBeUndefined();
    expect(checkUrl("signalsUrl", "htps://x")).toMatch(/https:/);
  });
});
