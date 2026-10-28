import { useMemo, useRef, useState } from "preact/hooks";
import type { TargetedPointerEvent } from "preact";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Expectation, Habit, HabitDisplay, LedgerDoc, PeriodUnit, Tag, Threshold, TimeUnit } from "../../model/types";
import {
  activeHabits,
  allTags,
  archivedHabits,
  dayRange,
  displayOf,
  doneIndex,
  habitHue,
  HUES,
  isDone,
  manualDone,
  noteIndex,
  notesOn,
  shiftDate,
  signalsOf,
  tagsOf,
  thresholdsOf,
  withTag,
} from "../../model/reduce";
import { ago } from "../../model/signals";
import {
  countsOn,
  DAILY,
  dayState,
  expectationOf,
  PERIOD_DAYS,
  PERIOD_UNITS,
  habitStreak,
  isDue,
  progress,
  scheduleLabel,
  streakUnit,
  TIME_UNITS,
  WEEKDAYS,
} from "../../model/schedule";
import {
  addNote,
  createHabit,
  createTag,
  deleteTag,
  moveHabit,
  renameTag,
  setHabitTag,
  setHabitExpectation,
  renameHabit,
  setHabitArchived,
  setHabitDisplay,
  setHabitHue,
  setHabitSignals,
  setHabitThresholds,
  toggleHabit,
  tombstoneEvent,
} from "../../store/store";
import { useSignals, type Signals } from "../../signals/useSignals";
import { cellValue, currentValue, DayDetail, dayProgress, excusedLabel, hasObservations, LinkedDataField } from "./SignalsUI";
import { useDoc } from "../../store/useDoc";
import { useMedia, usePref, useToday } from "../hooks";
import { Check, Excused } from "./icons";
import { TodayTiles, type TapResult } from "./Today";
import { TagField, TagFilter, TagsModal } from "./Tags";

export { Check };
import { Modal } from "../Modal";

