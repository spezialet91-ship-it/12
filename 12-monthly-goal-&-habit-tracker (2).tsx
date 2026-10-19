import React, { useEffect, useMemo, useState, useCallback } from "react";

// ============================================================
// "12" — a monthly goal & habit tracker. One month = one chapter.
// Not a streak app: missing a day is never failure.
// Visual language: Apple-style — clear, calm, confident, precise.
// ============================================================

// ---------------------- DATA MODEL ----------------------

type GoalType = "daily" | "weekly" | "number" | "once";

interface Area {
  id: string;
  name: string;
  emoji: string;
  active: boolean; // switched on/off for the current month
}

interface Goal {
  id: string;
  monthKey: string; // "2026-10"
  areaId: string;
  name: string;
  type: GoalType;
  target: number; // daily:1, weekly: sessions/week, number: monthly target, once:1
  unit?: string; // for number goals ("€", "pages"...)
  reminder?: string | null; // "HH:MM" — off by default
  copiedFrom?: string | null;
}

interface Entry {
  id: string;
  goalId: string;
  date: string; // "2026-10-14"
  value: number; // daily/weekly/once: 1, number: logged amount
  note?: string;
}

interface JournalEntry {
  date: string; // "2026-10-14"
  text: string;
  photo?: string | null; // dataURL
}

interface MonthReview {
  whatWorked: string;
  whatDidnt: string;
  whatToChange: string;
  summary?: string; // summary written from the user's logged data & notes
  savedAt?: string;
}

interface MonthRecord {
  key: string; // "2026-10"
  year: number;
  month: number; // 1-12
  review?: MonthReview;
}

interface DB {
  areas: Area[];
  goals: Goal[];
  entries: Entry[];
  journal: JournalEntry[];
  months: MonthRecord[];
  theme: "light" | "dark";
}

const DEFAULT_AREAS: [string, string][] = [
  ["Health & Fitness", "💪"], ["Mind & Meditation", "🧘"], ["Study & Education", "📚"],
  ["Career & Work", "💼"], ["Side Hustles", "🚀"], ["Money & Savings", "💰"],
  ["Reading & Learning", "📖"], ["Relationships & Social", "🤝"], ["Creativity & Hobbies", "🎨"],
  ["Home & Admin", "🏠"], ["Travel & Experiences", "✈️"], ["Reflection & Gratitude", "🙏"],
];

const uid = () => Math.random().toString(36).slice(2, 10);
const pad = (n: number) => String(n).padStart(2, "0");
const monthKeyOf = (y: number, m: number) => `${y}-${pad(m)}`;
const dateStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function nowParts() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

// ---------------------- STORAGE ----------------------
// v1 persistence: localStorage-backed store (JSON-ready).
// In a standalone PWA build this layer can be swapped to IndexedDB
// without touching any UI code — every read/write goes through these helpers.

const STORE_KEY = "app-12-db-v1";

function seedDB(): DB {
  const { y, m } = nowParts();
  return {
    areas: DEFAULT_AREAS.map(([name, emoji], i) => ({ id: `a${i}`, name, emoji, active: true })),
    goals: [],
    entries: [],
    journal: [],
    months: [{ key: monthKeyOf(y, m), year: y, month: m }],
    theme: "light",
  };
}

function loadDB(): DB {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch {}
  return seedDB();
}

function useDB() {
  const [db, setDb] = useState<DB>(loadDB);
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch {}
  }, [db]);
  const update = useCallback((fn: (d: DB) => void) => {
    setDb(prev => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next; });
  }, []);
  return { db, update };
}

// ---------------------- PROGRESS MATH ----------------------

// How many days of the month are "in play" (up to today; full month once past).
function effectiveDays(key: string): number {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5));
  const total = daysInMonth(y, m);
  const { y: ny, m: nm, d: nd } = nowParts();
  if (ny > y || (ny === y && nm > m)) return total;
  if (ny === y && nm === m) return Math.min(nd, total);
  return 1; // future month: nothing counted yet
}

function goalStats(goal: Goal, entries: Entry[], key: string): { pct: number; done: number; targetTotal: number } {
  const mine = entries.filter(e => e.goalId === goal.id);
  const days = effectiveDays(key);
  if (goal.type === "daily") {
    const done = mine.length;
    return { pct: Math.min(100, Math.round((done / Math.max(1, days)) * 100)), done, targetTotal: days };
  }
  if (goal.type === "weekly") {
    const weeks = Math.max(1, Math.ceil(days / 7));
    const done = mine.length; // each tick = one session
    return { pct: Math.min(100, Math.round((done / Math.max(1, goal.target * weeks)) * 100)), done, targetTotal: goal.target * weeks };
  }
  if (goal.type === "number") {
    const done = mine.reduce((s, e) => s + (e.value || 0), 0);
    return { pct: Math.min(100, Math.round((done / Math.max(1, goal.target)) * 100)), done, targetTotal: goal.target };
  }
  // once
  const done = mine.some(e => e.value > 0) ? 1 : 0;
  return { pct: done * 100, done, targetTotal: 1 };
}

function overallPct(goals: Goal[], entries: Entry[], key: string): number {
  if (!goals.length) return 0;
  const sum = goals.reduce((s, g) => s + goalStats(g, entries, key).pct, 0);
  return Math.round(sum / goals.length);
}

// percentage of one goal restricted to a set of days (for week buckets)
function sliceStats(goal: Goal, entries: Entry[], days: number[]): number {
  const mine = entries.filter(e => e.goalId === goal.id && days.includes(Number(e.date.slice(-2))));
  if (goal.type === "daily") return Math.min(100, Math.round((mine.length / Math.max(1, days.length)) * 100));
  if (goal.type === "weekly") return Math.min(100, Math.round((mine.length / Math.max(1, goal.target)) * 100));
  if (goal.type === "number") {
    const done = mine.reduce((s, e) => s + (e.value || 0), 0);
    const share = goal.target / 4.3; // rough weekly share of monthly target
    return Math.min(100, Math.round((done / Math.max(0.01, share)) * 100));
  }
  return mine.some(e => e.value > 0) ? 100 : 0;
}

