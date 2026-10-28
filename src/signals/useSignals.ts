import { useEffect, useMemo, useState } from "preact/hooks";
import { activeHabits, signalsOf } from "../model/reduce";
import { signalIndex, type SignalIndex, type SignalInfo } from "../model/signals";
import type { LedgerDoc } from "../model/types";
import { SignalsClient, type SignalsState } from "./client";

let client: SignalsClient | undefined;

/** Start the one client for the app (no url: signals are off). */
export function startSignals(url: string | undefined): SignalsClient {
  if (!client) {
    client = new SignalsClient(url);
    void client.start();
  }
  return client;
}

export interface Signals {
  state: SignalsState;
  index: SignalIndex;
  info: (id: string) => SignalInfo | undefined;
  refresh: () => void;
}

const OFF: SignalsState = { enabled: false, catalog: [], data: new Map(), loading: false };

/** Signals for the doc's habits: asks the client for the ones they link, re-renders on news. */
export function useSignals(doc: Pick<LedgerDoc, "habits">): Signals {
  const [state, setState] = useState<SignalsState>(() => client?.snapshot ?? OFF);
  useEffect(() => client?.subscribe(setState), []);
  const ids = activeHabits(doc).flatMap(signalsOf);
  const key = [...new Set(ids)].sort().join("\n");
  useEffect(() => client?.want(key ? key.split("\n") : []), [key]);
  const index = useMemo(() => signalIndex(state.data), [state.data]);
  const byId = useMemo(() => new Map(state.catalog.map((s) => [s.id, s])), [state.catalog]);
  return { state, index, info: (id) => byId.get(id), refresh: () => void client?.refresh() };
}
