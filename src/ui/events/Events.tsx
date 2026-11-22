import { useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Attrs, Event, LedgerDoc, Occurred } from "../../model/types";
import { activeHabits, currentEvents, habitHue, hashHue, localDate, occurredDate, shiftDate, signalsOf } from "../../model/reduce";
import type { SignalInfo } from "../../model/signals";
import { createEventType, logEvent } from "../../store/store";
import { useDoc } from "../../store/useDoc";
import { useSignals } from "../../signals/useSignals";
import { usePref, useToday } from "../hooks";
import { Modal } from "../Modal";
import { isOutsidePref, outsideRows, outsideTime, shownSignals, toggleShown, type OutsideRow } from "./outside";

const PAGE_DAYS = 30;

type View = "timeline" | "table";

/** Filter values for a signal: "sig:" and its id (event type ids never start with it). */
const SIG = "sig:";

type Item =
  | { kind: "event"; e: Event; date: string; sortKey: string }
  | { kind: "outside"; r: OutsideRow; date: string; sortKey: string };

const timeOf = (o: Occurred) =>
  o.kind === "day" ? "all day" : new Date(o.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayLabel = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
/** Sort key: exact time within the day; whole-day entries sort first. */
const sortKey = (o: Occurred) => (o.kind === "day" ? `${o.date}T00:00` : new Date(o.at).toISOString());

function parseAttrs(text: string): Attrs {
  const out: Attrs = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function Events({ handle }: { handle: DocHandle<LedgerDoc> }) {
  const doc = useDoc(handle);
  const [view, setView] = useState<View>("timeline");
  const [showRaw, setShowRaw] = useState(false);
  const [filter, setFilter] = useState("");
  const [logging, setLogging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pages, setPages] = useState(1);
  const today = useToday();
  const since = shiftDate(today, -PAGE_DAYS * pages + 1);

  const types = Object.values(doc.eventTypes);
  const typeName = (id: string) => doc.eventTypes[id]?.name ?? id;
  // event types paired with a habit share its colour; so do its linked signals
  const typeHue = new Map<string, number>();
  const sigHue = new Map<string, number>();
  for (const h of Object.values(doc.habits)) for (const t of h.eventTypeIds) typeHue.set(t, habitHue(h));
  for (const h of activeHabits(doc)) for (const s of signalsOf(h)) if (!sigHue.has(s)) sigHue.set(s, habitHue(h));
  const hue = (typeId: string) => typeHue.get(typeId) ?? hashHue(typeId);
  const outsideHue = (id: string) => sigHue.get(id) ?? hashHue(id);
  const raw = showRaw && view === "table";

  // outside data: linked signals (unless hidden here) and ones chosen here; read-only, not in the raw log
  const [pref, setPref] = usePref("ledger.events.outside", isOutsidePref);
  const linked = [...new Set(activeHabits(doc).flatMap(signalsOf))];
  const shown = shownSignals(linked, pref);
  const signals = useSignals(doc, shown);
  const sigFilter = filter.startsWith(SIG) ? filter.slice(SIG.length) : undefined;
  const outside = raw || (filter && !sigFilter) ? [] : outsideRows(signals.state.data, signals.info, sigFilter ? [sigFilter] : shown);

  const matching: Item[] = [
    ...(sigFilter ? [] : raw ? Object.values(doc.events) : currentEvents(doc))
      .filter((e) => !filter || e.typeId === filter)
      .map((e): Item => ({ kind: "event", e, date: occurredDate(e.occurred), sortKey: sortKey(e.occurred) })),
    ...outside.map((r): Item => ({ kind: "outside", r, date: r.date, sortKey: r.sortKey })),
  ];
  const rows = matching.filter((x) => x.date >= since).sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  const byDay = new Map<string, Item[]>();
  for (const x of rows) byDay.set(x.date, [...(byDay.get(x.date) ?? []), x]);

  const Chip = ({ e }: { e: Event }) => (
    <span class="chip" style={{ "--h": hue(e.typeId) }}>{typeName(e.typeId)}</span>
  );
  const OutsideChip = ({ r }: { r: OutsideRow }) => (
    <span class="chip outside" style={{ "--h": outsideHue(r.signal) }} title="Linked data (read-only)">{r.label}</span>
  );
  const Provisional = ({ r }: { r: OutsideRow }) =>
    r.o.provisional ? <small class="provisional" title="Read from this phone; the server doesn’t have it yet">on this phone only</small> : null;
  const attrsText = (e: Event) => Object.entries(e.attrs).map(([k, v]) => `${k}: ${v}`).join(" · ");
  const outsideKey = (r: OutsideRow) => `${r.signal} ${r.o.id}`;

  return (
    <section>
      <div class="toolbar">
        <div class="segmented" role="tablist">
          <button role="tab" aria-selected={view === "timeline"} onClick={() => setView("timeline")}>Timeline</button>
          <button role="tab" aria-selected={view === "table"} onClick={() => setView("table")}>Table</button>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.currentTarget.value)}>
          <option value="">All types</option>
          {types.map((t) => <option value={t.id}>{t.name}</option>)}
          {shown.length > 0 && (
            <optgroup label="Linked data">
              {shown.map((id) => <option value={SIG + id}>{signals.info(id)?.label ?? id}</option>)}
            </optgroup>
          )}
        </select>
        {view === "table" && (
          <label class="check">
            <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.currentTarget.checked)} /> Raw log
          </label>
        )}
        <span class="grow" />
        {signals.state.enabled && <button onClick={() => setPicking(true)}>Linked data…</button>}
        <button class="primary" onClick={() => setLogging(true)}>+ Log event</button>
      </div>

      {rows.length === 0 && (
        <p class="empty">{matching.length ? `No events in the last ${PAGE_DAYS * pages} days.` : "No events yet."}</p>
      )}

      {view === "timeline" ? (
        <div class="timeline">
          {[...byDay].map(([day, items]) => (
            <div class="day-group" key={day}>
              <h3>{dayLabel(day)}</h3>
              {items.map((x) =>
                x.kind === "event" ? (
                  <div class="entry" key={x.e.id} style={{ "--h": hue(x.e.typeId) }}>
                    <time>{timeOf(x.e.occurred)}</time>
                    <div class="body">
                      <Chip e={x.e} />
                      {attrsText(x.e) && <span class="attrs">{attrsText(x.e)}</span>}
                    </div>
                  </div>
                ) : (
                  <div class="entry outside" key={outsideKey(x.r)} style={{ "--h": outsideHue(x.r.signal) }}>
                    <time>{outsideTime(x.r.o)}</time>
                    <div class="body">
                      <OutsideChip r={x.r} />
                      {x.r.text && <span class="attrs">{x.r.text}</span>}
                      <Provisional r={x.r} />
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Type</th><th>Attributes</th><th>Logged</th><th>Author</th><th>ID</th></tr>
            </thead>
            <tbody>
              {rows.map((x) =>
                x.kind === "event" ? (
                  <tr key={x.e.id} class={x.e.deleted ? "tomb" : ""}>
                    <td>{x.date} {timeOf(x.e.occurred)}</td>
                    <td><Chip e={x.e} /></td>
                    <td>{x.e.deleted ? "deleted" : attrsText(x.e)}</td>
                    <td>{new Date(x.e.loggedAt).toLocaleString()}</td>
                    <td>{x.e.author}</td>
                    <td><code>{x.e.id.slice(0, 8)}{x.e.amends && ` → ${x.e.amends.slice(0, 8)}`}</code></td>
                  </tr>
                ) : (
                  <tr key={outsideKey(x.r)} class="outside">
                    <td>{x.date} {outsideTime(x.r.o)}</td>
                    <td><OutsideChip r={x.r} /></td>
                    <td>{x.r.text} <Provisional r={x.r} /></td>
                    <td>—</td>
                    <td>{signals.info(x.r.signal)?.source ?? "linked data"}</td>
                    <td><code>{x.r.o.id}</code></td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {matching.length > rows.length && (
        <div class="more">
          <button onClick={() => setPages(pages + 1)}>Show older ({matching.length - rows.length} more)</button>
        </div>
      )}

      {picking && (
        <OutsidePicker
          linked={linked}
          shown={shown}
          catalog={signals.state.catalog}
          onToggle={(id, on) => setPref(toggleShown(linked, pref, id, on))}
          onClose={() => setPicking(false)}
        />
      )}

      {logging && (
        <EventForm
          types={types}
          onClose={() => setLogging(false)}
          onSubmit={(v, newType) => {
            const typeId = newType ? createEventType(handle, newType) : v.typeId;
            logEvent(handle, { ...v, typeId });
            setLogging(false);
          }}
        />
      )}
    </section>
  );
}

/** Which signals the Events view shows, on this device: linked ones, and any from the catalog. */
function OutsidePicker(props: {
  linked: string[];
  shown: string[];
  catalog: SignalInfo[];
  onToggle: (id: string, on: boolean) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const label = (id: string) => props.catalog.find((s) => s.id === id)?.label ?? id;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const others = props.catalog
    .filter((s) => !props.linked.includes(s.id))
    .filter((s) => props.shown.includes(s.id) || (words.length > 0 && words.every((w) => `${s.label} ${s.account}`.toLowerCase().includes(w))))
    .slice(0, 20);
  const Row = ({ id, sub }: { id: string; sub?: string }) => (
    <label class="check">
      <input type="checkbox" checked={props.shown.includes(id)} onChange={(e) => props.onToggle(id, e.currentTarget.checked)} />
      {label(id)} {sub && <small class="muted">{sub}</small>}
    </label>
  );
  return (
    <Modal title="Linked data in Events" onClose={props.onClose}>
      <p class="hint">Shown read-only beside your events, on this device. Data linked to habits is on unless you turn it off here.</p>
      {props.linked.length > 0 && <h3>Linked to habits</h3>}
      {props.linked.map((id) => <Row key={id} id={id} />)}
      <h3>Other data</h3>
      <input type="search" placeholder="Find data, e.g. steps" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      {others.map((s) => <Row key={s.id} id={s.id} sub={s.account} />)}
      <footer>
        <button class="primary" onClick={props.onClose}>Done</button>
      </footer>
    </Modal>
  );
}

const NEW = "__new__";

function EventForm(props: {
  types: { id: string; name: string }[];
  onSubmit: (v: { typeId: string; occurred: Occurred; attrs: Attrs }, newType?: string) => void;
  onClose: () => void;
}) {
  const [typeId, setTypeId] = useState(props.types[0]?.id ?? NEW);
  const [newType, setNewType] = useState("");
  const [date, setDate] = useState(localDate(new Date()));
  const [wholeDay, setWholeDay] = useState(false);
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
  const [attrs, setAttrs] = useState("");
  const creating = typeId === NEW;
  const valid = !creating || newType.trim() !== "";

  return (
    <Modal title="Log event" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const occurred: Occurred = wholeDay
            ? { kind: "day", date }
            : { kind: "instant", at: new Date(`${date}T${time}`).toISOString() };
          props.onSubmit({ typeId, occurred, attrs: parseAttrs(attrs) }, creating ? newType.trim() : undefined);
        }}
      >
        <label>Type
          <select autofocus value={typeId} onChange={(e) => setTypeId(e.currentTarget.value)}>
            {props.types.map((t) => <option value={t.id}>{t.name}</option>)}
            <option value={NEW}>+ New type…</option>
          </select>
        </label>
        {creating && (
          <input autofocus placeholder="New type name" value={newType} onInput={(e) => setNewType(e.currentTarget.value)} />
        )}
        <div class="row">
          <label class="grow">Date
            <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
          </label>
          {!wholeDay && (
            <label>Time
              <input type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} />
            </label>
          )}
        </div>
        <label class="check">
          <input type="checkbox" checked={wholeDay} onChange={(e) => setWholeDay(e.currentTarget.checked)} /> Whole day (no specific time)
        </label>
        <label>Attributes
          <textarea rows={3} placeholder="key=value, one per line" value={attrs} onInput={(e) => setAttrs(e.currentTarget.value)} />
        </label>
        <footer>
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button class="primary" disabled={!valid}>Log event</button>
        </footer>
      </form>
    </Modal>
  );
}
