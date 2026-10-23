// Horizontal splitter (a bar between a top and a bottom pane). `value` is the top pane's size in px; the parent owns it.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from './splitter-model';

type Props = {
  value: number; min: number; max: number; label: string; testId: string;
  total: number; // available size, for the PageUp/PageDown step (10 %)
  onChange: (px: number) => void; onReset: () => void;
};

export function Splitter({ value, min, max, label, testId, total, onChange, onReset }: Props) {
  const drag = useRef<{ y: number; start: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const move = (px: number) => onChange(clamp(px, min, max));
  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowUp: -16, ArrowDown: 16, PageUp: -total / 10, PageDown: total / 10 }[e.key];
    if (step !== undefined) move(value + step);
    else if (e.key === 'Home') move(min);
    else if (e.key === 'End') move(max);
    else return;
    e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, start: value };
    setDragging(true);
  };
  const end = () => { drag.current = null; setDragging(false); };
  return (
    <div className={`splitter${dragging ? ' is-dragging' : ''}`} role="separator" aria-orientation="horizontal" aria-label={label} data-testid={testId}
      aria-valuenow={Math.round(value)} aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} tabIndex={0}
      onKeyDown={onKeyDown} onDoubleClick={onReset} onPointerDown={onPointerDown}
      onPointerMove={(e) => { if (drag.current) move(drag.current.start + e.clientY - drag.current.y); }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} />
  );
}
