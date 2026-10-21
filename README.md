# Ledger

Personal observability dashboard. This repo currently holds **Track A**: an append-only event log plus a daily habit tracker (web only, local-only Automerge doc in IndexedDB).

## Dev

```sh
nix develop
pnpm install
pnpm dev     # http://localhost:5173
pnpm test
pnpm build
```

## Design notes

- Edits and deletes are appended (`amends` / tombstone), never destructive; `currentEvents` reduces the log.
- Whole-day vs exact occurrence times; day boundary is local midnight to midnight.
- No schema versioning: clients are only the owner's devices, so breaking changes are fixed one-off.
- **Backup:** use Export in the UI; the doc lives only in browser IndexedDB in v1.

## Out of scope for v1

Sync/relays, native clients, accounts/tagging/permissions, non-daily expectations, configurable day boundaries, per-person habit linking, Grafana/Track B.
