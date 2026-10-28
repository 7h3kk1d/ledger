import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Repo, type DocHandle } from "@automerge/automerge-repo";
import { allTags, tagsOf, withTag } from "../model/reduce";
import type { LedgerDoc } from "../model/types";
import { createHabit, createTag, deleteTag, ensureTags, renameTag, setHabitTag } from "./mutations";
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
