// Sync & ledgers → Health, in the iOS app: connect HealthKit, see what was read, and say where the
// batches go (a receiver speaking spec/healthkit-batch.md, e.g. collectors' healthkit).
import { useEffect, useState } from "preact/hooks";
import { ago } from "../model/signals";
import { checkPushUrl, nativeHealth, syncHealth, type HealthStatus } from "../store/health";

const literal = { autocapitalize: "off", autoCorrect: "off", spellcheck: false } as const;

function readLine(s: HealthStatus): string {
  if (s.lastReadError) return `Couldn’t read HealthKit: ${s.lastReadError}`;
  if (!s.lastRead) return "Not read yet.";
  const n = s.lastReadCount ?? 0;
  return `Read ${ago(s.lastRead)}: ${n === 0 ? "nothing new" : `${n.toLocaleString()} new record${n === 1 ? "" : "s"}`}.`;
}

function pushLine(s: HealthStatus): string {
  if (!s.pushUrl) return "Not sending anywhere: set a receiver to keep this data off the phone too.";
  if (s.lastPushError) return `Couldn’t send (${s.lastPushError}); ${s.waiting} batch${s.waiting === 1 ? "" : "es"} waiting, tried again on the next read.`;
  if (s.waiting > 0) return `${s.waiting} batch${s.waiting === 1 ? "" : "es"} waiting to send.`;
  return s.lastPushAt ? `Everything sent (last ${ago(s.lastPushAt)}).` : "Everything sent.";
}

export function HealthSettings() {
  const plugin = nativeHealth();
  const [status, setStatus] = useState<HealthStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    void plugin?.status().then((s) => {
      setStatus(s);
      setUrl(s.pushUrl ?? "");
    });
  }, []);
  if (!plugin || !status) return null;

  const run = async (f: () => Promise<HealthStatus | undefined>) => {
    setBusy(true);
    setError(undefined);
    try {
      const s = await f();
      if (s) setStatus(s);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status.available) {
    return (
      <>
        <h3>Health</h3>
        <p class="hint">HealthKit isn’t available on this device.</p>
      </>
    );
  }

  return (
    <>
      <h3>Health</h3>
      {!status.asked ? (
        <>
          <p class="hint">
            Read workouts (with their titles), sleep, activity rings and measurements from Apple Health. Choose “All
            Recorded Data” when asked, so the history comes too.
          </p>
          <button class="primary" disabled={busy} onClick={() => void run(() => plugin.authorize())}>
            Connect Apple Health
          </button>
        </>
      ) : (
        <>
          <div class="inline-form">
            <p class="hint" aria-live="polite">{busy ? "Reading…" : readLine(status)}</p>
            <button disabled={busy} onClick={() => void run(() => syncHealth(true))}>Read now</button>
          </div>
          <form
            class="setting"
            onSubmit={(e) => {
              e.preventDefault();
              const problem = checkPushUrl(url);
              if (problem) return setError(problem);
              void run(async () => {
                await plugin.setPush({ url: url.trim(), ...(token ? { token: token.trim() } : {}) });
                setToken("");
                return syncHealth(true);
              });
            }}
          >
            <label>
              Send to
              <input {...literal} inputMode="url" value={url} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://…/ingest (empty: keep on this phone)" aria-label="Health receiver" />
            </label>
            <label>
              Token
              <span class="inline-form">
                <input {...literal} type="password" value={token} onInput={(e) => setToken(e.currentTarget.value)}
                  placeholder={status.hasToken ? "saved (type to replace)" : "the receiver’s token for this phone"} aria-label="Health receiver token" />
                <button disabled={busy}>Save</button>
              </span>
            </label>
            <small class="hint">{pushLine(status)}</small>
          </form>
        </>
      )}
      {error && <small class="error">{error}</small>}
    </>
  );
}
