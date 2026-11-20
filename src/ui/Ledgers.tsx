// Where this device's ledger comes from: the sync server, which ledger to open (by id, since a
// sync server can't list its docs), and the ledgers this device has opened before. Settings are
// per device and override /config.json; changing one reloads the app.
import { useEffect, useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { RootDoc } from "../model/types";
import {
  checkUrl,
  chooseSetting,
  forgetLedger,
  isDocUrl,
  knownLedgers,
  localSettings,
  servedConfig,
  type AppConfig,
  type KnownLedger,
} from "../store/config";
import { renameLedger } from "../store/root";
import { currentConfig, startNewLedger, storedInFiles } from "../store/store";
import { useDoc } from "../store/useDoc";
import { Modal } from "./Modal";

const reload = () => location.reload();
const shortId = (url: string) => url.replace(/^automerge:/, "").slice(0, 8);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function useServed() {
  const [served, setServed] = useState<AppConfig>();
  useEffect(() => void servedConfig().then(setServed), []);
  return served;
}

/** A url setting with a Save button; saving what the host serves follows the host again. */
/** Typing urls and ids: no autocorrect ("wss" becomes "was"), no capitals, the url keyboard. */
// autoCorrect, not autocorrect: Preact would set the boolean property, and "off" is truthy
const literal = { autocapitalize: "off", autoCorrect: "off", spellcheck: false, inputMode: "url" } as const;

function UrlSetting(props: {
  name: "syncUrl" | "signalsUrl";
  label: string;
  placeholder: string;
  served: AppConfig | undefined;
}) {
  const [value, setValue] = useState(currentConfig()[props.name] ?? "");
  const [error, setError] = useState<string>();
  const overridden = localSettings()[props.name] !== undefined;
  return (
    <form
      class="setting"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = checkUrl(props.name, value);
        setError(problem);
        if (problem) return;
        chooseSetting(props.name, value.trim(), props.served);
        reload();
      }}
    >
      <label>
        {props.label}
        <span class="inline-form">
          <input {...literal} value={value} onInput={(e) => setValue(e.currentTarget.value)} placeholder={props.placeholder} />
          <button>Save</button>
        </span>
      </label>
      {error && <small class="error">{error}</small>}
      {overridden && props.served && (
        <small class="hint">This device overrides what the app’s host serves ({props.served[props.name] || "none"}).</small>
      )}
    </form>
  );
}

function SyncServer({ served, welcome }: { served: AppConfig | undefined; welcome?: boolean }) {
  const syncing = currentConfig().syncUrl;
  return (
    <>
      <p class="hint">
        {syncing
          ? `Syncing through ${syncing}.`
          : welcome
            ? "A ledger you use elsewhere is on its sync server: set it here first, then join the ledger by its id."
            : "Not syncing: this ledger is only on this device. Set a sync server (any automerge-repo sync server) to use it on other devices."}
      </p>
      <UrlSetting name="syncUrl" label="Sync server" placeholder="wss://… or /sync (empty: this device only)" served={served} />
    </>
  );
}

function JoinLedger({ served }: { served: AppConfig | undefined }) {
  const [id, setId] = useState("");
  return (
    <form
      class="setting"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isDocUrl(id)) return;
        chooseSetting("rootUrl", id.trim(), served);
        reload();
      }}
    >
      <label>
        Join a ledger
        <span class="inline-form">
          <input {...literal} value={id} onInput={(e) => setId(e.currentTarget.value)} placeholder="automerge:…" aria-label="Ledger id" />
          <button disabled={!isDocUrl(id)}>Join</button>
        </span>
      </label>
      <small class="hint">Its id is under Sync &amp; ledgers on a device that has it. Joining needs the same sync server.</small>
    </form>
  );
}

function NewLedger() {
  const [name, setName] = useState("");
  return (
    <form
      class="setting"
      onSubmit={(e) => {
        e.preventDefault();
        void startNewLedger(name);
      }}
    >
      <label>
        Start a new ledger
        <span class="inline-form">
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Name (optional)" aria-label="New ledger name" />
          <button>Start</button>
        </span>
      </label>
      <small class="hint">A separate, empty ledger. Other ledgers aren’t touched; you can open them again from the list.</small>
    </form>
  );
}

function KnownList({ current, served }: { current?: string; served: AppConfig | undefined }) {
  const [known, setKnown] = useState<KnownLedger[]>(knownLedgers);
  const others = known.filter((l) => l.url !== current);
  if (others.length === 0) return null;
  return (
    <>
      <h3>On this device</h3>
      <ul class="previous">
        {others.map((l) => (
          <li key={l.url}>
            <span>
              {l.name ?? `Ledger ${shortId(l.url)}`}
              <small> · opened {when(l.openedAt)}</small>
            </span>
            <span>
              <button
                class="ghost"
                title="Remove from this list (the ledger itself isn’t deleted)"
                aria-label={`Forget ${l.name ?? shortId(l.url)}`}
                onClick={() => {
                  forgetLedger(l.url);
                  setKnown(knownLedgers());
                }}
              >
                ✕
              </button>
              <button
                onClick={() => {
                  chooseSetting("rootUrl", l.url, served);
                  reload();
                }}
              >
                Open
              </button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function ThisLedger({ root }: { root: DocHandle<RootDoc> }) {
  const r = useDoc(root);
  const [name, setName] = useState(r?.name ?? "");
  const [copied, setCopied] = useState(false);
  return (
    <>
      <h3>This ledger</h3>
      <form
        class="setting"
        onSubmit={(e) => {
          e.preventDefault();
          renameLedger(root, name);
        }}
      >
        <label>
          Name (every device)
          <span class="inline-form">
            <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder={`Ledger ${shortId(root.url)}`} />
            <button disabled={name.trim() === (r?.name ?? "")}>Rename</button>
          </span>
        </label>
      </form>
      <div class="inline-form">
        <code class="doc-id">{root.url}</code>
        <button onClick={() => void navigator.clipboard?.writeText(root.url).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy id"}
        </button>
      </div>
      <small class="hint">To use this ledger on another device, set the same sync server there and join it with this id.</small>
    </>
  );
}

/** ⋯ → Sync & ledgers… (also reachable when a ledger can't be opened, without `root`). */
export function LedgersDialog({ root, onClose }: { root?: DocHandle<RootDoc>; onClose: () => void }) {
  const served = useServed();
  return (
    <Modal title="Sync & ledgers" onClose={onClose}>
      <div class="ledgers">
        <SyncServer served={served} />
        {root && <ThisLedger root={root} />}
        <KnownList current={root?.url} served={served} />
        <h3>Another ledger</h3>
        <JoinLedger served={served} />
        <NewLedger />
        <h3>Linked data</h3>
        <UrlSetting name="signalsUrl" label="Signals service" placeholder="https://… or /signals (empty: none)" served={served} />
        <h3>This device</h3>
        <p class="hint">
          {storedInFiles
            ? "Ledgers are kept in this app's own files, which iOS doesn't clear."
            : "Ledgers are kept in this browser's storage."}
        </p>
      </div>
    </Modal>
  );
}

/** A device that has never opened a ledger, with nothing served to say which: start or join one. */
export function Welcome() {
  const served = useServed();
  return (
    <div class="load-error ledgers">
      <h2>Welcome to Ledger</h2>
      <p>Start a ledger on this device, or join one you use elsewhere.</p>
      <NewLedger />
      <KnownList served={served} />
      <h3>Join one</h3>
      <SyncServer served={served} welcome />
      <JoinLedger served={served} />
    </div>
  );
}
