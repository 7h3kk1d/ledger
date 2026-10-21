import "@automerge/automerge";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { LedgerDoc } from "./model/types";
import { exportBackup, importBackup, openHandle } from "./store/store";
import { Habits } from "./ui/habits/Habits";
import { Events } from "./ui/events/Events";
import "./style.css";

function App() {
  const [handle, setHandle] = useState<DocHandle<LedgerDoc>>();
  const [tab, setTab] = useState<"habits" | "events">("habits");

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

  return (
    <main>
      <nav>
        <button disabled={tab === "habits"} onClick={() => setTab("habits")}>Habits</button>
        <button disabled={tab === "events"} onClick={() => setTab("events")}>Events</button>
        <span class="spacer" />
        <button onClick={onExport}>Export</button>
        <label class="button">
          Import
          <input type="file" hidden onChange={onImport} />
        </label>
      </nav>
      {tab === "habits" ? <Habits handle={handle} /> : <Events handle={handle} />}
    </main>
  );
}

render(<App />, document.getElementById("app")!);
