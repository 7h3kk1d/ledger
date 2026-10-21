import { useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Attrs, Event, LedgerDoc, Occurred } from "../../model/types";
import { currentEvents, localDate, occurredDate } from "../../model/reduce";
import { createEventType, logEvent } from "../../store/store";
import { useDoc } from "../../store/useDoc";
import { Modal } from "../Modal";

type View = "timeline" | "table";

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
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function Events({ handle }: { handle: DocHandle<LedgerDoc> }) {
  const doc = useDoc(handle);
  const [view, setView] = useState<View>("timeline");
  const [showRaw, setShowRaw] = useState(false);
  const [filter, setFilter] = useState("");
  const [logging, setLogging] = useState(false);

  const types = Object.values(doc.eventTypes);
  const typeName = (id: string) => doc.eventTypes[id]?.name ?? id;
  const raw = showRaw && view === "table";
  const rows = (raw ? Object.values(doc.events) : currentEvents(doc))
    .filter((e) => !filter || e.typeId === filter)
    .sort((a, b) => sortKey(b.occurred).localeCompare(sortKey(a.occurred)));

  const byDay = new Map<string, Event[]>();
  for (const e of rows) {
    const d = occurredDate(e.occurred);
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }

  const Chip = ({ e }: { e: Event }) => (
    <span class="chip" style={{ "--h": hue(e.typeId) }}>{typeName(e.typeId)}</span>
  );
  const attrsText = (e: Event) => Object.entries(e.attrs).map(([k, v]) => `${k}: ${v}`).join(" · ");

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
        </select>
        {view === "table" && (
          <label class="check">
            <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.currentTarget.checked)} /> Raw log
          </label>
        )}
        <span class="grow" />
        <button class="primary" onClick={() => setLogging(true)}>+ Log event</button>
      </div>

      {rows.length === 0 && <p class="empty">No events yet.</p>}

      {view === "timeline" ? (
        <div class="timeline">
          {[...byDay].map(([day, es]) => (
            <div class="day-group" key={day}>
              <h3>{dayLabel(day)}</h3>
              {es.map((e) => (
                <div class="entry" key={e.id} style={{ "--h": hue(e.typeId) }}>
                  <time>{timeOf(e.occurred)}</time>
                  <div class="body">
                    <Chip e={e} />
                    {attrsText(e) && <span class="attrs">{attrsText(e)}</span>}
                  </div>
                </div>
              ))}
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
              {rows.map((e) => (
                <tr key={e.id} class={e.deleted ? "tomb" : ""}>
                  <td>{occurredDate(e.occurred)} {timeOf(e.occurred)}</td>
                  <td><Chip e={e} /></td>
                  <td>{e.deleted ? "deleted" : attrsText(e)}</td>
                  <td>{new Date(e.loggedAt).toLocaleString()}</td>
                  <td>{e.author}</td>
                  <td><code>{e.id.slice(0, 8)}{e.amends && ` → ${e.amends.slice(0, 8)}`}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <select value={typeId} onChange={(e) => setTypeId(e.currentTarget.value)}>
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
