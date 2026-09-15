import type { WeekWindow } from "./types";

function parseDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function weekday(iso: string): number {
  return parseDate(iso).getDay();
}

/** Inclusive Monday/Sunday-based H2H weeks covering [start, end]. */
export function buildWeeks(
  seasonStart: string,
  seasonEnd: string,
  weekStartsOn: 0 | 1,
): WeekWindow[] {
  if (!seasonStart || !seasonEnd) return [];
  const startDow = weekday(seasonStart);
  const offset = (startDow - weekStartsOn + 7) % 7;
  const first = addDays(seasonStart, -offset);
  const weeks: WeekWindow[] = [];
  let cursor = first;
  let index = 1;
  while (cursor <= seasonEnd) {
    const end = addDays(cursor, 6);
    weeks.push({ index, start: cursor, end });
    cursor = addDays(cursor, 7);
    index += 1;
    if (index > 40) break;
  }
  return weeks;
}

export function weekContaining(weeks: WeekWindow[], date: string): WeekWindow | undefined {
  return weeks.find((w) => date >= w.start && date <= w.end);
}

export function formatDay(iso: string, lang: "fi" | "en"): string {
  const d = parseDate(iso);
  return d.toLocaleDateString(lang === "fi" ? "fi-FI" : "en-CA", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

export function formatRange(start: string, end: string, lang: "fi" | "en"): string {
  const loc = lang === "fi" ? "fi-FI" : "en-CA";
  const a = parseDate(start).toLocaleDateString(loc, { day: "numeric", month: "numeric" });
  const b = parseDate(end).toLocaleDateString(loc, { day: "numeric", month: "numeric" });
  return `${a}–${b}`;
}
