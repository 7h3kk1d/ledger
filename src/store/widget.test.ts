import { afterEach, describe, expect, it } from "vitest";
import * as A from "@automerge/automerge";
import { Repo } from "@automerge/automerge-repo";
import { activeHabits, doneIndex, habitEventsOn, localDate } from "../model/reduce";
import type { LedgerDoc } from "../model/types";
import { createLedger, createRoot } from "./root";
import { setHabitExpectation, toggleHabit } from "./mutations";
import { toBase64 } from "./fileStorage";
import { applyWidgetChanges, publishWidget, setWidgetLedger, widgetRows, type WidgetSnapshot } from "./widget";

const g = globalThis as { Capacitor?: unknown };
afterEach(() => void delete g.Capacitor);

/** Stand in for the iOS app's plugin; records what Ledger hands the widget. */
function fakeApp(pending: { docId: string; data: string }[] = []) {
  const published: WidgetSnapshot[] = [];
  g.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LedgerFiles: {
        publishWidget: async ({ snapshot }: { snapshot: string }) => void published.push(JSON.parse(snapshot)),
        takeWidgetChanges: async () => ({ changes: pending.splice(0) }),
      },
    },
  };
  return published;
}

function setup() {
  const repo = new Repo({});
  const handle = createLedger(repo, [{ name: "Stretch" }, { name: "Read" }, { name: "Gym" }]);
  const root = createRoot(repo, handle);
  return { repo, handle, root, doc: () => handle.doc() as LedgerDoc };
}

describe("widget rows", () => {
  it("lists what's due or done today, done ones after, not what's off today", () => {
    const { handle, doc } = setup();
    const today = "2026-11-20"; // a Friday
    const [stretch, read, gym] = activeHabits(doc());
    setHabitExpectation(handle, gym!.id, { kind: "weekdays", days: [1] }); // Mondays only
    toggleHabit(handle, read!, today);
    const rows = widgetRows(activeHabits(doc()), doneIndex(doc()), today);
    expect(rows.map((r) => [r.name, r.done, r.manual])).toEqual([
      ["Stretch", false, true],
      ["Read", true, true],
    ]);
    expect(rows[0]!.id).toBe(stretch!.id);
  });
});

describe("handing over", () => {
  it("publishes once per change, for the open ledger", async () => {
    const published = fakeApp();
    const { handle, root, doc } = setup();
    const rows = widgetRows(activeHabits(doc()), doneIndex(doc()), "2026-11-20");
    await publishWidget(rows); // before the shell set the ledger: kept for later
    expect(published).toHaveLength(0);
    setWidgetLedger(root, handle);
    await new Promise((r) => setTimeout(r, 0));
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ rootUrl: root.url, ledgerUrl: handle.url, epoch: 1, rows });
    await publishWidget(rows);
    expect(published).toHaveLength(1); // nothing changed
  });

  it("applies the ticks the widget made, once or twice alike", async () => {
    const { handle, doc } = setup();
    const stretch = activeHabits(doc())[0]!;
    // what the widget does: tick in a copy of the stored doc, keep the changes
    const copy = A.clone(doc());
    const before = A.getHeads(copy);
    const today = localDate(new Date());
    const ticked = A.change(copy, (d) => {
      d.events["w1"] = { id: "w1", typeId: stretch.eventTypeIds[0]!, author: "local", loggedAt: new Date().toISOString(), occurred: { kind: "day", date: today }, attrs: {} };
    });
    const change = { docId: handle.documentId, data: toBase64(A.saveSince(ticked, before)) };
    fakeApp([change, change, { docId: "someOtherDoc", data: change.data }]);

    expect(await applyWidgetChanges(handle)).toBe(2);
    expect(habitEventsOn(doc(), stretch, today)).toHaveLength(1);
    expect(await applyWidgetChanges(handle)).toBe(0); // handed over once
  });
});
