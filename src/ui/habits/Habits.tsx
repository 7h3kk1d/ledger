import { useMemo, useRef, useState } from "preact/hooks";
import type { TargetedPointerEvent } from "preact";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Habit, LedgerDoc } from "../../model/types";
import {
  activeHabits,
  archivedHabits,
  dayRange,
  doneIndex,
  habitHue,
  habitStreak,
  HUES,
  isDone,
  shiftDate,
} from "../../model/reduce";
import {
  createDailyHabit,
  moveHabit,
  renameHabit,
  setHabitArchived,
  setHabitHue,
  toggleHabit,
} from "../../store/store";
import { useDoc } from "../../store/useDoc";
import { useMedia, useToday } from "../hooks";
import { Modal } from "../Modal";

const weekday = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: "short" });
const dayNum = (d: string) => Number(d.slice(8));
const monthLabel = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const longDate = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

export function Habits({ handle }: { handle: DocHandle<LedgerDoc> }) {
  const doc = useDoc(handle);
  const today = useToday();
  const narrow = useMedia("(max-width: 520px)");
  const DAYS = narrow ? 5 : 7;
  // pages back from today, so the view follows the date across midnight
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const reorder = useReorder(gridRef, (from, to) => moveHabit(handle, habits[from]!.id, to));

  const idx = useMemo(() => doneIndex(doc), [doc]);
  const end = shiftDate(today, -DAYS * page);
  const days = dayRange(end, DAYS);
  const habits = activeHabits(doc);
  const archived = archivedHabits(doc);
  const editing = editingId ? doc.habits[editingId] : undefined;
  const doneToday = habits.filter((h) => isDone(idx, h, today)).length;
  const first = monthLabel(days[0]!);

  return (
    <section>
      {habits.length > 0 && <TodaySummary done={doneToday} total={habits.length} />}

      <div class="toolbar">
        <button class="ghost" aria-label="Earlier" onClick={() => setPage(page + 1)}>‹</button>
        <strong>{first}{first !== monthLabel(end) && ` – ${monthLabel(end)}`}</strong>
        <button class="ghost" aria-label="Later" disabled={page === 0} onClick={() => setPage(page - 1)}>›</button>
        {page > 0 && <button onClick={() => setPage(0)}>Today</button>}
        <span class="grow" />
        <button class="primary" onClick={() => setAdding(true)}>+ Habit</button>
      </div>

      {habits.length === 0 ? (
        <p class="empty">No habits yet. Add one to start tracking.</p>
      ) : (
        <div ref={gridRef} class={reorder.active ? "grid reordering" : "grid"} style={{ "--cols": DAYS }}>
          <div class="grid-head">
            <span />
            {days.map((d) => (
              <span key={d} class={d === today ? "day today" : "day"}>
                <small>{weekday(d)}</small>
                {dayNum(d)}
              </span>
            ))}
            <span class="streak-h">Streak</span>
          </div>
          {habits.map((h, i) => {
            const streak = habitStreak(idx, h, today);
            return (
              <div
                class={reorder.isDragged(i) ? "grid-row dragging" : "grid-row"}
                key={h.id}
                style={{ "--h": habitHue(h), transform: reorder.offset(i) }}
              >
                <span class="habit-cell">
                  <button
                    class="grip"
                    aria-label={`Reorder ${h.name} (arrow keys)`}
                    onPointerDown={(e) => reorder.start(e, i)}
                    onKeyDown={(e) => {
                      const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                      if (to < 0 || to >= habits.length) return;
                      e.preventDefault();
                      moveHabit(handle, h.id, to);
                    }}
                  >
                    <Grip />
                  </button>
                  <button class="habit-name" onClick={() => setEditingId(h.id)}>
                    <span class="dot" />
                    <span>{h.name}</span>
                  </button>
                </span>
                {days.map((d) => {
                  const done = isDone(idx, h, d);
                  const isToday = d === today;
                  return (
                    <span key={d} class={isToday ? "cell-wrap today" : "cell-wrap"}>
                      <button
                        class={`cell${done ? " done" : ""}${isToday ? " today" : ""}`}
                        aria-pressed={done}
                        aria-label={`${h.name}, ${longDate(d)}`}
                        onClick={() => toggleHabit(handle, h, d)}
                      >
                        {done && <Check />}
                      </button>
                    </span>
                  );
                })}
                <span class={streak > 0 ? "streak on" : "streak"}>
                  {streak > 0 ? <>🔥 {streak}</> : "–"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <details class="archived">
          <summary>Archived ({archived.length})</summary>
          <ul>
            {archived.map((h) => (
              <li key={h.id}>
                <span>{h.name}</span>
                <button class="ghost" onClick={() => setHabitArchived(handle, h.id, false)}>Restore</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {editing && (
        <EditHabit
          habit={editing}
          onClose={() => setEditingId(null)}
          onSave={(name, hue) => {
            if (name !== editing.name) renameHabit(handle, editing.id, name);
            if (hue !== habitHue(editing)) setHabitHue(handle, editing.id, hue);
            setEditingId(null);
          }}
          onArchive={() => {
            setHabitArchived(handle, editing.id, true);
            setEditingId(null);
          }}
        />
      )}

      {adding && (
        <AddHabit
          onClose={() => setAdding(false)}
          onAdd={(name) => {
            createDailyHabit(handle, name);
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}

export const Check = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

const Grip = () => (
  <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" fill="currentColor">
    {[3, 8, 13].flatMap((y) => [2.5, 7.5].map((x) => <circle key={`${x},${y}`} cx={x} cy={y} r="1.4" />))}
  </svg>
);

type Drag = { from: number; to: number; dy: number; height: number };

/**
 * Drag-to-reorder for the grid rows: press a row's grip and move it. The
 * dragged row follows the pointer and the rows it passes slide out of the
 * way; nothing changes in the doc until it's dropped.
 */
function useReorder(gridRef: { current: HTMLElement | null }, onDrop: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);

  const start = (e: TargetedPointerEvent<HTMLElement>, from: number) => {
    if (e.button !== 0 || !gridRef.current) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const rows = [...gridRef.current.querySelectorAll<HTMLElement>(":scope > .grid-row")];
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    const height = rows[from]!.getBoundingClientRect().height;
    const startY = e.clientY;
    let current: Drag = { from, to: from, dy: 0, height };
    setDrag(current);

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const centre = mids[from]! + dy;
      const to = mids.filter((m, k) => k !== from && m < centre).length;
      current = { from, to, dy, height };
      setDrag(current);
    };
    const end = (ev: PointerEvent) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      if (ev.type === "pointerup" && current.to !== current.from) onDrop(current.from, current.to);
      setDrag(null);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  };

  const offset = (i: number) => {
    if (!drag) return undefined;
    const { from, to, dy, height } = drag;
    if (i === from) return `translateY(${dy}px)`;
    if (from < to && i > from && i <= to) return `translateY(${-height}px)`;
    if (to < from && i >= to && i < from) return `translateY(${height}px)`;
    return undefined;
  };

  return { active: drag !== null, start, offset, isDragged: (i: number) => drag?.from === i };
}

function TodaySummary({ done, total }: { done: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const all = done === total;
  return (
    <div class={all ? "summary all" : "summary"}>
      <svg class="ring" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} class="ring-bg" />
        <circle
          cx="32" cy="32" r={r} class="ring-fg"
          stroke-dasharray={c}
          stroke-dashoffset={c * (1 - done / total)}
        />
      </svg>
      <div>
        <div class="summary-count">{done} <small>/ {total}</small></div>
        <div class="summary-label">{all ? "All done today 🎉" : "done today"}</div>
      </div>
    </div>
  );
}

function EditHabit(props: {
  habit: Habit;
  onClose: () => void;
  onSave: (name: string, hue: number) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(props.habit.name);
  const [hue, setHue] = useState(habitHue(props.habit));
  return (
    <Modal title="Edit habit" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) props.onSave(name.trim(), hue);
        }}
      >
        <label>Name
          <input autofocus value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <fieldset class="swatches">
          <legend>Colour</legend>
          {HUES.map((h) => (
            <button
              type="button"
              key={h}
              class="swatch"
              style={{ "--h": h }}
              aria-label={`Hue ${h}`}
              aria-pressed={h === hue}
              onClick={() => setHue(h)}
            />
          ))}
        </fieldset>
        <footer>
          <button type="button" class="danger" onClick={props.onArchive}>Archive</button>
          <span class="grow" />
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button class="primary" disabled={!name.trim()}>Save</button>
        </footer>
      </form>
    </Modal>
  );
}

function AddHabit(props: { onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Modal title="New daily habit" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) props.onAdd(name.trim());
        }}
      >
        <input autofocus placeholder="e.g. Stretch" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <footer>
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button class="primary" disabled={!name.trim()}>Add habit</button>
        </footer>
      </form>
    </Modal>
  );
}
