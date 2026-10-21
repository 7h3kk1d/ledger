import "@automerge/automerge";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { LedgerDoc } from "./model/types";
import {
  exportBackup,
  forgetActiveDoc,
  importBackup,
  openHandle,
  repo,
  requestPersistentStorage,
  resetToSeed,
} from "./store/store";
import { Habits } from "./ui/habits/Habits";
import { Events } from "./ui/events/Events";
import { Calendar } from "./ui/calendar/Calendar";
import "./style.css";

const TABS = [
  { id: "habits", label: "Habits", icon: "✓" },
  { id: "calendar", label: "Calendar", icon: "▦" },
  { id: "events", label: "Events", icon: "≡" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const tabFromHash = (): Tab =>
  TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "habits";

function App() {
  const [handle, setHandle] = useState<DocHandle<LedgerDoc>>();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [persisted, setPersisted] = useState(true);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    openHandle().then(setHandle, (e) => setLoadError(String(e?.message ?? e)));
    requestPersistentStorage().then(setPersisted);
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (loadError)
    return (
      <div class="load-error">
        <h2>Couldn’t open your data</h2>
        <p>The saved document didn’t load ({loadError}). It may not have finished saving before a reload.</p>
        <p>Starting fresh leaves the old data in browser storage; you can also import a backup afterwards.</p>
        <button
          class="primary"
          onClick={() => {
            forgetActiveDoc();
            location.reload();
          }}
        >
          Start fresh
        </button>
      </div>
    );
  if (!handle) return <p class="loading">Loading…</p>;

  const go = (t: Tab) => {
    history.replaceState(null, "", `#${t}`);
    setTab(t);
  };
  const onExport = async () => {
    const bytes = await exportBackup(handle);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
    a.download = `ledger-${new Date().toISOString().slice(0, 10)}.automerge`;
    a.click();
  };
  const onImport = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await importBackup(new Uint8Array(await file.arrayBuffer()));
    location.reload();
  };
  const onReset = async () => {
    if (!confirm("Delete all current data and reset to the seed habits?")) return;
    await resetToSeed(handle);
    location.reload();
  };

  const tabs = (
    <nav class="tabs" aria-label="Views">
      {TABS.map((t) => (
        <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
          <span class="tab-icon" aria-hidden="true">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <>
      <header class="app-header">
        <div class="app-header-inner">
          <h1>Ledger</h1>
          {tabs}
          <span class="grow" />
          <details class="menu">
            <summary aria-label="Backup menu">⋯</summary>
            <div>
              <button onClick={onExport}>Export backup</button>
              <label class="button">
                Import backup
                <input type="file" hidden onChange={onImport} />
              </label>
              <button class="danger" onClick={onReset}>Reset to seed…</button>
              {!persisted && (
                <p class="menu-note">
                  Storage isn’t marked persistent. On iPhone, add Ledger to your home screen so Safari
                  doesn’t clear it.
                </p>
              )}
            </div>
          </details>
        </div>
      </header>
      <main>
        {tab === "habits" ? <Habits handle={handle} /> : tab === "calendar" ? <Calendar handle={handle} /> : <Events handle={handle} />}
      </main>
    </>
  );
}

render(<App />, document.getElementById("app")!);

// Saves are debounced; write them out before the tab is closed or a phone
// suspends the app.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void repo.flush();
});

// Offline support for the installed app. Production only: a caching worker
// in dev would serve stale modules.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}
