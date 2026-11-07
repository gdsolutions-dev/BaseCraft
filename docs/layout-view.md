# Layout view and control layouts in BaseCraft

BaseCraft has Access's **control layouts** and **Layout view** (Mode Page in the French interface) for forms and reports. A layout binds controls and their labels into a grid that moves and resizes as a block. Layout view shows your live data while you edit the design.

The layout commands are on the **Arrange** tab, which appears when a form or report is open in Design view or Layout view.

## Layouts: Stacked and Tabular

A layout is a grid of cells. Each cell holds one control or is empty.

- **Stacked**: one row per field, the label on the left and the control on the right.
- **Tabular**: one column per field, the labels in the header section and the controls in the Detail section.

To create one, select the controls (labels included) in Design view and click **Stacked** or **Tabular** (Arrange › Table).

- Stacked orders the rows by the controls' tops, then lefts. Tabular orders the columns by their lefts.
- The layout sits where the top-left control was. Each row (Stacked) or column (Tabular) keeps the control's height or width.
- Tabular creates the Form Header if it is hidden, and moves the labels there. In a report the labels go to the Page Header.
- Applying Stacked or Tabular to a control already in a layout takes it out of that layout first.
- A tab control or a subform takes one cell, as a new row stretched to the data column. An option group never joins a layout: it floats over it.
- **Remove Layout** (Design view only) releases the controls where they stand.

Instant forms and instant reports (AutoForm, AutoReport) create their controls as layouts.

### Rows and columns

| Command (Arrange) | What it does |
|---|---|
| **Insert Above**, **Insert Below**, **Insert Left**, **Insert Right** | Adds a row or column of empty cells next to the selected cell. |
| **Select Layout**, **Select Column**, **Select Row** | Selects the whole layout, or the column or row of the selection. In Tabular, a column spans the header and the Detail. |
| **Move Up**, **Move Down** | Moves the selected row up or down, within its section. |

- An inserted row is 240 twips high. An inserted column copies the width of the column next to it.
- Widening a control in a layout widens its whole column; the next columns follow.
- Deleting a control leaves its cell empty. When the last member of a layout is deleted, the layout is removed.
- Copying members and pasting them does not make the copies join the original layout.

## Layout view

Layout view shows a form or a report **with its data** while you edit it. Use it to resize and arrange controls on real values.

Open it from the **View** group of the ribbon (**Layout View**), from the status bar buttons, or from the Navigation Pane menu (**Layout View**).

Switching between Design view and Layout view keeps your unsaved edits and the undo history, and asks no question. Going to Form view, Datasheet view or Print Preview asks to save first if the object has changed.

The editor is the same as in Design view: selection, resize handles, Property Sheet, Arrange and Format commands, undo and redo. Opening an object in Layout view does not change it, and Layout view never writes record data.

### Forms

- The controls show the current record. The record navigation bar is there, so you can change records while you edit.
- A Continuous form repeats its Detail over several records. At most 25 records are loaded.
- The Toolbox and the controls gallery work as in Design view. A control placed over a layout joins it: a new row in Stacked, a new column in Tabular.
- Not available: the section height bars, the Event tab of the Property Sheet, Tab Order and View Code.
- A form with no record source, an empty one, or one that cannot be read still opens. A notice at the top says the controls show no data.
- A parameterized query asks for its parameters **once**. Switching views or saving does not ask again. If you cancel the question, a notice says so and the view shows no data.

### Reports

- The report is laid out by the same engine as Print Preview, but as **one continuous flow, with no page breaks**. Groups and totals are computed, and there is one page footer at the end.
- Selecting a Detail control rings it on every record. Its width handle resizes the column and every record reflows at once, in one undo step.
- At most 100 source rows are laid out. A notice says when the source is longer.
- The controls gallery works, and so do the **Page Numbers**, **Logo**, **Title** and **Date and Time** header items. **Totals**, **Hide Details**, the Group, Sort and Total pane and the Field List are not available.
- **Delete** removes the selected control from every record, in one undo step.
- You cannot type in the cells of a report. No event runs in Layout view (On Open, On Format and so on).

### Allow Layout View

Set the **Allow Layout view** property of a form or report to No and the Layout View buttons and menu item are disabled.

## Merge and split cells

Select cells in Design or Layout view (Ctrl+click adds more), then use the **Merge / Split** group.

- **Merge**: the cells must form a rectangle of adjacent cells of one layout, in one section, and at most one of them may hold a control. The result is one cell spanning the rectangle, and the control takes its size. When two cells both hold a control, Merge is greyed.
- **Split Vertically**: the cell becomes an upper and a lower half. The control keeps the upper half (its height is halved) and the lower half is empty.
- **Split Horizontally**: the same, left and right. The control keeps the left half.
- Splitting a cell that spans several rows or columns splits the span. Otherwise a new row or column is added, and the other cells of that row or column stretch across both halves. The layout keeps its outer size.
- Splitting, then merging the two halves, gives back the original size. Each command is one undo step.
- Move Up and Move Down do nothing on a row crossed by a merged cell.

## Gridlines

**Gridlines** (Arrange › Table) draws lines on the edges of the selected controls' cells: **None**, **Both**, **Horizontal**, **Vertical**, **Top**, **Bottom**, **Outline**, plus **Width**, **Style** and **Color**.

- They are stored on each control (the Gridline Style, Width and Color properties, one per side).
- They are drawn in Design view, Layout view, Form view, Print Preview, print and PDF. A gridline does not change the control's size.
- Two adjacent cells each draw their own side.
- A control keeps its gridlines through a merge or a split.

## Control margins and padding

