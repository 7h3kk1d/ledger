import { describe, expect, it } from "vitest";
import * as A from "@automerge/automerge";
import { unsynced } from "./sync";

describe("unsynced", () => {
  it("counts the changes made since the server's heads", () => {
    let doc = A.from<{ n: number }>({ n: 0 });
    const server = A.getHeads(doc);
    expect(unsynced(doc, server)).toBe(0);
    doc = A.change(doc, (d) => { d.n = 1; });
    doc = A.change(doc, (d) => { d.n = 2; });
    expect(unsynced(doc, server)).toBe(2);
    expect(unsynced(doc, A.getHeads(doc))).toBe(0);
  });

  it("can't tell when the server has changes this copy hasn't seen", () => {
    const base = A.from<{ n: number }>({ n: 0 });
    const other = A.change(A.clone(base), (d) => { d.n = 5; });
    expect(unsynced(base, A.getHeads(other))).toBeUndefined();
  });
});
