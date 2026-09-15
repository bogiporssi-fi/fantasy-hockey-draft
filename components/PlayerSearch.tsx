"use client";

import { searchPlayers } from "@/lib/names";
import { t } from "@/lib/i18n";
import type { Lang, NhlPlayer } from "@/lib/types";
import { useEffect, useMemo, useRef, useState } from "react";

export function PlayerSearch({
  lang,
  players,
  onPick,
  placeholder,
  excludeIds,
}: {
  lang: Lang;
  players: NhlPlayer[];
  onPick: (player: NhlPlayer) => void;
  placeholder?: string;
  excludeIds?: Set<number>;
}) {
  const c = t(lang);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const hits = searchPlayers(query, players, 14);
    if (!excludeIds || excludeIds.size === 0) return hits;
    return hits.filter((p) => !excludeIds.has(p.id)).concat(
      hits.filter((p) => excludeIds.has(p.id)),
    );
  }, [query, players, excludeIds]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(p: NhlPlayer) {
    onPick(p);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={query}
            onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = results[active];
            if (pick) choose(pick);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder ?? c.typeToSearch}
        className="w-full rounded-lg border border-line bg-[#08141d] px-3 py-2 text-sm text-white outline-none placeholder:text-muted/70 focus:border-ice/60"
        aria-label={c.searchPlayer}
      />
      {open && query.trim().length >= 2 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-[#0b1822] py-1 shadow-xl">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">—</li>
          )}
          {results.map((p, i) => {
            const excluded = excludeIds?.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    i === active ? "bg-ice/10" : ""
                  } ${excluded ? "opacity-60" : ""}`}
                >
                  <span className="w-8 shrink-0 font-mono text-[11px] text-ice/80">
                    {p.team}
                  </span>
                  <span className="flex-1 truncate">
                    {p.fullName}
                    <span className="ml-2 text-[11px] text-muted">{p.position}</span>
                  </span>
                  {excluded && (
                    <span className="text-[10px] uppercase tracking-wide text-muted">
                      {c.onRoster}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
