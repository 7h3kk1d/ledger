import { describe, expect, it } from "vitest";
import type { SignalData, SignalInfo } from "../../model/signals";
import { isOutsidePref, outsideRows, shownSignals, toggleShown } from "./outside";

const info: SignalInfo = {
  id: "pt", source: "apple-health", account: "me", label: "Trainerize workout", grain: "interval", live: false,
  metrics: [{ key: "minutes", label: "Minutes", unit: "min", on: "observation" }],
};

describe("outside data in Events", () => {
  it("shows linked signals unless hidden, and chosen ones", () => {
    expect(shownSignals(["a", "b"], undefined)).toEqual(["a", "b"]);
    const p = toggleShown(["a", "b"], toggleShown(["a", "b"], undefined, "b", false), "c", true);
    expect(p).toEqual({ extra: ["c"], hidden: ["b"] });
    expect(shownSignals(["a", "b"], p)).toEqual(["a", "c"]);
    expect(shownSignals(["a", "b"], toggleShown(["a", "b"], p, "b", true))).toEqual(["a", "b", "c"]);
    expect(isOutsidePref(p)).toBe(true);
    expect(isOutsidePref({ extra: [1] })).toBe(false);
  });

  it("makes read-only rows, newest first, on the day an interval ends", () => {
    const data = new Map<string, SignalData>([["pt", {
      current: {},
      observations: [
        { id: "w1", occurred: { kind: "interval", start: "2026-10-30T12:00:00Z", end: "2026-10-30T12:30:00Z" }, effect: "satisfies",
          metrics: { minutes: 30 }, detail: "Neck/Shoulder", provisional: true },
        { id: "w0", occurred: { kind: "interval", start: "2026-10-29T12:00:00Z", end: "2026-10-29T12:30:00Z" }, effect: "satisfies", metrics: {} },
      ],
    }]]);
    const rows = outsideRows(data, (id) => (id === "pt" ? info : undefined), ["pt", "nothing"]);
    expect(rows.map((r) => [r.o.id, r.label, r.text, r.o.provisional])).toEqual([
      ["w1", "Trainerize workout", "Neck/Shoulder · Minutes 30 min", true],
      ["w0", "Trainerize workout", "", undefined],
    ]);
    expect(rows[0]!.date).toBe("2026-10-30");
  });
});
