import type { FantasyPosition, NhlPlayer } from "./types";

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripDecorations(line: string): string {
  return line
    .replace(/"[^"]*"/g, (m) => m.slice(1, -1))
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Turn "Matthews, Auston" into "Auston Matthews" when it looks like Last, First. */
export function canonicalName(raw: string): string {
  const cleaned = stripDecorations(raw);
  if (!cleaned) return "";
  const comma = cleaned.indexOf(",");
  if (comma > 0) {
    const last = cleaned.slice(0, comma).trim();
    const first = cleaned.slice(comma + 1).trim();
    if (first && last && !first.includes(",")) {
      return `${first} ${last}`;
    }
  }
  return cleaned;
}

export function parsePastedNames(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const header = normalizeName(lines[0]);
  const looksHeader =
    header.includes("player") ||
    header.includes("pelaaja") ||
    (header.includes("name") && header.includes("team")) ||
    header.includes("position");

  const start = looksHeader ? 1 : 0;
  const names: string[] = [];

  for (let i = start; i < lines.length; i++) {
    let line = lines[i];
    if (line.includes(";") && !line.includes(",")) {
      line = line.split(";")[0];
    } else if (line.includes(",")) {
      const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const firstTokenWords = normalizeName(parts[0]).split(" ").filter(Boolean);
        if (firstTokenWords.length >= 2) {
          line = parts[0];
        } else {
          line = `${parts[1]} ${parts[0]}`.trim();
        }
      }
    }
    const name = canonicalName(line);
    if (name && !/^\d+$/.test(name)) names.push(name);
  }

  return names;
}

export function searchPlayers(query: string, players: NhlPlayer[], limit = 12): NhlPlayer[] {
  const q = normalizeName(query);
  if (q.length < 2) return [];
  const scored: { p: NhlPlayer; score: number }[] = [];
  for (const p of players) {
    const full = normalizeName(p.fullName);
    const last = normalizeName(p.lastName);
    const first = normalizeName(p.firstName);
    let score = 0;
    if (full === q) score = 100;
    else if (full.startsWith(q)) score = 90;
    else if (last.startsWith(q)) score = 80;
    else if (`${first} ${last}`.startsWith(q)) score = 85;
    else if (full.includes(q)) score = 60;
    else if (last.includes(q) && q.length >= 3) score = 50;
    else continue;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.lastName.localeCompare(b.p.lastName));
  return scored.slice(0, limit).map((s) => s.p);
}

export interface MatchResult {
  matched: NhlPlayer[];
  unmatched: string[];
}

export function matchPastedPlayers(names: string[], players: NhlPlayer[]): MatchResult {
  const byFull = new Map<string, NhlPlayer[]>();
  const byLast = new Map<string, NhlPlayer[]>();
  for (const p of players) {
    const full = normalizeName(p.fullName);
    const last = normalizeName(p.lastName);
    byFull.set(full, [...(byFull.get(full) ?? []), p]);
    byLast.set(last, [...(byLast.get(last) ?? []), p]);
  }

  const matched: NhlPlayer[] = [];
  const unmatched: string[] = [];
  const seen = new Set<number>();

  for (const name of names) {
    const key = normalizeName(canonicalName(name));
    let hits = byFull.get(key) ?? [];
    if (hits.length === 0) {
      const last = key.split(" ").slice(-1)[0];
      const first = key.split(" ").slice(0, -1).join(" ");
      const lastHits = byLast.get(last) ?? [];
      if (first) {
        hits = lastHits.filter((p) => normalizeName(p.firstName).startsWith(first));
      } else {
        hits = lastHits;
      }
    }
    const unique = hits.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
    if (unique.length === 1 && !seen.has(unique[0].id)) {
      matched.push(unique[0]);
      seen.add(unique[0].id);
    } else if (unique.length === 1 && seen.has(unique[0].id)) {
      continue;
    } else {
      unmatched.push(name);
    }
  }

  return { matched, unmatched };
}

export function nhlToFantasyPosition(code: string): FantasyPosition {
  const c = code.toUpperCase();
  if (c === "L" || c === "LW") return "LW";
  if (c === "R" || c === "RW") return "RW";
  if (c === "D") return "D";
  if (c === "G") return "G";
  return "C";
}
