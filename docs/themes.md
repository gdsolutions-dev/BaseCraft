# Themes, Colors and Fonts

A **theme** is a set of colors and fonts that gives your forms and reports one consistent look. BaseCraft ships six themes (BaseCraft, Ardoise, Forêt, Sable, Océan, Prune) and lets you make your own.

A theme has two halves, each with its own name:

- a **color scheme**: 12 colors (Background 1 and 2, Text 1 and 2, Accent 1 to 6, Hyperlink, Followed Hyperlink), each in a **light** and a **dark** version;
- a **font scheme**: a **Headings** font and a **Body** font, always chosen among the fonts BaseCraft embeds, so a PDF looks the same on every computer.

## The galleries

In the **Design** and **Layout** views of a form or a report, the **Themes** group of the ribbon has three buttons: **Themes**, **Colors** and **Fonts**. Each opens a gallery with three sections: *In this database* (what the object uses now, marked), *Custom* (your own themes) and the built-in set. **Colors** changes only the colors and keeps the fonts; **Fonts** changes only the fonts and keeps the colors.

## The three actions

- **Left click** on an item applies it to **all matching objects**: it becomes the database default and every form (or every report, depending on where you are) that had its own theme goes back to following it. Open forms or reports get the change as one edit you can undo with Ctrl+Z, and are saved with your next Ctrl+S.
- **Right click** lists all the actions:
  - *Apply to All Matching Objects* (same as left click);
  - *Apply to This Object Only*: the object keeps its own theme, saved with it. One undo step;
  - *Set as Default for This Database*: changes the default only. Objects that have their own theme keep it.

Forms and reports are separate: applying a theme from a form never changes your reports, and the other way round. Nothing is disabled because of unsaved changes. In a database opened read-only the galleries still open so you can look, but nothing can be applied.

## Customize

At the bottom of the **Colors** and **Fonts** galleries, **Customize Colors...** and **Customize Fonts...** open a dialog that edits a copy. In *Customize Colors*, each color has a Light and a Dark column; the Dark column follows the Light one until you edit it. **OK** applies the result to this object only; **Save** stores it as one of your themes; **Cancel** leaves the object untouched.

## Your themes

**Save Current Theme...** at the bottom of the Themes gallery stores the theme in use under a name you choose (a name already used asks before replacing it; built-in names are refused). The *Custom* section lists them; right click one and choose **Delete** to remove it. Saving from *Customize Colors* or *Customize Fonts* adds a theme in the same way.

Your themes are kept with your Windows/macOS/Linux user account, not in the database. Applying one copies it into the database or the object, so a database opened on another computer keeps its look.

## Using theme colors and fonts on controls

In the Property Sheet and in the color picker, a color can be a theme color (for example *Accent 2, Lighter 80%*); it then follows the theme when you change it. A color typed as `#rrggbb` never changes. For fonts, choose `(Headings)` or `(Body)`; new controls use `(Body)`.

## Dark mode

A form follows the application's light or dark mode and uses the matching version of the palette. In a dark palette, *Background 1* is a dark color and *Text 1* a light one: the names describe the role, not the lightness.

**Reports are always light**: the report preview, the PDF and printing always use the light palette, whatever mode the application is in.
