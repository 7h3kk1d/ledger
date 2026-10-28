// The root doc names the ledger doc every device should use. Resets and epoch
// rollovers make a new ledger doc and repoint the root; old docs are never
// deleted, so any of them can be switched back to. No browser dependencies.
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { activeHabits, displayOf, habitHue, signalsOf, thresholdsOf } from "../model/reduce";
import { DATA_EPOCH, type LedgerDoc, type RootDoc, type RootReason } from "../model/types";
import type { Expectation, HabitDisplay, Threshold } from "../model/types";
import { createHabit, setHabitDisplay, setHabitHue, setHabitSignals, setHabitThresholds } from "./mutations";

export interface SeedHabit {
  name: string;
  hue?: number;
  expectation?: Expectation;
  /** Linked signals and what to show from them. */
  signals?: string[];
  display?: HabitDisplay;
  thresholds?: Threshold[];
}

const emptyLedger = (): LedgerDoc => ({ eventTypes: {}, habits: {}, events: {} });

/** A new ledger doc with the given habits, in order. */
export function createLedger(repo: Repo, habits: SeedHabit[]): DocHandle<LedgerDoc> {
  const h = repo.create<LedgerDoc>(emptyLedger());
  for (const s of habits) {
    const id = createHabit(h, s.name, s.expectation);
    if (s.hue !== undefined) setHabitHue(h, id, s.hue);
    if (s.signals?.length) setHabitSignals(h, id, s.signals);
    if (s.display) setHabitDisplay(h, id, s.display);
    if (s.thresholds?.length) setHabitThresholds(h, id, s.thresholds);
  }
  return h;
}

/**
 * The active habits of a ledger, to carry into a new one. `namesOnly` for an
 * epoch rollover, where the old doc's other fields may not mean the same thing.
 */
export function habitSeed(doc: LedgerDoc, namesOnly = false): SeedHabit[] {
  return activeHabits(doc).map((h) =>
    namesOnly
      ? { name: h.name }
      : {
          name: h.name,
          hue: habitHue(h),
          expectation: h.expectation,
          signals: signalsOf(h),
          display: displayOf(h),
          thresholds: [...thresholdsOf(h).values()],
        },
  );
}

export function createRoot(repo: Repo, ledger: DocHandle<LedgerDoc>): DocHandle<RootDoc> {
  return repo.create<RootDoc>({ current: ledger.url, epoch: DATA_EPOCH, history: [] });
}

/** Make `url` current, recording the previous doc in the history. */
export function switchTo(root: DocHandle<RootDoc>, url: AutomergeUrl, reason: RootReason): void {
  root.change((d) => {
    if (d.current === url) return;
    d.history.push({ url: d.current, epoch: d.epoch, at: new Date().toISOString(), reason });
    d.current = url;
    // never lower it: an older build resetting shouldn't make newer ones roll over again
    d.epoch = Math.max(d.epoch, DATA_EPOCH);
  });
}

/** Start a new ledger doc seeded with `habits` and make it current. */
export function rollover(
  repo: Repo,
  root: DocHandle<RootDoc>,
  habits: SeedHabit[],
  reason: RootReason,
): DocHandle<LedgerDoc> {
  const next = createLedger(repo, habits);
  switchTo(root, next.url, reason);
  return next;
}

/** Previous docs, newest first, one entry per doc, not including the current one. */
export function previousDocs(root: RootDoc) {
  const seen = new Set([root.current]);
  return [...root.history].reverse().filter((e) => !seen.has(e.url) && seen.add(e.url));
}
