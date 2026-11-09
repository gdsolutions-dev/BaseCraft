# Charts

A **chart** is a control that draws the result of a grouped query: totals of a field by category, optionally split by a second field. It lives on a form or a report, is saved with it, takes its colors from the object's theme (see [Themes](themes.md)) and is printed in the report PDF.

## Insert Modern Chart

In the **Design** tab of a form or a report, **Insert Modern Chart** opens a menu of chart families. Pick a type, then draw the control on the form or report. Nothing is added until you draw. The **Chart Settings** pane opens on the right as soon as a chart is selected (also **Design > Tools > Chart Settings**).

| Family | Types |
|---|---|
| Column | clustered, stacked, 100 % stacked |
| Bar | clustered, stacked, 100 % stacked |
| Line | line, stacked, 100 % stacked |
| Area | clustered, stacked, 100 % stacked |
| Pie | pie |
| Radar | radar, filled radar |
| Combo | combo (each series is a column, a line or an area) |

That is 16 types in all. The type can be changed later in the Property Sheet (*Chart type*) without losing the data settings.

In a database opened read-only the pane opens and shows the settings, but nothing can be changed.

## Chart Settings: Data tab

- **Data Source**: a table or a query (radios *Tables*, *Queries*, *Both*, then the list). Left empty, the chart uses the record source of its own form or report.
- **Axis (categories)**: tick one or more fields. With several fields, each combination is one category, labelled `A / B`. When the first axis field is a date, a **Date grouping** list appears: *none*, *year* (`2026`), *quarter* (`2026-Q1`), *month* (`2026-03`) or *day* (`2026-03-15`). Grouping is done by the query and sorts chronologically.
- **Legend (series)**: pick one field, or none. Each value of that field becomes a series. A pie ignores the legend and draws one slice per axis category.
- **Values (Y axis)**: tick the fields to plot. Click a value's label to pick its aggregate: *None*, *Sum*, *Average*, *Minimum*, *Maximum* or *Count*. The default is *Sum*.

Series are named `SumOf<Field>`, `AvgOf<Field>`, `MinOf<Field>`, `MaxOf<Field>` and `CountOf<Field>` (these prefixes stay in English in every language, as in Access). With a Legend field, series carry the legend values instead.

**None** plots each record as it is (no grouping), in source order. If *None* is mixed with other aggregates in the same chart, it acts as *Sum*.

## Chart Settings: Format tab

