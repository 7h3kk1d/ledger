import { describe, expect, it } from "vitest";
import { SignalsClient, type CacheStore, type ChangeStream } from "./client";

const A = "src/a/me";
const B = "src/b/me";
const obs = (id: string, date: string) => ({ id, occurred: { kind: "day", date }, effect: "satisfies", metrics: {} });

/** A fake service: records requests and answers from a script. */
function service() {
  const requests: URL[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://ledger");
    requests.push(url);
    if (url.pathname === "/signals") return Response.json({ generated_at: "x", signals: [] });
    const ids = url.searchParams.getAll("id");
    const incremental = url.searchParams.get("cursor") === "g1";
    return Response.json({
      cursor: "g1",
      generated_at: "x",
      signals: Object.fromEntries(
        ids.map((id) => [
          id,
          incremental
            ? { complete: false, current: { streak: 2 }, observations: [obs(`${id}:live`, "2026-10-21")] }
            : { complete: true, current: { streak: 1 }, observations: [obs(`${id}:1`, "2026-10-20")], fresh_at: "t" },
        ]),
      ),
    });
  }) as typeof fetch;
  return { requests, fetchFn };
}

const memory = (): CacheStore & { saved?: unknown } => {
  const c: CacheStore & { saved?: unknown } = {
    get: async () => undefined,
    put: async (v) => void (c.saved = v),
  };
  return c;
};

describe("SignalsClient", () => {
  it("does nothing without a url", async () => {
    const s = service();
    const c = new SignalsClient(undefined, memory(), s.fetchFn);
    c.want([A]);
    await c.refresh();
    expect(c.snapshot.enabled).toBe(false);
    expect(s.requests).toEqual([]);
  });

  it("fetches everything first, then only what's new with the cursor", async () => {
    const s = service();
    const cache = memory();
    const c = new SignalsClient("/signals", cache, s.fetchFn);
    c.want([A]);
    await c.refresh();
    const first = s.requests.find((u) => u.pathname.endsWith("/observations"))!;
    expect(first.searchParams.getAll("id")).toEqual([A]);
    expect(first.searchParams.get("cursor")).toBeNull();
    expect(c.snapshot.data.get(A)?.observations.map((o) => o.id)).toEqual([`${A}:1`]);

    await c.refresh();
    expect(s.requests.at(-1)!.searchParams.get("cursor") ?? s.requests.at(-2)!.searchParams.get("cursor")).toBe("g1");
    const a = c.snapshot.data.get(A)!;
    expect(a.observations.map((o) => o.id)).toEqual([`${A}:1`, `${A}:live`]);
    expect(a.current).toEqual({ streak: 2 });
    expect(a.freshAt).toBe("t");
    expect(cache.saved).toBeTruthy();
    expect(c.snapshot.error).toBeUndefined();
  });

  it("starts over without the cursor when a signal is newly linked, and drops unlinked ones", async () => {
    const s = service();
    const c = new SignalsClient("/signals", memory(), s.fetchFn);
    c.want([A]);
    await c.refresh();
    c.want([B]);
    await c.refresh();
    const last = s.requests.filter((u) => u.pathname.endsWith("/observations")).at(-1)!;
    expect(last.searchParams.getAll("id")).toEqual([B]);
    expect(last.searchParams.get("cursor")).toBeNull();
    expect([...c.snapshot.data.keys()]).toEqual([B]);
  });

  it("keeps what it had when the service fails", async () => {
    let up = true;
    const s = service();
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!up) throw new TypeError("network down");
      return s.fetchFn(input, init);
    }) as typeof fetch;
    const c = new SignalsClient("/signals", memory(), fetchFn);
    c.want([A]);
    await c.refresh();
    up = false;
    await c.refresh();
    expect(c.snapshot.error).toBe("network down");
    expect(c.snapshot.data.get(A)?.observations).toHaveLength(1);
  });

  it("refreshes when the change stream names a linked signal, or all of them", async () => {
    const s = service();
    const opened: (ChangeStream & { url: string; closed: boolean; send: (d: string) => void })[] = [];
    const open = (url: string, onMessage: (data: string) => void) => {
      const st = { url, closed: false, send: onMessage, close: () => void (st.closed = true) };
      opened.push(st);
      return st;
    };
    const c = new SignalsClient("/signals", memory(), s.fetchFn, open);
    c.want([A]);
    await c.refresh();
    c.listen();
    c.listen(); // once
    expect(opened.map((o) => o.url)).toEqual(["/signals/changes?cursor=g1"]);
    const observations = () => s.requests.filter((u) => u.pathname.endsWith("/observations")).length;
    const before = observations();
    opened[0]!.send(JSON.stringify({ cursor: "g2", signals: [B] }));
    await c.refresh(); // settle: nothing was asked for B
    expect(observations()).toBe(before + 1);
    opened[0]!.send(JSON.stringify({ cursor: "g2", signals: [A] }));
    await c.refresh();
    expect(observations()).toBeGreaterThanOrEqual(before + 3);
    const n = observations();
    opened[0]!.send(JSON.stringify({ cursor: "g3", signals: null }));
    opened[0]!.send("not json");
    await c.refresh();
    expect(observations()).toBeGreaterThan(n);
    c.unlisten();
    expect(opened[0]!.closed).toBe(true);
  });
});