const weekday = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: "short" });
const dayNum = (d: string) => Number(d.slice(8));
const monthLabel = (d: string, short = false) =>
  new Date(`${d}T00:00`).toLocaleDateString(undefined, short ? { month: "short" } : { month: "short", year: "numeric" });
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
  const [editingTags, setEditingTags] = useState(false);
  // positions in the filtered list map to positions among all habits
  const moveTo = (habitId: string, to: number) =>
    moveHabit(handle, habitId, allActive.findIndex((x) => x.id === habits[to]?.id));
  const reorder = useReorder(gridRef, (from, to) => moveTo(habits[from]!.id, to));

  const signals = useSignals(doc);
  const idx = useMemo(() => doneIndex(doc, signals.index), [doc, signals.index]);
  const [detail, setDetail] = useState<{ habitId: string; date: string } | null>(null);
  const noted = useMemo(() => noteIndex(doc), [doc]);
  const detailHabit = detail ? doc.habits[detail.habitId] : undefined;
  // Today's tiles or the week grid; phones start on today. Per device, not in the doc.
  const [storedView, setView] = usePref<"today" | "week">("ledger.habits.view", (v) => v === "today" || v === "week");
  const view = storedView ?? (narrow ? "today" : "week");
  const [hideDone = false, setHideDone] = usePref<boolean>("ledger.habits.hideDone", (v) => typeof v === "boolean");
  // A day with data from linked signals, an excuse or a note opens its detail;
  // others toggle a check-in. The grid and the tiles both go through here.
  const tap = (h: Habit, d: string): TapResult => {
    if (
      noted.has(`${h.id} ${d}`) ||
      (signalsOf(h).length > 0 && (hasObservations(signals, h, d) || dayState(idx, h, d) === "excused"))
    ) {
      setDetail({ habitId: h.id, date: d });
      return "detail";
    }
    toggleHabit(handle, h, d);
    return "toggled";
  };
  const end = shiftDate(today, -DAYS * page);
  const days = dayRange(end, DAYS);
  const allActive = activeHabits(doc);
  // which tag's habits to show; per device, by id so a rename keeps it
  const tags = allTags(doc);
  const [storedTag = "", setTag] = usePref<string>("ledger.habits.tag", (v) => typeof v === "string");
  const tag = tags.find((t) => t.id === storedTag);
  const habits = withTag(doc, allActive, tag?.id);
  const archived = archivedHabits(doc);
  const editing = editingId ? doc.habits[editingId] : undefined;
  // habits not due today (a weekday off, a weekly target met) stay out of the count
  const dueToday = habits.filter((h) => countsOn(idx, h, today));
  const doneToday = dueToday.filter((h) => isDone(idx, h, today)).length;
  // phones drop the year while it's this year, so the toolbar fits on one line
  const short = narrow && days[0]!.slice(0, 4) === today.slice(0, 4);
  const first = monthLabel(days[0]!, short);
  // The streak column fits the longest number shown (a reported streak can be 1,443), the
  // same for every row so they stay aligned.
  const longest = Math.max(
    0,
    ...habits.map((h) => {
      const r = displayOf(h).streak;
      const v = r ? signals.state.data.get(r.signal)?.current[r.metric] : undefined;
      return v === undefined ? 0 : v.toLocaleString().length;
    }),
  );
  // phones stack the flame above the number (style.css), so only the number's width counts there
  const streakWidth = longest > 3 ? `calc(${longest}ch + 1.9em)` : undefined;
  const streakWidthNarrow = longest > 3 ? `calc(${longest}ch * .8 + .3em)` : undefined;

  const saveTags = (habitId: string, v: { ids: string[]; added: string[] }) => {
    const want = new Set([...v.ids, ...v.added.map((n) => createTag(handle, n))]);
    const had = new Set(tagsOf(doc, habitId).map((t) => t.id));
    for (const id of want) if (!had.has(id)) setHabitTag(handle, habitId, id, true);
    for (const id of had) if (!want.has(id)) setHabitTag(handle, habitId, id, false);
  };
  const tagCounts = new Map(tags.map((t) => [t.id, withTag(doc, allActive, t.id).length]));

  return (
    <section>
      {allActive.length > 0 && <TodaySummary done={doneToday} total={dueToday.length} label={tag?.name} />}

      <div class="toolbar">
        {allActive.length > 0 && (
          <div class="segmented" role="group" aria-label="View">
            <button aria-pressed={view === "today"} onClick={() => setView("today")}>Today</button>
            <button aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
          </div>
        )}
        {view === "today" ? (
          allActive.length > 0 && (
            <button class="ghost toggle" aria-pressed={hideDone} onClick={() => setHideDone(!hideDone)}>
              Hide done
            </button>
          )
        ) : (
          <>
            <button class="ghost" aria-label="Earlier" onClick={() => setPage(page + 1)}>‹</button>
            <strong>{first}{first !== monthLabel(end, short) && ` – ${monthLabel(end, short)}`}</strong>
            <button class="ghost" aria-label="Later" disabled={page === 0} onClick={() => setPage(page - 1)}>›</button>
            {page > 0 && <button onClick={() => setPage(0)}>Back to today</button>}
          </>
        )}
        <span class="grow" />
        {signals.state.error && habits.some((h) => signalsOf(h).length) && (
          <small class="signals-stale" title={signals.state.error}>
            {signals.state.lastOk
              ? `Linked data from ${ago(new Date(signals.state.lastOk).toISOString())}`
              : "Linked data unavailable"}
          </small>
        )}
        <button class="primary" onClick={() => setAdding(true)}>+ Habit</button>
      </div>

      {tags.length > 0 && allActive.length > 0 && (
        <TagFilter tags={tags} selected={tag?.id} onSelect={(id) => setTag(id ?? "")} onEdit={() => setEditingTags(true)} />
      )}

      {allActive.length === 0 ? (
        <p class="empty">No habits yet. Add one to start tracking.</p>
      ) : habits.length === 0 ? (
        <p class="empty">No habits tagged {tag?.name}.</p>
      ) : view === "today" ? (
        <TodayTiles
          habits={habits}
          idx={idx}
          signals={signals}
          noted={noted}
          today={today}
          hideDone={hideDone}
          onTap={(h) => tap(h, today)}
          onDetail={(h) => setDetail({ habitId: h.id, date: today })}
        />
      ) : (
        <div ref={gridRef} class={reorder.active ? "grid reordering" : "grid"} style={{ "--cols": DAYS, "--streak-w": streakWidth, "--streak-w-narrow": streakWidthNarrow }}>
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
            const exp = expectationOf(h);
            const disp = displayOf(h);
            const reported = disp.streak ? currentValue(signals, disp.streak) : undefined;
            const shown = (disp.metrics ?? []).flatMap((r) => currentValue(signals, r) ?? []);
            const sub = [
              exp.kind !== "daily" && scheduleLabel(exp),
              exp.kind !== "daily" && progress(idx, h, today),
              // "1,443 days", "87,365 XP": the unit says what it is; without one, the label does
              ...shown.map((m) => (m.unit ? m.text : `${m.label} ${m.text}`)),
            ].filter(Boolean);
            const linked = signalsOf(h).length > 0;
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
                      moveTo(h.id, to);
                    }}
                  >
                    <Grip />
                  </button>
                  <button class="habit-name" onClick={() => setEditingId(h.id)}>
                    <span class="dot" />
                    <span>
                      {h.name}
                      {sub.length > 0 && <small class="sched">{sub.join(" · ")}</small>}
                    </span>
                  </button>
                </span>
                {days.map((d) => {
                  const state = dayState(idx, h, d);
                  const done = state === "done";
                  const isToday = d === today;
                  const hasNote = noted.has(`${h.id} ${d}`);
                  const due = isToday && isDue(idx, h, d);
                  // how far a linked day got: an arc toward the target, and the value if asked
                  const prog = linked && state !== "unknown" ? dayProgress(signals, h, d) : undefined;
                  const partial = !done && prog?.fraction !== undefined && prog.fraction > 0 && state !== "excused";
                  const showValue = prog !== undefined && disp.cells === "value" && state !== "excused";
                  // Interval and per-period habits: a check-in's circle stretches
                  // over the days it covers and runs into the next check-in if
                  // that came in time; it fades out if the cover ran out first.
                  const spans = exp.kind === "every" || exp.kind === "per";
                  const kept = (s?: string) => s === "covered" || s === "done";
                  const next = spans && d < today ? dayState(idx, h, shiftDate(d, 1)) : undefined;
                  const prev = spans && done ? dayState(idx, h, shiftDate(d, -1)) : undefined;
                  const span = [
                    state === "covered" && "covered",
                    done && kept(prev) && "from-left",
                    kept(state) && kept(next) && "to-right",
                    state === "covered" && next !== undefined && !kept(next) && "ends",
                  ].filter(Boolean).join(" ");
                  return (
                    <span key={d} class={`cell-wrap${isToday ? " today" : ""}${span ? ` ${span}` : ""}`}>
                      <button
                        class={`cell ${state}${due ? " today" : ""}${done && !manualDone(idx, h, d) ? " linked" : ""}${hasNote ? " noted" : ""}${partial ? " partial" : ""}${showValue ? " valued" : ""}`}
                        style={partial ? { "--p": Math.min(prog!.fraction!, 1) } : undefined}
                        aria-pressed={done}
                        aria-label={`${h.name}, ${longDate(d)}${state === "covered" ? " (covered)" : state === "late" ? " (late)" : state === "excused" ? ` (${excusedLabel(signals, h)})` : state === "unknown" ? " (no data)" : ""}${prog ? `: ${prog.text}` : ""}`}
                        title={state === "excused" ? excusedLabel(signals, h) : state === "unknown" ? "No data from linked sources for this day" : prog?.text}
                        // see tap(); right-click opens the detail of any day
                        onClick={() => tap(h, d)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setDetail({ habitId: h.id, date: d });
                        }}
                      >
                        {showValue ? <span class="cell-value">{cellValue(prog!)}</span> : done && <Check />}
                        {state === "excused" && <Excused />}
                      </button>
                    </span>
                  );
                })}
                {reported ? (
                  <span class="streak on reported" title={`${reported.label}: ${reported.text}, from ${reported.source}`}>
                    <span>🔥</span> <span>{reported.value.toLocaleString()}</span>
                  </span>
                ) : (
                  <span class={streak > 0 ? "streak on" : "streak"}>
                    {streak > 0 ? <>🔥 {streak}{streakUnit(exp)}</> : "–"}
                  </span>
                )}
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
          signals={signals}
          tags={tags}
          tagIds={tagsOf(doc, editing.id).map((t) => t.id)}
          onClose={() => setEditingId(null)}
          onSave={(name, hue, expectation, linked, display, thresholds, tagged) => {
            if (name !== editing.name) renameHabit(handle, editing.id, name);
            if (hue !== habitHue(editing)) setHabitHue(handle, editing.id, hue);
            if (JSON.stringify(expectation) !== JSON.stringify(editing.expectation))
              setHabitExpectation(handle, editing.id, expectation);
            if (JSON.stringify(linked) !== JSON.stringify(signalsOf(editing)))
              setHabitSignals(handle, editing.id, linked);
            if (JSON.stringify(display) !== JSON.stringify(displayOf(editing)))
              setHabitDisplay(handle, editing.id, display);
            if (JSON.stringify(thresholds) !== JSON.stringify([...thresholdsOf(editing).values()]))
              setHabitThresholds(handle, editing.id, thresholds);
            saveTags(editing.id, tagged);
            setEditingId(null);
          }}
          onArchive={() => {
            setHabitArchived(handle, editing.id, true);
            setEditingId(null);
          }}
        />
      )}

      {detail && detailHabit && (
        <DayDetail
          habit={detailHabit}
          date={detail.date}
          dateLabel={longDate(detail.date)}
          idx={idx}
          signals={signals}
          notes={notesOn(doc, detailHabit.id, detail.date)}
          onToggle={() => toggleHabit(handle, detailHabit, detail.date)}
          onAddNote={(reason, text) => addNote(handle, detailHabit.id, detail.date, reason, text)}
          onDeleteNote={(e) => tombstoneEvent(handle, e)}
          onClose={() => setDetail(null)}
        />
      )}

      {editingTags && (
        <TagsModal
          tags={tags}
          counts={tagCounts}
          onRename={(id, name) => renameTag(handle, id, name)}
          onDelete={(id) => deleteTag(handle, id)}
          onClose={() => setEditingTags(false)}
        />
      )}

      {adding && (
        <AddHabit
          onClose={() => setAdding(false)}
          onAdd={(name, expectation) => {
            const id = createHabit(handle, name, expectation);
            // added while a tag is picked: give it that tag, so it shows up
            if (tag) setHabitTag(handle, id, tag.id, true);
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}

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

function TodaySummary({ done, total, label }: { done: number; total: number; label?: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const all = done === total;
  const share = total ? done / total : 1;
  return (
    <div class={all ? "summary all" : "summary"}>
      <svg class="ring" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} class="ring-bg" />
        <circle
          cx="32" cy="32" r={r} class="ring-fg"
          stroke-dasharray={c}
          stroke-dashoffset={c * (1 - share)}
        />
      </svg>
      <div>
        <div class="summary-count">{done} <small>/ {total}</small></div>
        <div class="summary-label">
          {total === 0 ? "Nothing due today" : all ? "All done today 🎉" : "done today"}
          {label && <span class="chip summary-tag">{label}</span>}
        </div>
      </div>
    </div>
  );
}

function EditHabit(props: {
  habit: Habit;
  signals: Signals;
  tags: Tag[];
  tagIds: string[];
  onClose: () => void;
  onSave: (
    name: string, hue: number, expectation: Expectation, signals: string[], display: HabitDisplay,
    thresholds: Threshold[], tags: { ids: string[]; added: string[] },
  ) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(props.habit.name);
  const [hue, setHue] = useState(habitHue(props.habit));
  const [expectation, setExpectation] = useState<Expectation>(expectationOf(props.habit));
  const [linked, setLinked] = useState(signalsOf(props.habit));
  const [display, setDisplay] = useState<HabitDisplay>(displayOf(props.habit));
  const [thresholds, setThresholds] = useState<Threshold[]>([...thresholdsOf(props.habit).values()]);
  const [tagged, setTagged] = useState({ ids: props.tagIds, added: [] as string[] });
  return (
    <Modal title="Edit habit" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) props.onSave(name.trim(), hue, expectation, linked, display, thresholds, tagged);
        }}
      >
        <label>Name
          <input autofocus value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <ScheduleField value={expectation} onChange={setExpectation} />
        <TagField tags={props.tags} value={tagged} onChange={setTagged} />
        <LinkedDataField
          signals={props.signals}
          value={linked}
          display={display}
          thresholds={thresholds}
          onChange={(ids, d, ts) => {
            setLinked(ids);
            setDisplay(d);
            setThresholds(ts);
          }}
        />
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

function AddHabit(props: { onClose: () => void; onAdd: (name: string, expectation: Expectation) => void }) {
  const [name, setName] = useState("");
  const [expectation, setExpectation] = useState<Expectation>(DAILY);
  return (
    <Modal title="New habit" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) props.onAdd(name.trim(), expectation);
        }}
      >
        <input autofocus placeholder="e.g. Stretch" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <ScheduleField value={expectation} onChange={setExpectation} />
        <footer>
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button class="primary" disabled={!name.trim()}>Add habit</button>
        </footer>
      </form>
    </Modal>
  );
}

