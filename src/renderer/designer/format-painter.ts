// Format Painter (Home > Clipboard, Format > Font): armed on the one selected control, the next control selected receives its format
// (paintAction, one undoable edit), then it disarms; Escape disarms too. Shared by the form and report designers.
import { useCallback, useEffect, useRef, useState } from 'react';
import { sameName } from '../../shared/field-types';
import type { CommandState } from '../shell/ribbon-model';
import { documentKind, type DesignerAction, type DesignerState } from './designer-model';
import { paintAction } from './format-commands';

/** `send` with the painter in front of it (pass the result to the designer), the toggle command, and its ribbon state. */
export function useFormatPainter(state: DesignerState, send: (a: DesignerAction) => void, readOnly: boolean) {
  const [from, setFrom] = useState<string | null>(null);
  const live = useRef({ state, from });
  live.current = { state, from };
  useEffect(() => {
    if (from === null) return;
    const off = (e: KeyboardEvent) => { if (e.key === 'Escape') setFrom(null); };
    window.addEventListener('keydown', off);
    return () => window.removeEventListener('keydown', off);
  }, [from]);
  const painting = useCallback((a: DesignerAction) => {
    const { state: s, from: src } = live.current;
    const pick = a.type === 'select' && a.selection.kind === 'controls' && a.selection.names.length === 1 ? a.selection.names[0]! : null;
    if (src && pick && !sameName(pick, src)) {
      const p = paintAction(s.doc, documentKind(s), src, pick);
      if (p) send(p);
      setFrom(null);
    }
    send(a);
  }, [send]);
  const one = state.selection.kind === 'controls' && state.selection.names.length === 1 ? state.selection.names[0]! : null;
  const toggle = () => setFrom(live.current.from ? null : (live.current.state.selection.kind === 'controls' && live.current.state.selection.names.length === 1 ? live.current.state.selection.names[0]! : null));
  const cmdState: CommandState = { enabled: !readOnly && (from !== null || one !== null), active: from !== null };
  return { painting, toggle, cmdState };
}
