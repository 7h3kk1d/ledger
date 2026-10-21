import { useState } from "preact/hooks";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Habit, LedgerDoc } from "../../model/types";
import { habitEventsOn, localDate } from "../../model/reduce";
import { createDailyHabit, logEvent, tombstoneEvent } from "../../store/store";
import { useDoc } from "../../store/useDoc";

export function Habits({ handle }: { handle: DocHandle<LedgerDoc> }) {
  const doc = useDoc(handle);
  const [date, setDate] = useState(() => localDate(new Date()));
  const [name, setName] = useState("");
  const today = localDate(new Date());

  const toggle = (habit: Habit) => {
    const existing = habitEventsOn(doc, habit, date);
    if (existing.length) {
      // undo: tombstone that day's events
      for (const e of existing) tombstoneEvent(handle, e);
      return;
    }
    const typeId = habit.eventTypeIds[0]!;
    logEvent(handle, {
      typeId,
      // backfilled days are whole-day events; today gets an exact time
      occurred:
        date === today
          ? { kind: "instant", at: new Date().toISOString() }
          : { kind: "day", date },
    });
  };

  const habits = Object.values(doc.habits);

  return (
    <section>
      <label>
        Day <input type="date" value={date} max={today} onInput={(e) => setDate(e.currentTarget.value)} />
      </label>
      <ul>
        {habits.map((h) => {
          const done = habitEventsOn(doc, h, date).length > 0;
          return (
            <li key={h.id} class={done ? "done" : ""}>
              <input type="checkbox" checked={done} onChange={() => toggle(h)} />
              <span class="name">{h.name}</span>
            </li>
          );
        })}
      </ul>
      {habits.length === 0 && <p>No habits yet.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          createDailyHabit(handle, name.trim());
          setName("");
        }}
      >
        <input placeholder="New daily habit" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <button>Add</button>
      </form>
    </section>
  );
}
