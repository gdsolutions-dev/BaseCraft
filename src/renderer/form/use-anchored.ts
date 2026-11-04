// Form view anchoring: the spare room of the form's viewport (window larger than the form) feeds anchoredDoc, whose result is only rendered.
import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react';
import { anchoredDoc } from '../../shared/design/anchor';
import type { DesignDoc } from '../../shared/design/model';
import { effectiveProp } from '../../shared/design/properties';
import { TWIPS_PER_PX, twipsToPx } from '../designer/units';

/** `body` is the scrolling viewport; `selector` the record selector's width (px) beside the sections. Returns the anchored doc, the
 *  section width (px) and the body's overflow style. Whole px only, so the grown content never overflows its viewport by a fraction.
 *  An axis that takes spare room fits by construction, so it never scrolls: otherwise a transient scrollbar shrinks clientWidth,
 *  the content shrinks, the scrollbar goes, and the ResizeObserver loop stops at random with or without scrollbars. */
export function useAnchored(doc: DesignDoc, body: RefObject<HTMLElement>, vertical: boolean, selector: number) {
  const [room, setRoom] = useState({ w: 0, h: 0 });   // px of the viewport
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => setRoom((r) => (r.w === el.clientWidth && r.h === el.clientHeight ? r : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [body]);
  const width = twipsToPx(Number(effectiveProp(doc.props, 'Width', 'form')) || 0);
  const detail = doc.sections.find((s) => s.kind === 'detail' && s.props.Visible !== false);
  const sw = Math.max(0, Math.floor(room.w - selector - width));
  const sh = vertical && detail ? Math.max(0, Math.floor(room.h - twipsToPx(detail.height))) : 0;
  const anchored = useMemo(() => anchoredDoc(doc, { width: sw * TWIPS_PER_PX, height: sh * TWIPS_PER_PX }, { vertical }), [doc, sw, sh, vertical]);
  if (anchored === doc) return { doc, width, overflow: undefined };
  const overflow: CSSProperties = { overflowX: sw > 0 ? 'hidden' : undefined, overflowY: sh > 0 ? 'hidden' : undefined };
  return { doc: anchored, width: width + sw, overflow };
}
