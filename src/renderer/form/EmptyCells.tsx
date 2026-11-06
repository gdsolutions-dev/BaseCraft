import { Fragment } from 'react';
import { cellControl, emptyCellsOf, sectionRef } from '../../shared/design/layout';
import type { DesignDoc, SectionDef } from '../../shared/design/model';
import { controlStyle, gridlineStyle } from './run-model';

/** The empty layout cells that carry stored formatting: back colour and gridlines only (no focus, no tab stop, no role, not a control);
 *  a bare cell draws nothing, so a form saved before L5 renders as before. */
export function EmptyCells({ doc, section }: { doc: DesignDoc; section: SectionDef }) {
  return <>{emptyCellsOf(doc, sectionRef(section)).filter((c) => Object.keys(c.props).length > 0).map((c) => {
    const k = cellControl(c), grid = gridlineStyle(k);
    const { background, left, top, width, height } = controlStyle(k);
    return (
      <Fragment key={k.name}>
        <div aria-hidden data-testid={`form-cell-${c.layout}-${c.row}-${c.col}`} style={{ position: 'absolute', pointerEvents: 'none', background, left, top, width, height }} />
        {grid && <div aria-hidden data-testid={`form-cell-grid-${c.layout}-${c.row}-${c.col}`} style={grid} />}
      </Fragment>
    );
  })}</>;
}
