// Add habits from a JSON file to a live ledger doc. Habits whose name already
// exists are skipped, so re-running is safe. Dry run unless --write.
//
//   ROOT=<rootUrl from /config.json> pnpm tsx scripts/add-habits.ts <ws url> <habits.json> [--write]
//
// habits.json: [{ "name": "...", "expectation": {...}, "tags": ["..."],
//                 "since": "YYYY-MM-DD", "note": "..." }]
// - expectation: any Expectation (types.ts), e.g. {"kind":"every","n":3,"unit":"month"}
// - since (optional): a check-in on that day, so an interval habit counts from
//   then (an install date) instead of being due at once. Noted as a baseline.
// - note (optional): text for that day's note, e.g. where the instructions are.
import { getConflicts } from "@automerge/automerge";
import { Repo } from "@automerge/automerge-repo";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { readFileSync } from "node:fs";
import type { Expectation, LedgerDoc, RootDoc } from "../src/model/types";
import { addNote, createHabit, createTag, logEvent, setHabitTag } from "../src/store/mutations";

interface Spec {
  name: string;
  expectation: Expectation;
  tags?: string[];
  since?: string;
  note?: string;
}

const [url, file, ...flags] = process.argv.slice(2);
if (!url?.match(/^wss?:\/\//) || !file) throw new Error("usage: add-habits <ws url> <habits.json> [--write]");
if (!process.env.ROOT) throw new Error("set ROOT=<rootUrl from /config.json>");
const write = flags.includes("--write");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UNITS = ["day", "week", "month", "year"];
function check(x: Spec, i: number): Spec {
  const at = `habit ${i} (${x?.name ?? "no name"})`;
  if (typeof x?.name !== "string" || !x.name.trim()) throw new Error(`${at}: name missing`);
  const e = x.expectation as Record<string, unknown>;
  const ok =
    e?.kind === "daily" ||
    (e?.kind === "weekdays" && Array.isArray(e.days) && e.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) ||
    (e?.kind === "every" && Number.isInteger(e.n) && (e.n as number) > 0 && UNITS.includes(e.unit as string)) ||
    (e?.kind === "per" && Number.isInteger(e.times) && (e.times as number) > 0 && UNITS.slice(1).includes(e.unit as string));
  if (!ok) throw new Error(`${at}: bad expectation ${JSON.stringify(e)}`);
  if (x.tags && !(Array.isArray(x.tags) && x.tags.every((t) => typeof t === "string"))) throw new Error(`${at}: tags must be strings`);
  if (x.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(x.since)) throw new Error(`${at}: since must be YYYY-MM-DD`);
  if (x.note !== undefined && !x.since) throw new Error(`${at}: note needs since (it goes on that day)`);
  return { ...x, name: x.name.trim() };
}
const HABITS = (JSON.parse(readFileSync(file, "utf8")) as Spec[]).map(check);

const connect = async () => {
  const network = new WebSocketClientAdapter(url);
  const repo = new Repo({ network: [network] });
  await network.whenReady();
  return repo;
};
const open = async (repo: Repo) => {
  const signal = AbortSignal.timeout(30_000);
  const root = (await repo.find<RootDoc>(process.env.ROOT as never, { signal })).doc() as RootDoc;
  const h = await repo.find<LedgerDoc>(root.current as never, { signal });
  await sleep(5000); // let it fully sync before reading
  return h;
};

const h = await open(await connect());
const d = h.doc() as LedgerDoc;
if (!d.tags || !d.tagged) throw new Error("tags/tagged missing: not fully synced, refusing to write");
console.log("existing tags:", Object.values(d.tags).map((t) => t.name));

const have = new Set(Object.values(d.habits).map((x) => x.name.trim().toLowerCase()));
const todo = HABITS.filter((x) => !have.has(x.name.toLowerCase()));
const skipped = HABITS.filter((x) => have.has(x.name.toLowerCase()));
if (skipped.length) console.log("already there, skipping:", skipped.map((x) => x.name));
console.log(write ? "adding:" : "dry run, would add:");
for (const x of todo) console.log(" ", x.name, JSON.stringify(x.expectation), x.tags ?? [], x.since ? `since ${x.since}` : "");

if (write && todo.length) {
  for (const x of todo) {
    const id = createHabit(h, x.name, x.expectation);
    for (const t of x.tags ?? []) setHabitTag(h, id, createTag(h, t), true);
    if (x.since) {
      const typeId = (h.doc() as LedgerDoc).habits[id]!.eventTypeIds[0]!;
      logEvent(h, { typeId, occurred: { kind: "day", date: x.since } });
      addNote(h, id, x.since, x.note ?? "Baseline: counted from here (added by script).");
    }
  }
  await sleep(5000);
  const d2 = (await open(await connect())).doc() as LedgerDoc;
  for (const k of ["tags", "tagged"] as const) {
    const n = Object.keys(getConflicts(d2, k) ?? {}).length;
    console.log(`${k}: ${Object.keys(d2[k] ?? {}).length} entries, ${n} copies`);
  }
  for (const x of todo) {
    const hb = Object.values(d2.habits).find((y) => y.name === x.name);
    const tags = Object.keys(d2.tagged ?? {}).filter((k) => hb && k.startsWith(hb.id + " "));
    console.log(x.name, hb ? "ok" : "MISSING", tags.length, "tags");
  }
}
process.exit(0);
