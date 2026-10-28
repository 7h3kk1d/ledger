# Ledger

Personal observability dashboard. This repo currently holds **Track A**: an append-only event log plus a daily habit tracker. It is a web app; each device keeps a full Automerge copy in IndexedDB and syncs through an automerge-repo sync server.

## How it fits together

- **Sync server:** the stock [automerge-repo-sync-server](https://github.com/automerge/automerge-repo-sync-server). It is a peer that is always online and stores every doc a client asks for by id. It has no knowledge of Ledger. The app reaches it at `/sync` on its own host.
- **Root doc:** a tiny doc `{ current, epoch, history }` that names the ledger doc every device uses. The app finds it through `/config.json` (`{ "rootUrl": "automerge:…" }`). A new device only has to open the URL.
- **Reset** (⋯ → Reset data…): makes a new, empty ledger doc and points the root at it. You can keep the habit list. Every open device follows the switch live. The old doc is never deleted: ⋯ → Previous data switches back to it.
- **`DATA_EPOCH`** (`src/model/types.ts`): bump it for a breaking schema change. Each client that loads finds the root at an older epoch and rolls over to a fresh doc (keeping habit names) instead of migrating. A client older than the root's epoch asks to reload.
- **Linked data (signals):** a habit can also count data from other services, e.g. workouts from
  Apple Health or Duolingo practice. Ledger reads them from the signals service named by
  `signalsUrl` in `/config.json` (the collectors repo's `spec/signals.md`; `/signals` on the
  cluster). Ledger never knows which service a signal is: a signal is a stream of observations
  (when, and whether it *satisfies* or *excuses*), and the habit's own schedule decides what that
  means, the same as for check-ins. Only the links are in the doc (`Habit.signals`,
  `Habit.display`); observations are cached in IndexedDB. Without `signalsUrl` habits use check-ins
  only.
- **Notes on a day:** a note (reason, e.g. travel, and optional text) explains a day without
  changing it, e.g. why a streak freeze was used. It's an ordinary event (type `ledger:note`, the
  habit in its attrs). A day with a note gets a dot; tapping it, or a day with linked data, opens the
  day's detail (right-click opens any day's).
- Offline works: edits are kept locally and merge when the server is reachable again. The dot in the header shows whether the server is connected.

## Dev

```sh
nix develop
pnpm install
pnpm dev:sync                                  # sync server on :3030, data in .sync-data/
pnpm bootstrap ws://localhost:3030 --write     # once: root + first doc, writes public/config.json
pnpm dev                                       # http://localhost:5173 (proxies /sync to :3030, /signals to :8765)
SIGNALS_TARGET=https://ledger.home.abanduk.com pnpm dev   # or use the cluster's signals
pnpm test
pnpm build
```

`localhost:5173` and `127.0.0.1:5173` are separate origins with separate IndexedDB, which makes them a handy pair of "devices" for testing sync.

**Seed habits:** the optional, gitignored `src/seed.local.ts` (exporting `SEED_HABITS: string[]`) is read only by `pnpm bootstrap`, which puts the habits into the first doc. After that, resets carry the habit list forward. The seed never reaches a build.

## Deploying (homelab)

It runs on the homelab k3s cluster (`homelab/cluster/apps/ledger/`, see its README):

| Task | How |
| --- | --- |
| First setup | Apply the manifests, run `scripts/ledger-build`, then `pnpm bootstrap wss://ledger.home.abanduk.com/sync` and put the printed `rootUrl` in the `ledger-config` ConfigMap |
| Ship a new version | Push to `main`, then run `homelab/scripts/ledger-build` (`ledger-build rollback <sha>` to go back) |
| Reset data | ⋯ → Reset data… |
| Breaking schema change | Bump `DATA_EPOCH`, push, build |
| Start over completely | Wipe the sync PVC, re-bootstrap, update `rootUrl` |

## Design notes

- Edits and deletes are appended (`amends` / tombstone), never destructive; `currentEvents` reduces the log.
- Whole-day vs exact occurrence times; day boundary is local midnight to midnight.
- A signal observation counts on its local day; an interval on the day it ends. Manual check-ins and
  signals add together. An *excused* day (a linked signal's "skipped, and that's fine", like a
  streak freeze) is left out of daily and weekday habits' streaks like a rest day.
- No migrations: clients are only the owner's devices, so a breaking change bumps `DATA_EPOCH` instead.
- **Backup:** the sync server's volume, plus Export in the UI. Import makes the imported doc current everywhere.
- **Install it on your phone.** Safari clears site storage after 7 days without a visit unless the
  app is on the home screen (Share → Add to Home Screen). The app also requests persistent storage.
  The service worker that makes it work offline is registered in production builds only, so dev
  never serves cached modules.
- The sync server has no auth; it's only reachable on the LAN and tailnet.

## Out of scope for now

Native clients, accounts/tagging/permissions, configurable day boundaries, per-person habit linking, expectations based on metrics (e.g. every 5,000 miles).
