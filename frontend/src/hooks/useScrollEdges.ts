import { useEffect, useRef, useState } from "react";

export interface ScrollEdges {
  /** Content is scrolled out of view at the inline-start edge (right, in RTL). */
  overflowStart: boolean;
  /** Content is scrolled out of view at the inline-end edge (left, in RTL). */
  overflowEnd: boolean;
}

/**
 * Reports which edges of a horizontally scrollable element have content
 * scrolled out of view, so a caller can show a scroll affordance only where
 * one is actually warranted.
 *
 * The offset is compared by magnitude rather than sign: browsers disagree on
 * whether an RTL container counts scrollLeft down to a negative minimum or up
 * to a positive maximum, and the distance travelled from the start is the same
 * either way.
 *
 * `contentKey` re-measures when the scrollable content is swapped out. The
 * list element keeps its own size when its children change, so observing only
 * the list would miss a module switch that produces fewer or more tabs.
 */
export function useScrollEdges<T extends HTMLElement>(contentKey?: unknown) {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({
    overflowStart: false,
    overflowEnd: false,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const offset = Math.abs(el.scrollLeft);
      // 1px of slack: sub-pixel layout rounds differently across zoom levels,
      // and a shadow that flickers at the very end of a scroll reads as broken.
      const next: ScrollEdges = {
        overflowStart: offset > 1,
        overflowEnd: max > 1 && offset < max - 1,
      };
      setEdges((prev) =>
        prev.overflowStart === next.overflowStart && prev.overflowEnd === next.overflowEnd
          ? prev
          : next,
      );
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });

    // Observe the children as well as the list itself: the list is sized by its
    // parent, so a change in the tabs — a module switch, or the Arabic webfont
    // swapping in and widening every label — only shows on the children's boxes.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);

    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [contentKey]);

  return { ref, ...edges };
}