function weekBuckets(goals: Goal[], entries: Entry[], key: string) {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5));
  const total = daysInMonth(y, m);
  const inPlayTotal = effectiveDays(key);
  const weeks: { label: string; pct: number }[] = [];
  for (let w = 0; w < total; w += 7) {
    const len = Math.min(7, total - w);
    const days = Array.from({ length: len }, (_, i) => w + i + 1).filter(d => d <= inPlayTotal);
    if (!days.length || !goals.length) { weeks.push({ label: `W${weeks.length + 1}`, pct: 0 }); continue; }
    const sum = goals.reduce((s, g) => s + sliceStats(g, entries, days), 0);
    weeks.push({ label: `W${weeks.length + 1}`, pct: Math.round(sum / goals.length) });
  }
  return weeks;
}

// ---------------------- LOCAL SUMMARY (AI hook) ----------------------
// v1: honest, data-derived summary generated locally.
// This is the single function to replace with an LLM API call in the
// standalone PWA build — it only ever reads what the user logged.

function generateSummary(goals: Goal[], entries: Entry[], journal: JournalEntry[], key: string, review: MonthReview): string {
  const m = Number(key.slice(5));
  const lines: string[] = [];
  if (!goals.length) return `You set no goals this month. That's okay — next month is a fresh chapter.`;
  const scored = goals.map(g => ({ g, s: goalStats(g, entries, key) })).sort((a, b) => b.s.pct - a.s.pct);
  const top = scored[0];
  const bottom = scored[scored.length - 1];
  const ov = overallPct(goals, entries, key);
  lines.push(`This month closed at ${ov}% across ${goals.length} goal${goals.length > 1 ? "s" : ""}.`);
  if (top.s.pct > 0) lines.push(`Your strongest goal was “${top.g.name}” at ${top.s.pct}% — that clearly mattered to you.`);
  if (bottom.g.id !== top.g.id && bottom.s.pct < 100) {
    lines.push(bottom.s.pct === 0
      ? `“${bottom.g.name}” didn't get going this month. No guilt — maybe it wasn't the right season for it, or it needs to be smaller.`
      : `“${bottom.g.name}” sat at ${bottom.s.pct}%. A smaller version might stick better next month.`);
  }
  // pattern: shared skipped days across daily goals
  const missDays: Record<number, number> = {};
  const daysCount = effectiveDays(key);
  for (const { g } of scored) {
    if (g.type === "daily") {
      for (let d = 1; d <= daysCount; d++) {
        const has = entries.some(e => e.goalId === g.id && e.date === `${key}-${pad(d)}`);
        if (!has) missDays[d] = (missDays[d] || 0) + 1;
      }
    }
  }
  const busiest = Object.entries(missDays).sort((a, b) => b[1] - a[1])[0];
  if (busiest && busiest[1] > 1) {
    lines.push(`Pattern: day ${busiest[0]} was the one you most often skipped across goals — worth noticing what was going on then.`);
  }
  if (review.whatWorked) lines.push(`You noted that what worked was: ${trim(review.whatWorked)}.`);
  if (review.whatToChange) lines.push(`And for next month: ${trim(review.whatToChange)}.`);
  lines.push(`Every percentage here is just a shape of the month, not a grade. ${MONTHS[m % 12]} is a blank page.`);
  return lines.join(" ");
}
const trim = (s: string) => (s.length > 120 ? s.slice(0, 117) + "…" : s);

// ============================================================
// DESIGN SYSTEM — Apple-style tokens
// 8px spacing grid · system type stack · one accent · semantic colour
// ============================================================

const FONT = `-apple-system,'SF Pro Text','SF Pro Display',Inter,system-ui,'Segoe UI',sans-serif`;
const SERIF = `'New York','Iowan Old Style','Palatino Linotype','Bradley Hand',Georgia,serif`;

const THEME = {
  light: {
    bg: "#F2F1ED",          // soft warm off-white
    surface: "#FFFFFF",     // elevated card
    inset: "#ECEBE6",       // recessed field / segmented track
    ink: "#1D1C1A",
    sub: "#7B776F",
    faint: "rgba(29,28,26,0.08)",   // hairlines
    faint2: "rgba(29,28,26,0.04)",
    accent: "#C05621",
    onAccent: "#FFFFFF",
    success: "#2E8B57",
    warning: "#B7791F",
    shadow: "0 1px 2px rgba(28,25,20,0.05), 0 8px 24px rgba(28,25,20,0.06)",
    blur: "rgba(242,241,237,0.78)",
  },
  dark: {
    bg: "#111110",          // true near-black
    surface: "#1D1D1B",     // elevated dark grey
    inset: "#2A2A27",
    ink: "#F2F1EC",
    sub: "#98948A",
    faint: "rgba(242,241,236,0.10)",
    faint2: "rgba(242,241,236,0.05)",
    accent: "#EE8A4E",
    onAccent: "#231408",
    success: "#4CC38A",
    warning: "#E0B04B",
    shadow: "0 1px 2px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.45)",
    blur: "rgba(17,17,16,0.72)",
  },
};
type C = typeof THEME.light;

// Semantic meaning only: strong = success, middling = warning, low = quiet ink.
function pctColor(p: number): "success" | "warning" | "ink" {
  return p >= 80 ? "success" : p >= 50 ? "warning" : "ink";
}

function useTheme(db: DB, update: (fn: (d: DB) => void) => void) {
  const dark = db.theme === "dark";
  useEffect(() => {
    document.documentElement.style.background = dark ? THEME.dark.bg : THEME.light.bg;
  }, [dark]);
  return { dark, c: dark ? THEME.dark : THEME.light, toggle: () => update(d => { d.theme = dark ? "light" : "dark"; }) };
}

// ---------------------- ICONS (SF Symbols style, 1.8 stroke) ----------------------

