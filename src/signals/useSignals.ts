import { useEffect, useMemo, useState } from "preact/hooks";
import { activeHabits, recipesOf, signalsOf } from "../model/reduce";
import { signalIndex, type SignalIndex, type SignalInfo } from "../model/signals";
import type { LedgerDoc } from "../model/types";
import { SignalsClient, type SignalsState } from "./client";
import { SignalHub, type SignalProvider, type WantedSignal } from "./provider";

let hub: SignalHub | undefined;

/**
 * Start the app's one hub: the signals service (no url: off) and, where the
 * device can answer signals from its own data, that device provider.
 */
export function startSignals(url: string | undefined, device?: SignalProvider): SignalHub {
  if (!hub) {
    const remote = new SignalsClient(url);
    hub = new SignalHub(remote, device);
    void remote.start();
  }
  return hub;
}

export interface Signals {
  state: SignalsState;
  index: SignalIndex;
  info: (id: string) => SignalInfo | undefined;
  refresh: () => void;
}

const OFF: SignalsState = { enabled: false, catalog: [], data: new Map(), loading: false };

/** The signals the doc's habits link, each with a habit's recipe for it if one has one. */
export function wantedSignals(doc: Pick<LedgerDoc, "habits">, extra: readonly string[] = []): WantedSignal[] {
  const out = new Map<string, WantedSignal>();
  for (const h of activeHabits(doc)) {
    const recipes = recipesOf(h);
    for (const id of signalsOf(h)) {
      const recipe = recipes.get(id);
      if (!out.get(id)?.recipe) out.set(id, recipe ? { id, recipe } : { id });
    }
  }
  for (const id of extra) if (!out.has(id)) out.set(id, { id });
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Signals for the doc's habits (plus `extra`, e.g. ones the Events view shows):
 * asks the hub for them, re-renders on news.
 */
export function useSignals(doc: Pick<LedgerDoc, "habits">, extra: readonly string[] = []): Signals {
  const [state, setState] = useState<SignalsState>(() => hub?.snapshot ?? OFF);
  useEffect(() => hub?.subscribe(setState), []);
  const key = JSON.stringify(wantedSignals(doc, extra));
  useEffect(() => hub?.want(JSON.parse(key) as WantedSignal[]), [key]);
  const index = useMemo(() => signalIndex(state.data), [state.data]);
  const byId = useMemo(() => new Map(state.catalog.map((s) => [s.id, s])), [state.catalog]);
  return { state, index, info: (id) => byId.get(id), refresh: () => void hub?.refresh() };
}