/** Defaults when switching to a kind in the picker. */
const KINDS: { kind: Expectation["kind"]; label: string; initial: Expectation }[] = [
  { kind: "daily", label: "Every day", initial: DAILY },
  { kind: "weekdays", label: "On certain days", initial: { kind: "weekdays", days: [1, 3, 5] } },
  { kind: "per", label: "Times per…", initial: { kind: "per", times: 3, unit: "week" } },
  { kind: "every", label: "Every…", initial: { kind: "every", n: 2, unit: "week" } },
];

const plural = (unit: string, n: number) => (n === 1 ? unit : `${unit}s`);

function ScheduleField(props: { value: Expectation; onChange: (e: Expectation) => void }) {
  const e = props.value;
  const number = (value: number, min: number, max: number, set: (n: number) => void) => (
    <input
      type="number" inputMode="numeric" min={min} max={max} value={value} aria-label="Amount"
      onInput={(ev) => {
        const n = Math.round(Number(ev.currentTarget.value));
        if (n >= min && n <= max) set(n);
      }}
    />
  );
  return (
    <fieldset class="schedule">
      <legend>How often</legend>
      <select
        value={e.kind}
        onChange={(ev) => props.onChange(KINDS.find((k) => k.kind === ev.currentTarget.value)!.initial)}
      >
        {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      {e.kind === "weekdays" && (
        <div class="weekdays">
          {WEEKDAYS.map((label, d) => {
            const on = e.days.includes(d);
            return (
              <button
                type="button" key={d} aria-pressed={on}
                // keep at least one day
                disabled={on && e.days.length === 1}
                onClick={() => props.onChange({ kind: "weekdays", days: on ? e.days.filter((x) => x !== d) : [...e.days, d].sort() })}
              >
                {label.slice(0, 2)}
              </button>
            );
          })}
        </div>
      )}
      {e.kind === "per" && (
        <div class="amount">
          {number(e.times, 1, PERIOD_DAYS[e.unit], (times) => props.onChange({ ...e, times }))}
          <span>{plural("time", e.times)} per</span>
          <select
            value={e.unit}
            onChange={(ev) => {
              const unit = ev.currentTarget.value as PeriodUnit;
              props.onChange({ kind: "per", unit, times: Math.min(e.times, PERIOD_DAYS[unit]) });
            }}
          >
            {PERIOD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      )}
      {e.kind === "per" && <small class="hint">Calendar {e.unit}s{e.unit === "week" ? ", Sunday to Saturday" : ""}.</small>}
      {e.kind === "every" && (
        <div class="amount">
          <span>Every</span>
          {number(e.n, 1, 365, (n) => props.onChange({ ...e, n }))}
          <select value={e.unit} onChange={(ev) => props.onChange({ ...e, unit: ev.currentTarget.value as TimeUnit })}>
            {TIME_UNITS.map((u) => <option key={u} value={u}>{plural(u, e.n)}</option>)}
          </select>
        </div>
      )}
      {e.kind === "every" && <small class="hint">Counted from the last time, so doing it early or late moves the next one.</small>}
    </fieldset>
  );
}
