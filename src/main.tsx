import "@automerge/automerge";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { LedgerDoc } from "./model/types";
import { exportBackup, importBackup, openHandle, resetToSeed } from "./store/store";
import { Habits } from "./ui/habits/Habits";
import { Events } from "./ui/events/Events";
import { Calendar } from "./ui/calendar/Calendar";
import "./style.css";

function App() {
  const [handle, setHandle] = useState<DocHandle<LedgerDoc>>();
  const [tab, setTab] = useState<"habits" | "calendar" | "events">("habits");

  useEffect(() => {
    openHandle().then(setHandle);
  }, []);

  if (!handle) return <p>Loading…</p>;

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
    importBackup(new Uint8Array(await file.arrayBuffer()));
    location.reload();
  };

  const onReset = () => {
    if (!confirm("Discard all current data and reset to the seed habits?")) return;
    resetToSeed();
    location.reload();
  };

  return (
    <main>
      <header class="app-header">
        <h1>Ledger</h1>
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected={tab === "habits"} onClick={() => setTab("habits")}>Habits</button>
          <button role="tab" aria-selected={tab === "calendar"} onClick={() => setTab("calendar")}>Calendar</button>
          <button role="tab" aria-selected={tab === "events"} onClick={() => setTab("events")}>Events</button>
        </div>
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
          </div>
        </details>
      </header>
      {tab === "habits" ? <Habits handle={handle} /> : tab === "calendar" ? <Calendar handle={handle} /> : <Events handle={handle} />}
    </main>
  );
}

render(<App />, document.getElementById("app")!);
