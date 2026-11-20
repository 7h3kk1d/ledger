// The iOS home-screen widget's side of Ledger (ios/Widget). Ledger decides what the widget lists:
// its own Today rows (due or done today, in its order, with linked data), published as
// widget.json in the app group. The widget only re-reads "ticked today" from the doc and writes
// ticks there; those come back here (applyWidgetChanges) to be saved and synced like any change.
// A no-op in a browser.
import * as A from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Habit, LedgerDoc, RootDoc } from "../model/types";
import { DATA_EPOCH } from "../model/types";
import { habitHue, isDone, localDate, signalsOf, type DoneIndex } from "../model/reduce";
import { todaySections } from "../ui/habits/Today";
import { fromBase64, nativeFiles, type FilesPlugin } from "./fileStorage";

export interface WidgetRow {
  id: string;
  name: string;
  hue: number;
  done: boolean;
  /** Ticked by hand: no linked data. */
  manual: boolean;
  sub?: string;
}

/** ios/Shared/WidgetFiles.swift WidgetSnapshot reads this. */
export interface WidgetSnapshot {
  rootUrl: string;
  ledgerUrl: string;
  name?: string;
  epoch: number;
  date: string;
  rows: WidgetRow[];
  updatedAt: string;
}

interface WidgetPlugin extends FilesPlugin {
  publishWidget(o: { snapshot: string }): Promise<void>;
  takeWidgetChanges(): Promise<{ changes: { docId: string; data: string }[] }>;
}

const plugin = () => nativeFiles() as WidgetPlugin | undefined;

/** Today's rows as the Today view has them with nothing hidden: due or done today, in its order. */
export function widgetRows(
  habits: readonly Habit[],
  idx: DoneIndex,
  today: string,
  sub: (h: Habit) => string | undefined = () => undefined,
): WidgetRow[] {
  return todaySections(habits, idx, today, { hideDone: false }).open.map((h) => {
    const s = sub(h);
    return { id: h.id, name: h.name, hue: habitHue(h), done: isDone(idx, h, today), manual: signalsOf(h).length === 0, ...(s ? { sub: s } : {}) };
  });
}

let ledger: { root: DocHandle<RootDoc>; handle: DocHandle<LedgerDoc> } | undefined;
let published = "";
/** The last rows asked for: Habits' effect can run before the shell's sets the ledger. */
let lastRows: WidgetRow[] | undefined;

/** The ledger open now; widget rows are published for it. */
export function setWidgetLedger(root: DocHandle<RootDoc>, handle: DocHandle<LedgerDoc>) {
  ledger = { root, handle };
  if (lastRows) void publishWidget(lastRows);
}

/** Hand the widget today's rows, when they differ from what it has. */
export async function publishWidget(rows: WidgetRow[], now = new Date()): Promise<void> {
  lastRows = rows;
  const p = plugin();
  if (!p || !ledger) return;
  const snap: Omit<WidgetSnapshot, "updatedAt"> = {
    rootUrl: ledger.root.url,
    ledgerUrl: ledger.handle.url,
    ...((ledger.root.doc() as RootDoc | undefined)?.name ? { name: (ledger.root.doc() as RootDoc).name } : {}),
    epoch: DATA_EPOCH,
    date: localDate(now),
    rows,
  };
  const key = JSON.stringify(snap);
  if (key === published) return;
  published = key;
  await p.publishWidget({ snapshot: JSON.stringify({ ...snap, updatedAt: now.toISOString() }) });
}

/**
 * Apply the changes the widget made to the ledger doc since last asked (it keeps a copy of
 * each). Applying one twice, or one the repo already loaded from storage, changes nothing.
 */
export async function applyWidgetChanges(handle: DocHandle<LedgerDoc>): Promise<number> {
  const p = plugin();
  if (!p) return 0;
  const { changes } = await p.takeWidgetChanges();
  const mine = changes.filter((c) => c.docId === handle.documentId);
  for (const c of mine) handle.update((d) => A.loadIncremental(d, fromBase64(c.data)));
  return mine.length;
}
