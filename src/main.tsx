import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import { DATA_EPOCH, type LedgerDoc, type RootDoc } from "./model/types";
import { previousDocs } from "./store/root";
import { rememberLedger } from "./store/config";
import {
  configuredSignalsUrl,
  exportBackup,
  importBackup,
  LoadError,
  openCurrent,
  openLedger,
  outdated,
  repo,
  requestPersistentStorage,
  resetData,
  switchToDoc,
  type Ledger,
  type SyncStatus,
  watchSync,
} from "./store/store";
import { useDoc } from "./store/useDoc";
import { applyWidgetChanges, setWidgetLedger } from "./store/widget";
import { healthSignals, startHealth } from "./store/health";
import { startSignals } from "./signals/useSignals";
import { ago } from "./model/signals";
import { Habits } from "./ui/habits/Habits";
import { Events } from "./ui/events/Events";
import { Calendar } from "./ui/calendar/Calendar";
import { Modal } from "./ui/Modal";
import { LedgersDialog, Welcome } from "./ui/Ledgers";
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
    openLedger().then((l) => {
      // after openLedger: it reads /config.json, which names the signals service
      startSignals(configuredSignalsUrl(), healthSignals());
      setLedger(l);
    }, setLoadError);
  }, []);

  // follow the root: a reset or switch on any device swaps the doc here too
  useEffect(() => {
    if (!ledger) return;
    const { root } = ledger;
    const onRoot = () => {
      const r = root.doc() as RootDoc;
      rememberLedger(root.url, r.name);
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
  const [settings, setSettings] = useState(false);
  if (kind === "no-ledger") return <Welcome />;
  return (
    <div class="load-error">
      <h2>
        {kind === "outdated"
          ? "Ledger needs an update"
          : "Couldn’t open your data"}
      </h2>
      <p>{error.message}</p>
      {kind === "unreachable" && (
        <p>This device has no copy yet, so it needs the sync server once. Check the connection and retry.</p>
      )}
      <div class="row">
        <button class="primary" onClick={() => location.reload()}>
          {kind === "outdated" ? "Reload" : "Retry"}
        </button>
        {kind !== "outdated" && <button onClick={() => setSettings(true)}>Sync &amp; ledgers…</button>}
      </div>
      {settings && <LedgersDialog onClose={() => setSettings(false)} />}
    </div>
  );
}

function Shell({ root, handle }: Ledger) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [persisted, setPersisted] = useState(true);
  const [sync, setSync] = useState<SyncStatus>({ configured: true, online: false });
  const [dialog, setDialog] = useState<"reset" | "previous" | "ledgers">();
  const name = useDoc(root).name;

  useEffect(() => {
    requestPersistentStorage().then(setPersisted);
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  useEffect(() => watchSync(handle, setSync), [handle]);
  // the iOS widget's ticks, made while the app was closed or in the background
  useEffect(() => {
    setWidgetLedger(root, handle);
    const pull = () => void applyWidgetChanges(handle);
    pull();
    const onVisible = () => document.visibilityState === "visible" && pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [root, handle]);
  // iOS: read what's new in HealthKit and send it on, on launch and on coming back
  useEffect(() => startHealth(), []);

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
          <h1>Ledger{name && <small class="ledger-name"> · {name}</small>}</h1>
          {tabs}
          <span class="grow" />
          <SyncMenu status={sync} />
          <details class="menu">
            <summary aria-label="Data menu">⋯</summary>
            <div onClick={closeMenu}>
              <button onClick={onExport}>Export backup</button>
              <label class="button">
                Import backup
                <input type="file" hidden onChange={onImport} />
              </label>
              <button onClick={() => setDialog("ledgers")}>Sync &amp; ledgers…</button>
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
      {dialog === "ledgers" && <LedgersDialog root={root} onClose={() => setDialog(undefined)} />}
    </>
  );
}

/**
 * The header's sync dot, which opens to say what it means: green when the
 * server has everything, amber while changes wait for it, grey offline.
 */
function SyncMenu({ status }: { status: SyncStatus }) {
  const { configured, online, unsynced, syncedAt } = status;
  const waiting = unsynced === undefined ? online : unsynced > 0;
  const changes = unsynced ? `${unsynced} change${unsynced === 1 ? "" : "s"}` : "Changes";
  const since = syncedAt ? `Last synced ${ago(new Date(syncedAt).toISOString())}.` : "";
  const [title, detail] = !configured
    ? ["This device only", "No sync server is set: the ledger is only here. Set one under ⋯ → Sync & ledgers."]
    : online
    ? waiting
      ? ["Syncing…", `Sending ${changes.toLowerCase()} to the server.`]
      : ["Synced", "Everything on this device is on the server."]
    : unsynced
      ? [`Offline · ${changes} waiting`, `Only on this device until the server is reachable. ${since}`]
      : ["Offline", `Nothing waiting to sync. ${since}`];
  return (
    <details class="menu sync-menu">
      <summary aria-label={`Sync: ${title}`} title={title}>
        <span class={`sync${online ? (waiting ? " waiting" : " on") : unsynced ? " waiting" : ""}`} />
        {!online && unsynced ? <small class="sync-count">{unsynced}</small> : null}
      </summary>
      <div>
        <strong>{title}</strong>
        <p class="menu-note">{detail.trim()}</p>
      </div>
    </details>
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
