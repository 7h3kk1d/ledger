import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import { DATA_EPOCH, type LedgerDoc, type RootDoc } from "./model/types";
import { previousDocs } from "./store/root";
import {
  exportBackup,
  importBackup,
  LoadError,
  onSyncStatus,
  openCurrent,
  openLedger,
  outdated,
  repo,
  requestPersistentStorage,
  resetData,
  switchToDoc,
  type Ledger,
} from "./store/store";
import { useDoc } from "./store/useDoc";
import { Habits } from "./ui/habits/Habits";
import { Events } from "./ui/events/Events";
import { Calendar } from "./ui/calendar/Calendar";
import { Modal } from "./ui/Modal";
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
  const [ledger, setLedger] = useState<Ledger>();
  const [loadError, setLoadError] = useState<LoadError | Error>();

  useEffect(() => {
    openLedger().then(setLedger, setLoadError);
  }, []);

  // follow the root: a reset or switch on any device swaps the doc here too
  useEffect(() => {
    if (!ledger) return;
    const { root } = ledger;
    const onRoot = () => {
      const r = root.doc() as RootDoc;
      if (r.epoch > DATA_EPOCH) setLoadError(outdated());
      else if (r.current !== ledger.handle.url)
        openCurrent(root).then((handle) => setLedger({ root, handle }), setLoadError);
    };
    root.on("change", onRoot);
    return () => void root.off("change", onRoot);
  }, [ledger]);

  if (loadError) return <LoadErrorScreen error={loadError} />;
  if (!ledger) return <p class="loading">Loading…</p>;
  return <Shell {...ledger} />;
}

function LoadErrorScreen({ error }: { error: Error }) {
  const kind = error instanceof LoadError ? error.kind : undefined;
  return (
    <div class="load-error">
      <h2>
        {kind === "outdated"
          ? "Ledger needs an update"
          : kind === "no-config"
            ? "Ledger isn’t set up"
            : "Couldn’t open your data"}
      </h2>
      <p>{error.message}</p>
      {kind === "no-config" && (
        <p>
          Run <code>pnpm bootstrap &lt;sync url&gt;</code> to create the root doc, then put its url
          in <code>config.json</code> (see the README).
        </p>
      )}
      {kind === "unreachable" && (
        <p>This device has no copy yet, so it needs the sync server once. Check the connection and retry.</p>
      )}
      <button class="primary" onClick={() => location.reload()}>
        {kind === "outdated" ? "Reload" : "Retry"}
      </button>
    </div>
  );
}

function Shell({ root, handle }: Ledger) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [persisted, setPersisted] = useState(true);
  const [online, setOnline] = useState(false);
  const [dialog, setDialog] = useState<"reset" | "previous">();

  useEffect(() => {
    requestPersistentStorage().then(setPersisted);
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    const offSync = onSyncStatus(setOnline);
    return () => {
      window.removeEventListener("hashchange", onHash);
      offSync();
    };
  }, []);

  const go = (t: Tab) => {
    history.replaceState(null, "", `#${t}`);
    setTab(t);
  };
  // buttons only: closing on the import label would hide its file input mid-click
  const closeMenu = (e: Event) => {
    if ((e.target as HTMLElement).closest("button"))
      (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
  };
  const onExport = async () => {
    const bytes = await exportBackup(handle);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
    a.download = `ledger-${new Date().toISOString().slice(0, 10)}.automerge`;
    a.click();
  };
  const onImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    importBackup(root, new Uint8Array(await file.arrayBuffer()));
    input.value = "";
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
          <span
            class={online ? "sync on" : "sync"}
            title={online ? "Synced with the server" : "Offline: changes sync when the server is reachable"}
            aria-label={online ? "Online" : "Offline"}
          />
          <details class="menu">
            <summary aria-label="Data menu">⋯</summary>
            <div onClick={closeMenu}>
              <button onClick={onExport}>Export backup</button>
              <label class="button">
                Import backup
                <input type="file" hidden onChange={onImport} />
              </label>
              <button onClick={() => setDialog("previous")}>Previous data…</button>
              <button class="danger" onClick={() => setDialog("reset")}>Reset data…</button>
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
      <main key={handle.url}>
        {tab === "habits" ? <Habits handle={handle} /> : tab === "calendar" ? <Calendar handle={handle} /> : <Events handle={handle} />}
      </main>
      {dialog === "reset" && (
        <ResetDialog
          onClose={() => setDialog(undefined)}
          onReset={(keep) => {
            resetData(root, handle, keep);
            setDialog(undefined);
          }}
        />
      )}
      {dialog === "previous" && <PreviousDialog root={root} onClose={() => setDialog(undefined)} />}
    </>
  );
}

function ResetDialog(props: { onClose: () => void; onReset: (keepHabits: boolean) => void }) {
  const [keep, setKeep] = useState(true);
  return (
    <Modal title="Reset data" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onReset(keep);
        }}
      >
        <p>
          Every device switches to a new, empty log. The current data isn’t deleted; you can switch
          back to it from Previous data.
        </p>
        <label class="check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.currentTarget.checked)} />
          Keep the habit list
        </label>
        <footer>
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button class="primary danger">Reset</button>
        </footer>
      </form>
    </Modal>
  );
}

const REASONS = { reset: "reset", epoch: "upgrade", import: "import", switch: "switched away" };

function PreviousDialog({ root, onClose }: { root: DocHandle<RootDoc>; onClose: () => void }) {
  const r = useDoc(root);
  const docs = previousDocs(r);
  return (
    <Modal title="Previous data" onClose={onClose}>
      {docs.length === 0 ? (
        <p class="empty">Nothing yet. Resets and imports keep the data they replace here.</p>
      ) : (
        <ul class="previous">
          {docs.map((e) => (
            <li key={e.url}>
              <span>
                Until {new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                <small> · {REASONS[e.reason]}{e.epoch !== DATA_EPOCH && ` · v${e.epoch}`}</small>
              </span>
              <button
                class="ghost"
                disabled={e.epoch !== DATA_EPOCH}
                title={e.epoch !== DATA_EPOCH ? "From an older data version" : undefined}
                onClick={() => {
                  switchToDoc(root, e.url);
                  onClose();
                }}
              >
                Switch
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
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