The Format tab edits one **data series** at a time, chosen in the list at the top (the series are the chart's Values):

- **Full name**: replaces the default series name (tooltips, axis titles, trendline names). Not used with a Legend field, nor on a pie or radar.
- **Series type** (Combo only): *Column*, *Line* or *Area*.
- **Plot series on**: *Primary* or *Secondary* axis. A second value axis appears on the right as soon as one series is secondary.
- **Series fill color** and **Series border color**: theme colors or any color.
- **Show data label**.
- **Trendline options**: *None*, *Linear*, *Exponential*, *Logarithmic*, *Polynomial*, *Power*, *Moving average*, and a trendline name. A trendline is drawn as an extra dashed series, `Name (Linear)` by default.
- **Line options** (line, area and combo): width, style (solid, dashed, dotted), markers, and how missing values are drawn (gap, as zero, connected).

Every change is one step of Ctrl+Z. Controls that have no effect on the current chart (Full name, fill, border, data labels, trendline and Line options with a Legend field; the same on a pie or radar where they do not apply) are disabled with a short hint (see the limits below).

## Property Sheet

Select the chart and open the Property Sheet. The **Format** tab has the chart's own rows:

- *Chart type*, the title and subtitle with their on/off switches, *Has legend*, *Legend position*, *Has axis titles* with the horizontal and vertical axis titles;
- font size and color for the title, subtitle, legend and axes; only the title also has a font name;
- *Value axis format*, *Value axis range* (*Auto* or *Manual*, with minimum and maximum), *display units* (hundreds, thousands, millions, billions), and the same rows for the **secondary axis**;
- *Background style* (*Normal* or *Transparent*), background color, border style, border color and border width.

The **Data** rows (source, axis, *Date grouping*, *Legend (series)*, values and series) are shown as a read-only summary: they are edited in Chart Settings.

## Link Master/Child

Like a subform, a chart in a **form** can follow the current record: set **Link Master Fields** (fields of the form's record) and **Link Child Fields** (fields of the chart's source). The chart then draws only the rows whose child fields equal the master fields of the current record. Values travel as query parameters, so a quote in a name is only a value.

- On a record with no matching rows the chart shows a placeholder.
- On a new record (no master value) the chart is empty.
- The two lists must have the same number of fields, otherwise the chart shows the message "Link Master/Child fields do not match".
- The link rows exist for charts on **forms** only (a report chart does not show them).
- The chart is drawn again after the record is saved and on **Requery** (Shift+F9, or the `Requery` macro action; F5 is the record-number box, not Requery).
- Name AutoCorrect follows renames of the fields in `ChartSource`, `ChartAxis`, `ChartLegend`, `ChartValues`, `ChartSeries` and in the link fields.

## Charts in reports and PDF

A chart is drawn in the report's Design, Layout and Print Preview views and in the PDF. The printed chart is **deterministic**: the same data gives the same SVG, byte for byte, so two exports of the same report match. The report's Layout view, Print Preview and the PDF always use the **light palette** of the theme and the embedded fonts (a non-portable font prints as Liberation Sans), whatever the app's dark mode. The report **Design** view and forms follow the app's light or dark mode.

Copy a chart from a form and paste it into a report (or the other way round): the settings travel with it.

## Limits and differences from Access

- At most **5000 points** are drawn; beyond that a hint tells you the chart is truncated.
- At most **8 Axis fields**, **1 Legend field** and **16 Values**.
- *None* mixed with other aggregates acts as *Sum*.
- With a **Legend** field only the **first Value** is plotted. Per-series Full name, fill, border, data labels, trendline and Line options (width, style, markers, missing values) do not apply (they are disabled); the series type and axis of the first Value do. A Legend with a secondary axis puts **all** series on the secondary axis.
- A **pie** draws only the first Value (and ignores the Legend field). A **radar** draws a missing value as 0.
- The **secondary axis** is ignored for stacked charts and for horizontal bars (and has no meaning for pie and radar).
- *Background style* defaults to **transparent** (Access: Standard).
- *Axis format* accepts simple patterns only: `#,##0`, `0.00`, with a prefix or a suffix. Separators are always English (`1,000.50`) whatever the interface language; `0%` appends a "%" without multiplying by 100; any other pattern is ignored (the display units still apply). A manual range whose minimum is not below its maximum is ignored.
- **100 % types**: each category's total is the sum of the absolute values and each share keeps its sign; the value axis is fixed at 0 to 100 % (down to -100 % if a value is negative) and the tooltip shows the real value. *Axis format* and the manual range are ignored on 100 % charts.
- The moving average has period 2 and the polynomial trendline degree 2. Every trendline needs at least 2 points (polynomial: 3). Logarithmic, exponential and power trendlines need every value to be positive; otherwise no trendline is drawn.
- **Trendlines are not drawn** on stacked charts, horizontal bars, pie, radar, nor with a Legend field.
- A **radar** with negative values widens its scale below zero.
- A save in a **subform** does not redraw the chart of the main form: press **Requery** (Shift+F9).
- Charts in **reports** have no Link Master/Child (they always draw the whole source).
- The **tooltip** exists on screen only, never in print.
- A database that contains charts needs **this version of BaseCraft or a newer one** (the file format number is unchanged; an older BaseCraft cannot read the chart control).

## Command line

- `basecraft-cli charts FILE.basecraft` lists the charts of a database as JSON: the object (kind and name), the control, the chart type and the source.
- `form.create` and `report.create` accept `chart` controls in their `doc` only with `layout: 'doc'`, through `basecraft-cli script SPEC.json FILE`. The same checks as the app apply: an unknown field, an unknown `ChartType`, a `ChartValues` entry without a field, a malformed `ChartSeries` entry (or one whose field is not in `ChartValues`) or an invalid format property (`ChartBorderStyle`, `AxisUnits`, `AxisSec*`...) is refused with a message that names the control. A refusal exits with code 1, a usage error (missing or invalid spec file, missing database) with code 2. `LinkMasterFields` and `LinkChildFields` are accepted without any check.

## Bundle size

Charts use Apache ECharts 6.1.0 (and its rendering library zrender), bundled with the application; nothing is loaded from the network. Only the chart modules BaseCraft needs are included. Measured with esbuild, they add about **620 KB minified** to the renderer (the project's own renderer build is not minified, so the file on disk is larger). The licences (Apache-2.0 and BSD-3-Clause) are listed in the licences file shipped with the application.
