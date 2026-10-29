import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Repo, type DocHandle } from "@automerge/automerge-repo";
import { allTags, tagsOf, withTag } from "../model/reduce";
import type { LedgerDoc } from "../model/types";
import { createHabit, createTag, deleteTag, ensureTags, healTags, renameTag, setHabitTag } from "./mutations";
import { createLedger, habitSeed } from "./root";

const doc = (h: DocHandle<LedgerDoc>) => h.doc() as LedgerDoc;
const names = (ts: { name: string }[]) => ts.map((t) => t.name);

describe("tags", () => {
  it("gives a doc from before tags its maps, once", () => {
    const h = new Repo({}).create<LedgerDoc>({ eventTypes: {}, habits: {}, events: {} });
    ensureTags(h);
    expect(doc(h).tags).toEqual({});
    expect(doc(h).tagged).toEqual({});
    const heads = h.heads();
    ensureTags(h);
    expect(h.heads()).toEqual(heads);
  });

  it("tags habits, and a rename shows on every habit carrying the tag", () => {
    const h = createLedger(new Repo({}), []);
    const a = createHabit(h, "Floss");
    const b = createHabit(h, "Stretch");
    const t = createTag(h, "Evening");
    setHabitTag(h, a, t, true);
    setHabitTag(h, b, t, true);
    renameTag(h, t, "Night");
    expect(names(tagsOf(doc(h), a))).toEqual(["Night"]);
    expect(names(tagsOf(doc(h), b))).toEqual(["Night"]);
    setHabitTag(h, b, t, false);
    expect(withTag(doc(h), [{ id: a }, { id: b }], t)).toEqual([{ id: a }]);
  });

  it("reuses a tag of the same name, ignoring case", () => {
    const h = createLedger(new Repo({}), []);
    expect(createTag(h, " home ")).toBe(createTag(h, "Home"));
    expect(names(allTags(doc(h)))).toEqual(["home"]);
  });

  it("deletes a tag from every habit, leaving the habits", () => {
    const h = createLedger(new Repo({}), []);
    const a = createHabit(h, "Floss");
    const t = createTag(h, "Evening");
    const keep = createTag(h, "Daily");
    setHabitTag(h, a, t, true);
    setHabitTag(h, a, keep, true);
    deleteTag(h, t);
    expect(names(tagsOf(doc(h), a))).toEqual(["Daily"]);
    expect(Object.keys(doc(h).tagged!)).toHaveLength(1);
    expect(doc(h).habits[a]).toBeDefined();
    // filtering on a deleted tag shows everything
    expect(withTag(doc(h), [{ id: a }], t)).toEqual([{ id: a }]);
  });

  it("merges tagging done on two devices at once", () => {
    const repo = new Repo({});
    const h = createLedger(repo, []);
    const a = createHabit(h, "Floss");
    const t1 = createTag(h, "Evening");
    const t2 = createTag(h, "Health");
    const other = repo.clone(h);
    setHabitTag(h, a, t1, true);
    setHabitTag(other, a, t2, true);
    renameTag(other, t1, "Night");
    h.merge(other);
    expect(names(tagsOf(doc(h), a))).toEqual(["Health", "Night"]);
  });

  it("carries tags into a new doc on reset", () => {
    const h = createLedger(new Repo({}), []);
    const a = createHabit(h, "Floss");
    setHabitTag(h, a, createTag(h, "Evening"), true);
    const next = createLedger(new Repo({}), habitSeed(doc(h)));
    const [floss] = Object.values(doc(next).habits);
    expect(names(tagsOf(doc(next), floss!.id))).toEqual(["Evening"]);
  });
});

describe("healTags", () => {
  it("brings back tags hidden when two copies of an old doc each made their own maps", async () => {
    const repo = new Repo({});
    // a doc from before tags, with a habit, on two devices
    const a = repo.create<LedgerDoc>({ eventTypes: {}, habits: {}, events: {} });
    const floss = createHabit(a, "Floss");
    const b = repo.clone(a);
    // each opens it without the other's changes, makes the maps and tags something
    setHabitTag(a, floss, createTag(a, "Morning"), true);
    setHabitTag(b, floss, createTag(b, "Exports"), true);
    a.merge(b);
    expect(names(allTags(doc(a)))).toHaveLength(1); // one copy hidden

    expect(healTags(a)).toBe(true);
    expect(names(allTags(doc(a))).sort()).toEqual(["Exports", "Morning"]);
    expect(names(tagsOf(doc(a), floss)).sort()).toEqual(["Exports", "Morning"]);
    // healed for good: nothing more to do, and the other copy agrees once synced
    expect(healTags(a)).toBe(false);
    b.merge(a);
    expect(names(allTags(doc(b))).sort()).toEqual(["Exports", "Morning"]);
  });

  it("does nothing to a doc with one copy of each map", () => {
    const h = createLedger(new Repo({}), [{ name: "Floss", tags: ["Morning"] }]);
    const heads = h.heads();
    expect(healTags(h)).toBe(false);
    expect(h.heads()).toEqual(heads);
  });
});
