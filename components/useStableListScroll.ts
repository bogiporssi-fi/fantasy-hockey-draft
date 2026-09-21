"use client";

import { useLayoutEffect, useRef } from "react";

/** Keep overflow scroll stable across live pick updates (append/update, no remount). */
export function useStableListScroll(itemKey: string, follow: "bottom" | "anchor") {
  const ref = useRef<HTMLUListElement>(null);
  const stickToBottomRef = useRef(follow === "bottom");
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);

  function onScroll(e: { currentTarget: HTMLUListElement }) {
    const el = e.currentTarget;
    if (follow === "bottom") {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    }
    for (const child of Array.from(el.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const id = child.dataset.scrollAnchor;
      if (!id) continue;
      if (child.offsetTop + child.offsetHeight > el.scrollTop + 1) {
        anchorRef.current = { id, offset: child.offsetTop - el.scrollTop };
        break;
      }
    }
  }

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (follow === "bottom" && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    const node = el.querySelector(`[data-scroll-anchor="${CSS.escape(anchor.id)}"]`);
    if (node instanceof HTMLElement) {
      el.scrollTop = node.offsetTop - anchor.offset;
    }
  }, [itemKey, follow]);

  return { ref, onScroll };
}
