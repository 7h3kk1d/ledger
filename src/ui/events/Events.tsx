import { useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Attrs, Event, LedgerDoc, Occurred } from "../../model/types";
import { currentEvents, localDate, occurredDate } from "../../model/reduce";
import { amendEvent, createEventType, logEvent, tombstoneEvent } from "../../store/store";
import { useDoc } from "../../store/useDoc";

const fmt = (o: Occurred) => (o.kind === "day" ? o.date : new Date(o.at).toLocaleString());

function parseAttrs(text: string): Attrs {
  const out: Attrs = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const showAttrs = (a: Attrs) => Object.entries(a).map(([k, v]) => `${k}=${v}`).join("\n");

export function Events({ handle }: { handle: DocHandle<LedgerDoc> }) {
  const doc = useDoc(handle);
  const [showRaw, setShowRaw] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [typeName, setTypeName] = useState("");

  const types = Object.values(doc.eventTypes);
  const typeName_ = (id: string) => doc.eventTypes[id]?.name ?? id;
  const rows = showRaw
    ? Object.values(doc.events)
    : currentEvents(doc);
  rows.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));

  return (
    <section>
      <label>
        <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.currentTarget.checked)} /> Show raw log
      </label>

      <EventForm
        key={editing?.id ?? "new"}
        types={types}
        initial={editing}
        onCancel={() => setEditing(null)}
        onSubmit={(v) => {
          if (editing) amendEvent(handle, editing.id, v);
          else logEvent(handle, v);
          setEditing(null);
        }}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!typeName.trim()) return;
          createEventType(handle, typeName.trim());
          setTypeName("");
        }}
      >
        <input placeholder="New event type" value={typeName} onInput={(e) => setTypeName(e.currentTarget.value)} />
        <button>Add type</button>
      </form>

      <ul>
        {rows.map((e) => (
          <li key={e.id}>
            <span class="name">
              {e.deleted ? "🗑 " : ""}
              {typeName_(e.typeId)} — {fmt(e.occurred)}
              {Object.keys(e.attrs).length > 0 && ` (${showAttrs(e.attrs).replace(/\n/g, ", ")})`}
              <br />
              <code>
                {e.id.slice(0, 8)} logged {e.loggedAt} by {e.author}
                {e.amends && ` ${e.deleted ? "retracts" : "amends"} ${e.amends.slice(0, 8)}`}
              </code>
            </span>
            {!e.deleted && !showRaw && (
              <>
                <button onClick={() => setEditing(e)}>Edit</button>
                <button onClick={() => tombstoneEvent(handle, e)}>Delete</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p>No events.</p>}
    </section>
  );
}

function EventForm(props: {
  types: { id: string; name: string }[];
  initial: Event | null;
  onSubmit: (v: { typeId: string; occurred: Occurred; attrs: Attrs }) => void;
  onCancel: () => void;
}) {
  const i = props.initial;
  const [typeId, setTypeId] = useState(i?.typeId ?? props.types[0]?.id ?? "");
  const [date, setDate] = useState(i ? occurredDate(i.occurred) : localDate(new Date()));
  const [wholeDay, setWholeDay] = useState(i ? i.occurred.kind === "day" : false);
  const [time, setTime] = useState(
    i?.occurred.kind === "instant" ? new Date(i.occurred.at).toTimeString().slice(0, 5) : new Date().toTimeString().slice(0, 5),
  );
  const [attrs, setAttrs] = useState(i ? showAttrs(i.attrs) : "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!typeId) return;
        const occurred: Occurred = wholeDay
          ? { kind: "day", date }
          : { kind: "instant", at: new Date(`${date}T${time}`).toISOString() };
        props.onSubmit({ typeId, occurred, attrs: parseAttrs(attrs) });
      }}
    >
      <select value={typeId} onChange={(e) => setTypeId(e.currentTarget.value)}>
        {props.types.map((t) => <option value={t.id}>{t.name}</option>)}
      </select>
      <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
      {!wholeDay && <input type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} />}
      <label><input type="checkbox" checked={wholeDay} onChange={(e) => setWholeDay(e.currentTarget.checked)} /> whole day</label>
      <textarea placeholder="key=value per line" value={attrs} onInput={(e) => setAttrs(e.currentTarget.value)} />
      <button>{i ? "Save edit" : "Log event"}</button>
      {i && <button type="button" onClick={props.onCancel}>Cancel</button>}
    </form>
  );
}