function Icon({ d, size = 20, sw = 1.8, color = "currentColor", style }: { d: string; size?: number; sw?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const P = {
  chevronL: "M15 18l-6-6 6-6",
  chevronR: "M9 6l6 6-6 6",
  copy: "M9 9h9a1.5 1.5 0 011.5 1.5V20a1.5 1.5 0 01-1.5 1.5H9A1.5 1.5 0 017.5 20v-9.5A1.5 1.5 0 019 9zM5.5 15H4.5A1.5 1.5 0 013 13.5V4A1.5 1.5 0 014.5 2.5H14A1.5 1.5 0 0115.5 4v1",
  plus: "M12 5v14M5 12h14",
  sun: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z",
  moon: "M20 13.5A8 8 0 1110.5 4a6.5 6.5 0 009.5 9.5z",
  x: "M6 6l12 12M18 6L6 18",
  camera: "M4 8.5A1.5 1.5 0 015.5 7h2l1.2-2h6.6L16.5 7h2A1.5 1.5 0 0120 8.5v8A1.5 1.5 0 0118.5 18h-13A1.5 1.5 0 014 16.5v-8zM12 9.5a3 3 0 100 6 3 3 0 000-6z",
  check: "M5 12.5l4.5 4.5L19 7",
  trash: "M4 7h16M9.5 7V5a1 1 0 011-1h3a1 1 0 011 1v2M6.5 7l.8 12a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4L17.5 7M10 11v6M14 11v6",
  pencil: "M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z",
};

// ---------------------- SHARED UI PRIMITIVES ----------------------

const RADIUS = { card: 18, field: 12, cell: 8, pill: 999 };

function Pct({ v, c, size = "inherit" }: { v: number; c: C; size?: "inherit" | "lg" }) {
  const k = pctColor(v);
  const color = k === "ink" ? c.sub : k === "success" ? c.success : c.warning;
  return (
    <span className={"font-semibold tnum" + (size === "lg" ? " text-3xl" : "")} style={{ color, letterSpacing: "-0.02em" }}>
      {v}<span style={{ opacity: 0.7, fontSize: "0.75em" }}>%</span>
    </span>
  );
}

function Bar({ v, c }: { v: number; c: C }) {
  const k = pctColor(v);
  return (
    <div className="h-2 rounded-full w-full overflow-hidden" style={{ background: c.faint }}>
      <div className="h-2 rounded-full cell-motion" style={{ width: `${v}%`, background: k === "success" ? c.success : k === "warning" ? c.warning : c.sub, transition: "width .3s cubic-bezier(.2,.8,.2,1), background .2s" }} />
    </div>
  );
}

// Month progress ring — the considered visual for "where am I".
function Ring({ v, c, size = 56 }: { v: number; c: C; size?: number }) {
  const sw = 5, r = (size - sw) / 2, cir = 2 * Math.PI * r;
  const k = pctColor(v);
  const col = k === "success" ? c.success : k === "warning" ? c.warning : c.sub;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c.faint} strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={cir} strokeDashoffset={cir * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset .5s cubic-bezier(.2,.8,.2,1), stroke .2s" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold tnum" style={{ fontSize: size / 4, letterSpacing: "-0.03em" }}>{v}</span>
      </div>
    </div>
  );
}

// Segmented control (iOS style)
function Segmented<T extends string>({ value, options, onChange, c }: { value: T; options: [T, string][]; onChange: (v: T) => void; c: C }) {
  return (
    <div className="flex gap-1 p-1 rounded-[11px]" style={{ background: c.faint2 }}>
      {options.map(([v, label]) => {
        const on = value === v;
        return (
          <button key={v} onClick={() => onChange(v)}
            className="flex-1 py-1.5 rounded-[9px] text-[13px] font-medium seg-motion min-h-[36px]"
            style={on
              ? { background: c.surface, color: c.ink, boxShadow: "0 1px 3px rgba(28,25,20,.12)" }
              : { color: c.sub }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Card({ c, children, style }: { c: C; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="px-4 py-4" style={{ borderRadius: 18, background: c.surface, boxShadow: c.shadow, ...style }}>
      {children}
    </section>
  );
}

function SectionLabel({ children, c }: { children: React.ReactNode; c: C }) {
  return <h2 className="text-[12px] font-semibold uppercase mb-3" style={{ color: c.sub, letterSpacing: "0.06em" }}>{children}</h2>;
}

// ---------------------- GLOBAL MOTION CSS ----------------------

const GlobalStyle = () => (
  <style>{`
    .tnum { font-variant-numeric: tabular-nums; }
    .cell-motion { transition: transform .18s cubic-bezier(.34,1.56,.64,1), background .15s, color .15s, border-color .15s, box-shadow .15s; }
    .cell-motion:active { transform: scale(0.82); }
    .seg-motion { transition: all .2s cubic-bezier(.2,.8,.2,1); }
    .btn-motion { transition: transform .15s cubic-bezier(.34,1.56,.64,1), opacity .15s, background .15s; }
    .btn-motion:active { transform: scale(0.96); opacity: .85; }
    .fade-in { animation: fadeUp .28s cubic-bezier(.2,.8,.2,1) both; }
    .sheet-in { animation: sheetUp .32s cubic-bezier(.2,.8,.2,1) both; }
    .tick-pop { animation: tickPop .25s cubic-bezier(.34,1.56,.64,1); }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(8px);} to { opacity: 1; transform: none;} }
    @keyframes sheetUp { from { opacity: 0; transform: translateY(24px);} to { opacity: 1; transform: none;} }
    @keyframes tickPop { 0% { transform: scale(0.7);} 60% { transform: scale(1.12);} 100% { transform: scale(1);} }
    @media (prefers-reduced-motion: reduce) {
      .cell-motion, .seg-motion, .btn-motion, .fade-in, .sheet-in, .tick-pop { animation: none !important; transition: none !important; }
    }
  `}</style>
);

// ---------------------- MAIN APP ----------------------

type View = "grid" | "day" | "review";

export default function App() {
  const { db, update } = useDB();
  const t = useTheme(db, update);
  const c = t.c;
  const { y, m, d: todayD } = nowParts();
  const [view, setView] = useState<View>("grid");
  const [curKey, setCurKey] = useState(monthKeyOf(y, m));
  const [showAddGoal, setShowAddGoal] = useState(false);

  const goals = db.goals.filter(g => g.monthKey === curKey);
  const yy = Number(curKey.slice(0, 4)), mm = Number(curKey.slice(5));
  const ndays = daysInMonth(yy, mm);

  // month record bootstrap
  useEffect(() => {
    update(d => { if (!d.months.find(x => x.key === curKey)) d.months.push({ key: curKey, year: yy, month: mm }); });
  }, [curKey]);

  // shift month
  const shiftMonth = (dir: number) => {
    let ny = yy, nm = mm + dir;
    if (nm === 0) { nm = 12; ny--; }
    if (nm === 13) { nm = 1; ny++; }
    setCurKey(monthKeyOf(ny, nm));
  };

  const toggleCell = (goal: Goal, day: number) => {
    const ds = `${curKey}-${pad(day)}`;
    update(d => {
      const i = d.entries.findIndex(e => e.goalId === goal.id && e.date === ds);
      if (i >= 0) d.entries.splice(i, 1);
      else d.entries.push({ id: uid(), goalId: goal.id, date: ds, value: 1 });
    });
  };

  const logNumber = (goal: Goal, day: number, val: number) => {
    const ds = `${curKey}-${pad(day)}`;
    update(d => {
      const i = d.entries.findIndex(e => e.goalId === goal.id && e.date === ds);
      if (i >= 0) { if (val <= 0) d.entries.splice(i, 1); else d.entries[i].value = val; }
      else if (val > 0) d.entries.push({ id: uid(), goalId: goal.id, date: ds, value: val });
    });
  };

  const addGoal = (g: Omit<Goal, "id" | "monthKey">) => {
    update(d => { d.goals.push({ ...g, id: uid(), monthKey: curKey }); });
  };
  const deleteGoal = (id: string) => update(d => {
    d.goals = d.goals.filter(g => g.id !== id);
    d.entries = d.entries.filter(e => e.goalId !== id);
  });
  const copyGoalsToNextMonth = () => {
    let ny = yy, nm = mm + 1;
    if (nm === 13) { nm = 1; ny++; }
    const nk = monthKeyOf(ny, nm);
    update(d => {
      const existing = new Set(d.goals.filter(g => g.monthKey === nk).map(g => g.name));
      for (const g of goals) if (!existing.has(g.name)) d.goals.push({ ...g, id: uid(), monthKey: nk, copiedFrom: g.id });
      if (!d.months.find(x => x.key === nk)) d.months.push({ key: nk, year: ny, month: nm });
    });
  };

  const ov = overallPct(goals, db.entries, curKey);
  const isCurrentMonth = curKey === monthKeyOf(y, m);
  const isLastDay = isCurrentMonth && todayD === ndays;

  return (
    <div style={{ background: c.bg, color: c.ink, fontFamily: FONT }} className="min-h-screen max-w-xl mx-auto pb-24">
      <GlobalStyle />

      {/* Header — translucent blur bar; data stays the hero */}
      <header className="sticky top-0 z-30 px-4 pt-3 pb-3"
        style={{ background: c.blur, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: `0.5px solid ${c.faint}` }}>
        <div className="flex items-center justify-between" style={{ minHeight: 48 }}>
          {/* month navigation */}
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} aria-label="Previous month"
              className="w-11 h-11 rounded-full flex items-center justify-center btn-motion" style={{ color: c.accent }}>
              <Icon d={P.chevronL} />
            </button>
            <div>
              <h1 className="text-[22px] font-bold leading-tight" style={{ letterSpacing: "-0.02em" }}>
                {MONTHS[mm - 1]} <span className="font-medium" style={{ color: c.sub }}>{yy}</span>
              </h1>
              <div className="text-[12px]" style={{ color: c.sub }}>
                {goals.length} goal{goals.length === 1 ? "" : "s"} · chapter {mm}/12
              </div>
            </div>
            <button onClick={() => shiftMonth(1)} aria-label="Next month"
              className="w-11 h-11 rounded-full flex items-center justify-center btn-motion" style={{ color: c.accent }}>
              <Icon d={P.chevronR} />
            </button>
          </div>
          {/* copy goals forward + month ring + theme toggle */}
          <div className="flex items-center gap-2">
            <button onClick={copyGoalsToNextMonth} title="Copy goals to next month"
              className="w-11 h-11 rounded-full flex items-center justify-center btn-motion"
              style={{ background: c.surface, boxShadow: c.shadow, color: c.accent }}>
              <Icon d={P.copy} size={17} />
            </button>
            <Ring v={ov} c={c} size={52} />
            <button onClick={t.toggle} aria-label="Toggle dark mode"
              className="w-11 h-11 rounded-full flex items-center justify-center btn-motion"
              style={{ background: c.surface, boxShadow: c.shadow, color: c.sub }}>
              <Icon d={t.dark ? P.sun : P.moon} size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="px-4 pt-4 fade-in" key={view}>
        {/* tabs */}
        <nav className="mb-4">
          <Segmented value={view} c={c} onChange={setView}
            options={[["grid", "Grid"], ["day", "Today"], ["review", "Review"]]} />
        </nav>

        {view === "grid" && (
          <MonthGrid
            goals={goals} entries={db.entries} areas={db.areas} curKey={curKey} ndays={ndays} todayD={todayD} isCurrent={isCurrentMonth}
            c={c} onToggle={toggleCell} onLogNumber={logNumber} onDelete={deleteGoal}
            onAdd={() => setShowAddGoal(true)}
          />
        )}

        {view === "day" && (
          <DayView
            db={db} update={update} c={c}
            dateKey={isCurrentMonth ? `${curKey}-${pad(todayD)}` : `${curKey}-01`}
            goals={goals} entries={db.entries}
            onToggle={(g) => toggleCell(g, isCurrentMonth ? todayD : 1)}
          />
        )}

        {view === "review" && (
          <MonthReviewView db={db} update={update} c={c} curKey={curKey} goals={goals} onCopy={copyGoalsToNextMonth} />
        )}
      </div>

      {/* add goal modal */}
      {showAddGoal && <AddGoalModal areas={db.areas} c={c} onClose={() => setShowAddGoal(false)} onSave={addGoal} />}

      {(isLastDay && !db.months.find(x => x.key === curKey)?.review?.savedAt) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 sheet-in">
          <button onClick={() => setView("review")} className="px-6 min-h-[52px] rounded-full text-[15px] font-semibold btn-motion flex items-center gap-2"
            style={{ background: c.accent, color: c.onAccent, boxShadow: c.shadow }}>
            <Icon d={P.pencil} size={17} sw={2} />
            Last day of the month — write your review
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------- MONTH GRID ----------------------

function MonthGrid({ goals, entries, areas, curKey, ndays, todayD, isCurrent, c, onToggle, onLogNumber, onDelete, onAdd }: {
  goals: Goal[]; entries: Entry[]; areas: Area[]; curKey: string; ndays: number; todayD: number; isCurrent: boolean;
  c: C; onToggle: (g: Goal, d: number) => void; onLogNumber: (g: Goal, d: number, v: number) => void;
  onDelete: (id: string) => void; onAdd: () => void;
}) {
  const [numGoal, setNumGoal] = useState<{ g: Goal; d: number; val: string } | null>(null);
  const areaName = (id: string) => areas.find(a => a.id === id)?.name ?? "—";

  return (
    <div className="space-y-4">
      {/* grid card — the hero */}
      <Card c={c} className="overflow-hidden" style={{ padding: 0 }}>
        <div className="overflow-x-auto">
          <table className="border-collapse" style={{ minWidth: Math.max(320, 128 + ndays * 30) }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 text-left text-[11px] font-semibold uppercase pr-3 pt-3" style={{ background: c.surface, color: c.sub, letterSpacing: "0.05em" }}>Goal</th>
                {Array.from({ length: ndays }, (_, i) => (
                  <th key={i} className="text-[10px] font-normal tnum pb-1 pt-3" style={{ color: isCurrent && i + 1 === todayD ? c.accent : c.sub, fontWeight: isCurrent && i + 1 === todayD ? 700 : 400 }}>{i + 1}</th>
                ))}
                <th className="text-[11px] font-semibold uppercase pl-2 pt-3" style={{ color: c.sub, letterSpacing: "0.05em" }}>%</th>
              </tr>
            </thead>
            <tbody>
              {goals.map((g, ri) => {
                const st = goalStats(g, entries, curKey);
                return (
                  <tr key={g.id}>
                    <td className="sticky left-0 z-10 pr-3 py-2 max-w-32" style={{ background: c.surface, borderTop: ri === 0 ? "none" : `0.5px solid ${c.faint2}` }}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[15px] font-medium truncate leading-snug" title={`${g.name} · ${areaName(g.areaId)}`}>{g.name}</span>
                        <button onClick={() => { if (confirm(`Delete “${g.name}”?`)) onDelete(g.id); }}
                          aria-label={`Delete ${g.name}`} className="w-7 h-7 -ml-0.5 rounded-full flex items-center justify-center shrink-0 btn-motion" style={{ color: c.faint }}>
                          <Icon d={P.trash} size={13} sw={1.6} />
                        </button>
                      </div>
                      <div className="text-[11px] tnum" style={{ color: c.sub }}>
                        {g.type === "daily" && "every day"}
                        {g.type === "weekly" && `${g.target}/week`}
                        {g.type === "number" && `${g.target}${g.unit ?? ""} total`}
                        {g.type === "once" && "one-off"}
                      </div>
                    </td>
                    {Array.from({ length: ndays }, (_, i) => {
                      const day = i + 1;
                      const ds = `${curKey}-${pad(day)}`;
                      const e = entries.find(x => x.goalId === g.id && x.date === ds);
                      const future = isCurrent && day > todayD;
                      const isToday = isCurrent && day === todayD;
                      if (g.type === "number") {
                        return (
                          <td key={day} className="p-[3px]">
                            <button disabled={future} onClick={() => setNumGoal({ g, d: day, val: e ? String(e.value) : "" })}
                              className="w-[26px] h-9 rounded-[8px] text-[10px] font-medium tnum cell-motion flex items-center justify-center"
                              style={e
                                ? { background: c.success, color: "#fff" }
                                : { background: isToday ? c.faint2 : "transparent", border: `1px solid ${future ? c.faint2 : c.faint}`, color: c.sub }}
                              >{e ? Math.round(e.value) : "·"}</button>
                          </td>
                        );
                      }
                      if (g.type === "once") {
                        if (day !== 1) return <td key={day} />;
                        return (
                          <td key={day} colSpan={ndays} className="py-2 pl-1">
                            <button onClick={() => onToggle(g, 1)}
                              className="min-h-[40px] px-4 rounded-full text-[13px] font-semibold btn-motion inline-flex items-center gap-1.5"
                              style={e ? { background: c.success, color: "#fff" } : { background: c.faint2, color: c.ink }}>
                              {e && <Icon d={P.check} size={14} sw={2.2} color="#fff" />}
                              {e ? "Done" : "Mark as done"}
                            </button>
                          </td>
                        );
                      }
                      return (
                        <td key={day} className="p-[3px]">
                          <button disabled={future} onClick={() => onToggle(g, day)}
                            className={"w-[26px] h-9 rounded-[8px] flex items-center justify-center cell-motion" + (e ? " tick-pop" : "")}
                            style={e
                              ? { background: c.success }
                              : { background: isToday ? c.faint2 : "transparent", border: `1px solid ${future ? c.faint2 : c.faint}` }}
                            aria-label={`${g.name} day ${day}`}>
                            {e && <Icon d={P.check} size={13} sw={2.4} color="#fff" />}
                          </button>
                        </td>
                      );
                    })}
                    <td className="pl-2 text-[13px] whitespace-nowrap" style={{ borderTop: ri === 0 ? "none" : `0.5px solid ${c.faint2}` }}>
                      <Pct v={st.pct} c={c} />
                    </td>
                  </tr>
                );
              })}
              {!goals.length && (
                <tr><td colSpan={ndays + 2} className="py-12 px-4">
                  <div className="flex flex-col items-start gap-1">
                    <Icon d={P.spark} size={22} color={c.sub} />
                    <p className="text-[15px] font-medium">This chapter is blank.</p>
                    <p className="text-[13px]" style={{ color: c.sub }}>Add your first goal below.</p>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {goals.length > 0 && (
          <div className="mt-1 pt-3 pb-1 px-4" style={{ borderTop: `0.5px solid ${c.faint}` }}>
            <div className="flex items-center justify-between text-[13px] mb-2" style={{ color: c.sub }}>
              <span>Whole month</span>
              <Pct v={overallPct(goals, entries, curKey)} c={c} />
            </div>
            <Bar v={overallPct(goals, entries, curKey)} c={c} />
          </div>
        )}
      </Card>

      {/* actions */}
      <div className="flex gap-3">
        <button onClick={onAdd} className="flex-1 min-h-[52px] rounded-full text-[15px] font-semibold btn-motion flex items-center justify-center gap-1.5"
          style={{ background: c.accent, color: c.onAccent, boxShadow: c.shadow }}>
          <Icon d={P.plus} size={17} sw={2.2} />
          Add a goal for this month
        </button>
      </div>

      {/* number logging sheet */}
      {numGoal && (
        <div className="fixed inset-0 z-50 flex items-end p-4" style={{ background: "rgba(0,0,0,.30)" }} onClick={() => setNumGoal(null)}>
          <div className="w-full max-w-xl mx-auto rounded-[20px] p-5 sheet-in"
            style={{ background: c.surface, boxShadow: c.shadow, backdropFilter: "blur(16px)" }} onClick={e => e.stopPropagation()}>
            <div className="text-[17px] font-semibold mb-0.5" style={{ letterSpacing: "-0.01em" }}>{numGoal.g.name}</div>
            <div className="text-[13px] mb-5" style={{ color: c.sub }}>
              Log amount for day {numGoal.d} (target {numGoal.g.target}{numGoal.g.unit ?? ""} this month)
            </div>
            <div className="flex gap-2">
              <input autoFocus type="number" inputMode="decimal" value={numGoal.val}
                onChange={e => setNumGoal({ ...numGoal, val: e.target.value })}
                onKeyDown={e => { if (e.key === "Enter") { onLogNumber(numGoal.g, numGoal.d, Number(numGoal.val) || 0); setNumGoal(null); } }}
                className="flex-1 px-4 min-h-[48px] rounded-[12px] text-[19px] font-medium tnum outline-none"
                style={{ background: c.inset, border: "none", color: c.ink }} />
              <button onClick={() => { onLogNumber(numGoal.g, numGoal.d, Number(numGoal.val) || 0); setNumGoal(null); }}
                className="px-6 min-h-[48px] rounded-full text-[15px] font-semibold btn-motion" style={{ background: c.accent, color: c.onAccent }}>Save</button>
            </div>
            <p className="text-[12px] mt-3" style={{ color: c.sub }}>Leave empty or 0 to clear the day.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------- DAY VIEW ----------------------

function DayView({ db, update, c, dateKey, goals, entries, onToggle }: {
  db: DB; update: (fn: (d: DB) => void) => void; c: C; dateKey: string;
  goals: Goal[]; entries: Entry[]; onToggle: (g: Goal) => void;
}) {
  const j = db.journal.find(x => x.date === dateKey);
  const [text, setText] = useState(j?.text ?? "");
  useEffect(() => { const j2 = db.journal.find(x => x.date === dateKey); setText(j2?.text ?? ""); }, [dateKey]);

  const saveJournal = () => update(d => {
    const i = d.journal.findIndex(x => x.date === dateKey);
    if (i >= 0) d.journal[i].text = text;
    else d.journal.push({ date: dateKey, text });
  });

  const uploadPhoto = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      update(d => {
        const i = d.journal.findIndex(x => x.date === dateKey);
        if (i >= 0) d.journal[i].photo = url;
        else d.journal.push({ date: dateKey, text, photo: url });
      });
    };
    r.readAsDataURL(file);
  };
  const removePhoto = () => update(d => {
    const i = d.journal.findIndex(x => x.date === dateKey);
    if (i >= 0) d.journal[i].photo = null;
  });

  const dailyish = goals.filter(g => g.type === "daily" || g.type === "weekly");
  const onceGoals = goals.filter(g => g.type === "once");
  const numGoals = goals.filter(g => g.type === "number");
  const prettyDate = new Date(dateKey + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const monthKey = dateKey.slice(0, 7);

  return (
    <div className="space-y-4">
      <div className="text-[13px] font-medium" style={{ color: c.sub }}>{prettyDate}</div>

      {/* today's goals */}
      <Card c={c}>
        <SectionLabel c={c}>Today's goals</SectionLabel>
        <ul>
          {dailyish.length === 0 && onceGoals.length === 0 && numGoals.length === 0 && (
            <p className="text-[15px]" style={{ color: c.sub }}>No goals this month yet. Add some from the Grid tab.</p>
          )}
          {dailyish.map(g => {
            const done = entries.some(e => e.goalId === g.id && e.date === dateKey);
            return (
              <li key={g.id} className="flex items-center gap-3 min-h-[48px]" style={{ borderTop: `0.5px solid ${c.faint2}` }}>
                <button onClick={() => onToggle(g)} aria-label={g.name}
                  className={"w-8 h-8 rounded-full flex items-center justify-center shrink-0 cell-motion" + (done ? " tick-pop" : "")}
                  style={done ? { background: c.success } : { border: `1.5px solid ${c.faint}` }}>
                  {done && <Icon d={P.check} size={15} sw={2.4} color="#fff" />}
                </button>
                <span className="text-[16px] flex-1 truncate">{g.name}</span>
                {g.type === "weekly" && <span className="text-[12px] tnum" style={{ color: c.sub }}>1 of {g.target}/week</span>}
                <Pct v={goalStats(g, entries, monthKey).pct} c={c} />
              </li>
            );
          })}
          {numGoals.map(g => {
            const numE = entries.find(e => e.goalId === g.id && e.date === dateKey);
            return (
              <li key={g.id} className="flex items-center gap-3 min-h-[48px]" style={{ borderTop: `0.5px solid ${c.faint2}` }}>
                <input type="number" inputMode="decimal" placeholder="log" value={numE ? String(numE.value) : ""}
                  onChange={e => {
                    const v = Number(e.target.value) || 0;
                    update(d => {
                      const i = d.entries.findIndex(x => x.goalId === g.id && x.date === dateKey);
                      if (i >= 0) { if (v <= 0) d.entries.splice(i, 1); else d.entries[i].value = v; }
                      else if (v > 0) d.entries.push({ id: uid(), goalId: g.id, date: dateKey, value: v });
                    });
                  }}
                  className="w-[76px] px-3 min-h-[40px] rounded-[10px] text-[15px] font-medium tnum outline-none text-center" style={{ background: c.inset, border: "none", color: c.ink }} />
                <span className="text-[16px] flex-1 truncate">{g.name} <span className="text-[12px]" style={{ color: c.sub }}>{g.unit}</span></span>
                <Pct v={goalStats(g, entries, monthKey).pct} c={c} />
              </li>
            );
          })}
          {onceGoals.map(g => {
            const done = entries.some(e => e.goalId === g.id && e.value > 0);
            return (
              <li key={g.id} className="flex items-center gap-3 min-h-[48px]" style={{ borderTop: `0.5px solid ${c.faint2}` }}>
                <button onClick={() => onToggle(g)} aria-label={g.name}
                  className={"w-8 h-8 rounded-full flex items-center justify-center shrink-0 cell-motion" + (done ? " tick-pop" : "")}
                  style={done ? { background: c.success } : { border: `1.5px solid ${c.faint}` }}>
                  {done && <Icon d={P.check} size={15} sw={2.4} color="#fff" />}
                </button>
                <span className="text-[16px] flex-1 truncate">{g.name}</span>
                <span className="text-[12px]" style={{ color: c.sub }}>milestone</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* journal — the one place with notebook warmth */}
      <Card c={c}>
        <SectionLabel c={c}>Journal</SectionLabel>
        <textarea value={text} onChange={e => setText(e.target.value)} onBlur={saveJournal}
          rows={5} placeholder="How did today go? (saved automatically)"
          className="w-full p-4 rounded-[12px] text-[17px] leading-relaxed outline-none resize-y"
          style={{ background: c.inset, border: "none", color: c.ink, fontFamily: SERIF }} />
      </Card>

      {/* photo of the day */}
      <Card c={c}>
        <SectionLabel c={c}>Photo of the day</SectionLabel>
        {j?.photo ? (
          <div className="relative">
            <img src={j.photo} alt="Photo of the day" className="w-full rounded-[14px] object-cover" style={{ maxHeight: 260 }} />
            <button onClick={removePhoto} aria-label="Remove photo"
              className="absolute top-2.5 right-2.5 w-9 h-9 rounded-full flex items-center justify-center btn-motion"
              style={{ background: "rgba(0,0,0,.45)", color: "#fff" }}>
              <Icon d={P.x} size={15} sw={2} />
            </button>
          </div>
        ) : (
          <label className="block w-full min-h-[88px] rounded-[12px] text-[15px] font-medium flex flex-col items-center justify-center gap-1.5 cursor-pointer"
            style={{ background: c.inset, color: c.sub }}>
            <Icon d={P.camera} size={20} sw={1.6} />
            Add a photo
            <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }} />
          </label>
        )}
      </Card>
    </div>
  );
}

// ---------------------- MONTH REVIEW ----------------------

function MonthReviewView({ db, update, c, curKey, goals, onCopy }: {
  db: DB; update: (fn: (d: DB) => void) => void; c: C; curKey: string; goals: Goal[]; onCopy: () => void;
}) {
  const rec = db.months.find(x => x.key === curKey);
  const review = rec?.review ?? { whatWorked: "", whatDidnt: "", whatToChange: "" };
  const [rv, setRv] = useState(review);
  const entries = db.entries;
  const yv = Number(curKey.slice(0, 4)), mv = Number(curKey.slice(5));

  const scored = goals.map(g => ({ g, s: goalStats(g, entries, curKey) })).sort((a, b) => b.s.pct - a.s.pct);
  const weeks = weekBuckets(goals, entries, curKey);
  const bestWeek = weeks.length ? weeks.reduce((a, b) => (b.pct > a.pct ? b : a)) : { label: "—", pct: 0 };
  const worstWeek = weeks.length ? weeks.reduce((a, b) => (b.pct < a.pct ? b : a)) : { label: "—", pct: 100 };
  const monthJournal = db.journal.filter(j => j.date.startsWith(curKey));
  const photos = monthJournal.filter(j => j.photo).map(j => j.photo!);

  const save = () => update(d => {
    const summary = generateSummary(goals, entries, monthJournal, curKey, rv);
    const full = { ...rv, summary, savedAt: new Date().toISOString() };
    const i = d.months.findIndex(x => x.key === curKey);
    if (i >= 0) d.months[i].review = full;
    else d.months.push({ key: curKey, year: yv, month: mv, review: full });
  });

  const savedSummary = rec?.review?.summary;

  return (
    <div className="space-y-4">
      {/* month number, well-set */}
      <Card c={c}>
        <div className="flex items-center gap-6">
          <Ring v={overallPct(goals, entries, curKey)} c={c} size={88} />
          <div>
            <div className="text-[13px] font-semibold uppercase mb-1" style={{ color: c.sub, letterSpacing: "0.06em" }}>
              {MONTHS[mv - 1]} {yv} · chapter {mv}/12
            </div>
            <div className="text-[15px] leading-snug" style={{ color: c.sub }}>
              across {goals.length} goal{goals.length === 1 ? "" : "s"} — a shape, not a grade
            </div>
          </div>
        </div>
      </Card>

      {/* per-goal */}
      {scored.length > 0 && (
        <Card c={c}>
          <SectionLabel c={c}>Goals</SectionLabel>
          <ul className="space-y-4">
            {scored.map(({ g, s }) => (
              <li key={g.id}>
                <div className="flex items-baseline justify-between text-[15px] font-medium mb-1.5">
                  <span className="truncate">{g.name}</span>
                  <Pct v={s.pct} c={c} />
                </div>
                <Bar v={s.pct} c={c} />
                <div className="text-[12px] tnum mt-1" style={{ color: c.sub }}>
                  {g.type === "number" ? `${Math.round(s.done)}${g.unit ?? ""} of ${g.target}${g.unit ?? ""}` : `${s.done} / ${s.targetTotal}`}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* weeks */}
      {scored.length > 0 && (
        <Card c={c}>
          <SectionLabel c={c}>Weeks</SectionLabel>
          <div className="flex gap-2 items-end h-24">
            {weeks.map(w => {
              const k = pctColor(w.pct);
              const col = k === "success" ? c.success : k === "warning" ? c.warning : c.sub;
              return (
                <div key={w.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <div className="w-full rounded-t-[6px] rounded-b-[2px]" style={{ height: `${Math.max(3, w.pct)}%`, background: col, transition: "height .35s cubic-bezier(.2,.8,.2,1), background .2s" }} />
                  <span className="text-[10px] font-medium tnum" style={{ color: c.sub }}>{w.label}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[13px] mt-4 pt-3" style={{ color: c.sub, borderTop: `0.5px solid ${c.faint}` }}>
            <span>Best: <b className="font-semibold tnum" style={{ color: c.ink }}>{bestWeek.label} ({bestWeek.pct}%)</b></span>
            <span>Hardest: <b className="font-semibold tnum" style={{ color: c.ink }}>{worstWeek.label} ({worstWeek.pct}%)</b></span>
          </div>
        </Card>
      )}

      {/* photo collage */}
      {photos.length > 0 && (
        <Card c={c}>
          <SectionLabel c={c}>Your month in photos</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => <img key={i} src={p} className="w-full aspect-square object-cover rounded-[12px]" alt="" />)}
          </div>
        </Card>
      )}

      {/* reflective prompts — notebook warmth */}
      <Card c={c}>
        <SectionLabel c={c}>Close the chapter</SectionLabel>
        <div className="space-y-4">
          {([["whatWorked", "What worked?"], ["whatDidnt", "What didn't?"], ["whatToChange", "What will you change next month?"]] as const).map(([k, label]) => (
            <div key={k}>
              <label className="text-[13px] font-medium mb-1.5 block" style={{ color: c.sub }}>{label}</label>
              <textarea value={rv[k]} onChange={e => setRv({ ...rv, [k]: e.target.value })} rows={2}
                className="w-full p-4 rounded-[12px] text-[16px] leading-relaxed outline-none"
                style={{ background: c.inset, border: "none", color: c.ink, fontFamily: SERIF }} />
            </div>
          ))}
          <button onClick={save} className="w-full min-h-[52px] rounded-full text-[15px] font-semibold btn-motion"
            style={{ background: c.accent, color: c.onAccent }}>
            Save review & write summary
          </button>
        </div>
      </Card>

      {/* summary */}
      {savedSummary && (
        <Card c={c} style={{ background: c.inset, boxShadow: "none" }}>
          <SectionLabel c={c}>Summary · written from your data & notes</SectionLabel>
          <p className="text-[17px] leading-relaxed whitespace-pre-wrap" style={{ fontFamily: SERIF, letterSpacing: "0.01em" }}>{savedSummary}</p>
        </Card>
      )}

      <button onClick={onCopy} className="w-full min-h-[52px] rounded-full text-[15px] font-semibold btn-motion flex items-center justify-center gap-1.5"
        style={{ background: c.surface, color: c.ink, boxShadow: c.shadow }}>
        <Icon d={P.copy} size={17} sw={1.8} />
        Copy this month's goals to next month
      </button>
    </div>
  );
}

// ---------------------- ADD GOAL MODAL ----------------------

function AddGoalModal({ areas, c, onClose, onSave }: {
  areas: Area[]; c: C; onClose: () => void; onSave: (g: Omit<Goal, "id" | "monthKey">) => void;
}) {
  const [name, setName] = useState("");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [type, setType] = useState<GoalType>("daily");
  const [target, setTarget] = useState(1);
  const [unit, setUnit] = useState("");
  const [reminder, setReminder] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim() || !areaId) return;
    onSave({
      name: name.trim(), areaId, type,
      target: type === "daily" || type === "once" ? 1 : Math.max(1, target),
      unit: type === "number" ? unit || undefined : undefined,
      reminder,
    });
    onClose();
  };

  const inputCls = "w-full px-4 min-h-[48px] rounded-[12px] text-[16px] outline-none";
  const inputStyle = { background: c.inset, border: "none" as const, color: c.ink, fontFamily: FONT };

  return (
    <div className="fixed inset-0 z-50 flex items-end p-4" style={{ background: "rgba(0,0,0,.30)" }} onClick={onClose}>
      <div className="w-full max-w-xl mx-auto rounded-[20px] p-5 max-h-[85vh] overflow-y-auto sheet-in"
        style={{ background: c.surface, boxShadow: c.shadow, backdropFilter: "blur(16px)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[20px] font-bold" style={{ letterSpacing: "-0.02em" }}>New goal for this month</h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center btn-motion" style={{ background: c.faint2, color: c.sub }}>
            <Icon d={P.x} size={16} sw={2} />
          </button>
        </div>
        <div className="space-y-4">
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Goal name (e.g. Gym, Meditate, Save…)"
            className={inputCls} style={inputStyle} />
          <select value={areaId} onChange={e => setAreaId(e.target.value)} className={inputCls} style={inputStyle}>
            {areas.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
          </select>
          <div className="grid grid-cols-4 gap-2">
            {([["daily", "Daily"], ["weekly", "Weekly"], ["number", "Number"], ["once", "One-off"]] as [GoalType, string][]).map(([t, l]) => (
              <button key={t} onClick={() => setType(t)} className="min-h-[44px] rounded-full text-[13px] font-medium btn-motion"
                style={type === t ? { background: c.accent, color: c.onAccent } : { background: c.faint2, color: c.sub }}>{l}</button>
            ))}
          </div>
          {type === "weekly" && (
            <label className="flex items-center gap-3 text-[15px] min-h-[44px]">
              <span style={{ color: c.sub }}>Times per week:</span>
              <input type="number" min={1} max={7} value={target} onChange={e => setTarget(Number(e.target.value))}
                className="w-[64px] px-3 min-h-[40px] rounded-[10px] tnum text-center font-medium" style={inputStyle} />
            </label>
          )}
          {type === "number" && (
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="text-[13px] font-medium block mb-1.5" style={{ color: c.sub }}>Monthly target</span>
                <input type="number" value={target} onChange={e => setTarget(Number(e.target.value))} className={inputCls + " tnum font-medium"} style={inputStyle} />
              </label>
              <label className="w-28">
                <span className="text-[13px] font-medium block mb-1.5" style={{ color: c.sub }}>Unit</span>
                <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="€, pages…" className={inputCls} style={inputStyle} />
              </label>
            </div>
          )}
          <label className="flex items-center gap-3 text-[15px] min-h-[44px]">
            <span style={{ color: c.sub }}>Gentle reminder</span>
            <input type="time" value={reminder ?? ""} onChange={e => setReminder(e.target.value || null)}
              className="px-3 min-h-[40px] rounded-[10px] text-[15px]" style={inputStyle} />
            {reminder && <button onClick={() => setReminder(null)} className="text-[13px] font-medium min-h-[44px]" style={{ color: c.accent }}>clear</button>}
          </label>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 min-h-[52px] rounded-full text-[15px] font-medium btn-motion"
              style={{ background: c.faint2, color: c.sub }}>Cancel</button>
            <button onClick={submit} className="flex-1 min-h-[52px] rounded-full text-[15px] font-semibold btn-motion"
              style={{ background: c.accent, color: c.onAccent }}>Add goal</button>
          </div>
        </div>
      </div>
    </div>
  );
}