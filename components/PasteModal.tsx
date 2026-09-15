"use client";

import { t } from "@/lib/i18n";
import { matchPastedPlayers, parsePastedNames } from "@/lib/names";
import type { Lang, NhlPlayer } from "@/lib/types";
import { useMemo, useState } from "react";

export function PasteModal({
  lang,
  players,
  existingIds,
  onClose,
  onImport,
}: {
  lang: Lang;
  players: NhlPlayer[];
  existingIds: Set<number>;
  onClose: () => void;
  onImport: (matched: NhlPlayer[]) => void;
}) {
  const c = t(lang);
  const [text, setText] = useState("");

  const preview = useMemo(() => {
    const names = parsePastedNames(text);
    const { matched, unmatched } = matchPastedPlayers(names, players);
    const fresh = matched.filter((p) => !existingIds.has(p.id));
    return { names, matched: fresh, unmatched };
  }, [text, players, existingIds]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-[#0b1822] p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{c.pasteTitle}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-white">
            {c.close}
          </button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted">{c.pasteHelp}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={c.pastePlaceholder}
          rows={8}
          className="w-full rounded-lg border border-line bg-[#08141d] px-3 py-2 font-mono text-sm outline-none focus:border-ice/50"
        />
        <div className="mt-3 text-xs text-muted">
          {preview.matched.length} {c.players}
          {preview.unmatched.length > 0 && (
            <div className="mt-2 text-warn">
              {c.unmatched}: {preview.unmatched.join(", ")}
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-muted">
            {c.cancel}
          </button>
          <button
            type="button"
            disabled={preview.matched.length === 0}
            onClick={() => onImport(preview.matched)}
            className="rounded-md bg-ice px-3 py-1.5 text-sm font-medium text-rink disabled:opacity-40"
          >
            {c.import}
          </button>
        </div>
      </div>
    </div>
  );
}
