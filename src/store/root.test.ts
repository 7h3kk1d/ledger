import { describe, expect, it } from "vitest";
import { Repo, type AutomergeUrl, type DocHandle } from "@automerge/automerge-repo";
import { activeHabits, habitHue } from "../model/reduce";
import { DATA_EPOCH, type RootDoc } from "../model/types";
import { createLedger, createRoot, habitSeed, previousDocs, rollover, switchTo } from "./root";
import { setHabitArchived, toggleHabit } from "./mutations";

const doc = <T,>(h: DocHandle<T>) => h.doc() as T;

function setup() {
  const repo = new Repo({});
  const ledger = createLedger(repo, [{ name: "Floss" }, { name: "Anki", hue: 275 }, { name: "Old" }]);
  const root = createRoot(repo, ledger);
  return { repo, ledger, root };
}

describe("root doc", () => {
  it("starts at the current epoch, pointing at the ledger", () => {
    const { ledger, root } = setup();
    expect(doc(root)).toEqual({ current: ledger.url, epoch: DATA_EPOCH, history: [] });
    expect(activeHabits(doc(ledger)).map((h) => h.name)).toEqual(["Floss", "Anki", "Old"]);
    expect(habitHue(activeHabits(doc(ledger))[1]!)).toBe(275);
  });

  it("reset carries the active habits over, without events, and keeps the old doc", () => {
    const { repo, ledger, root } = setup();
    const floss = activeHabits(doc(ledger))[0]!;
    toggleHabit(ledger, floss, "2026-10-20");
    setHabitArchived(ledger, activeHabits(doc(ledger))[2]!.id, true);

    const next = rollover(repo, root, habitSeed(doc(ledger)), "reset");

    const habits = activeHabits(doc(next));
    expect(habits.map((h) => h.name)).toEqual(["Floss", "Anki"]);
    expect(habits.map(habitHue)).toEqual(activeHabits(doc(ledger)).map(habitHue));
    expect(Object.keys(doc(next).events)).toEqual([]);
    expect(doc(root).current).toBe(next.url);
    expect(doc(root).history).toMatchObject([{ url: ledger.url, epoch: DATA_EPOCH, reason: "reset" }]);
    expect(Object.keys(doc(ledger).events)).toHaveLength(1); // untouched
  });

  it("an epoch rollover keeps names only", () => {
    const { ledger } = setup();
    expect(habitSeed(doc(ledger), true)).toEqual([{ name: "Floss" }, { name: "Anki" }, { name: "Old" }]);
  });

  it("never lowers the epoch", () => {
    const { ledger, root } = setup();
    root.change((d) => void (d.epoch = DATA_EPOCH + 1));
    switchTo(root, ledger.url.replace(/.$/, "x") as AutomergeUrl, "switch");
    expect(doc(root).epoch).toBe(DATA_EPOCH + 1);
  });

  it("lists previous docs newest first, once each, without the current one", () => {
    const { repo, ledger, root } = setup();
    const b = rollover(repo, root, [], "reset");
    switchTo(root, ledger.url, "switch"); // back to the first
    expect(doc(root).current).toBe(ledger.url);
    const prev = previousDocs(doc<RootDoc>(root));
    expect(prev.map((e) => e.url)).toEqual([b.url]);
    expect(prev[0]!.reason).toBe("switch");
  });

  it("switching to the current doc is a no-op", () => {
    const { ledger, root } = setup();
    switchTo(root, ledger.url, "switch");
    expect(doc(root).history).toEqual([]);
  });
});