Both are dropdowns in the **Position** group: **None**, **Narrow**, **Medium**, **Wide**. The value is applied to the four sides of each selected control.

| Preset | None | Narrow | Medium | Wide |
|---|---|---|---|---|
| **Control Margins** (twips) | 0 | 22 | 45 | 90 |
| **Control Padding** (twips) | 0 | 30 | 90 | 180 |

- **Margins** are the space between the control's border and its text. Only the text moves; the cell keeps its size. They are in the Top, Bottom, Left and Right Margin properties.
- **Padding** is the space around the control inside its cell. It makes the row taller and the column wider, and so the layout too. It is in the Top, Bottom, Left and Right Padding properties.
- A column grows by the largest left and right padding among its cells, in all sections, so a Tabular header and its Detail control stay aligned. A row works the same way with top and bottom padding.
- New controls have no padding. A form or report saved before keeps its coordinates.

## Anchoring

**Anchoring** (Arrange › Position) is a 3 by 3 grid: Top Left, Stretch Down, Bottom Left; Stretch Across Top, Stretch Down and Across, Stretch Across Bottom; Top Right, Stretch Down and Right, Bottom Right. It sets the Horizontal Anchor and Vertical Anchor properties of the selected controls, in a layout or not.

Anchoring acts only in **Form view**, when the window is larger than the form, and follows the window live when you resize it.

- A control anchored right or bottom moves with that edge. A stretched one grows.
- In a layout, a column stretches when one of its members is stretched across, and a row when one is stretched down. Several stretching columns share the spare width equally. With nothing stretching, a member anchored right or bottom moves the whole layout with that edge.
- The rows and columns after a stretched one move.
- A control never gets smaller than its design size.
- A Single form gives the spare height to its Detail section. A Continuous form, a header and a footer use the spare width only.
- A tab control or a subform is anchored as one control. What is inside it is not.
- Design view, Layout view, Print Preview, print and PDF show the design size. Reports store the anchors but do not use them.

## Empty cells

An inserted row or column, a split, or a deleted control leaves **empty cells**. They are drawn as dotted rectangles in Design view and Layout view, and you can select and use them.

### Select

Click an empty cell. Ctrl+click adds cells or controls to the selection. **Select Row**, **Select Column** and **Select Layout** work from empty cells too, and include the empty cells of the row, column or layout.

### The Property Sheet

With only empty cells selected, the Property Sheet shows the type **Empty cell** and the cell's name:

- **EmptyCell1**, **EmptyCell2**... (CelluleVide1 in the French interface), numbered in layout order, then row by row, then column. The name is derived and read-only, so it renumbers when cells are added or filled.
- Format tab: Width, Height, Top, Left, Back Style, Back Color, Gridline Style, Width and Color, and the four paddings. Width sets the cell's column width and Height its row height. Top and Left are read-only.
- Other tab: Name (read-only) and Tag.

### Type in a cell

Select one empty cell and type. A **label** appears in the cell with the key you typed, and the caret stays in it.

- **Enter**, or leaving the field, commits the label. The label exists only once committed.
- **Escape** cancels, and so does committing an empty text. Nothing is left in the undo history.
- The label fills the cell and takes the cell's formatting. One undo step removes it.
- A report in Layout view has no typing in cells.

### Fill a cell

- Draw a control with the **Toolbox** or the controls gallery, with its centre in the cell. Only the kinds that can join a layout are accepted.
- Drag a field from the **Field List** onto the cell. A text box fills it, and its label goes into the cell on its left in a Stacked layout, or into the header cell above in a Tabular layout. The label is created only when that cell exists and is empty.
- Move a control that is not in a layout so that you release it inside the cell.
- Move a member of the same layout onto one of its empty cells. Its former cell becomes empty.

The control takes the cell's rectangle. A new control also takes the cell's stored formatting. A control you move keeps its own formatting, and the cell's is dropped.

### Format a cell

Back color, gridlines, padding and Tag are stored **on the cell** and work as on a control:

- **Gridlines** and **Control Padding** apply to selected empty cells. In a mixed selection they apply to both the controls and the cells. **Control Margins** and **Anchoring** do not apply to empty cells.
- The **Background Color** button colors an empty cell and makes its Back Style Normal. Through the Property Sheet, Back Color shows only when Back Style is Normal.
- An empty cell's padding counts in its column and row like a control's. A spanning cell's padding is ignored.
- Merging keeps the formatting of the top-left cell. Splitting copies it to both halves.
- When a control is deleted, its cell becomes empty with no formatting.

### Delete

**Delete** removes the selected controls. It also removes every layout row, and every layout column, whose every slot is selected, whether by an empty cell or by a control. Rows below and columns to the right move back. Selected empty cells that do not complete a row or column stay.

Deleting one field alone leaves an empty row. Select its row (**Select Row**) to remove it too. A layout left with no member disappears.

### What shows and prints

In Form view, Print Preview, print and PDF an empty cell draws only its back color and gridlines, and only when it has some. It has no focus and no tab stop, is not in `Controls` and has no field.

## Differences from Access and not supported

- Empty cells cannot be renamed: their name is derived.
- Empty cells are not reachable from events, macros or Python (`Controls("EmptyCell1")`).
- Empty cells cannot be copied and pasted.
- Gridlines use a plain color. Theme colors are not supported.
- A layout cannot contain another layout, a tab page or an option group.
- Anchoring has no effect in reports, nor in Design view, Layout view, Print Preview, print or PDF.
- Form view cell fills (the back color of an empty cell) do not follow anchoring.
- The width of an inserted column was not measured in Access: it copies its neighbour.
- Report Layout view has no page breaks and lays out the first 100 rows only.
