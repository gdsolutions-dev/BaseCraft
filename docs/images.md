# Images

BaseCraft keeps pictures in two ways: **embedded** in the control that shows them, or **shared** in the database's **image gallery**. Shared images are what you get from **Insert Image**, **Browse** and **Format > Background Image**.

## The shared gallery

The gallery is stored in the database file (table `bc_resources`). A control or a document refers to a gallery image **by name**, so replacing the image changes every form and report that uses it, with nothing to edit: open forms, layouts, designers and report previews refresh at once, and the PDF uses the new bytes.

An **embedded** picture (the *Picture* property holds the picture itself) belongs to one control only. The Logo command of the header group still embeds the file you choose.

Accepted files: **PNG, JPEG, GIF and WebP**, **1 MB (1 048 576 bytes) at most** per image. The type is checked from the file's content, not from its extension. SVG and any other format are refused with a message and nothing is stored.

A gallery image is named after its file (without the extension). If the name is taken (letter case ignored), BaseCraft adds ` (2)`, ` (3)`, ... and never overwrites. There is no rename: add the image again under the name you want.

## Insert Image and Browse

In the **Design** tab of a form or a report, **Insert Image** opens the **Image gallery**: a thumbnail per image (name under it), then **Browse...**.

- Click a thumbnail: the Image tool is armed with that image; draw the control on the form or report. Nothing is added until you draw.
- **Browse...**: choose a file. It is added to the gallery, then the tool is armed with it.
- **Right click** a thumbnail: **Replace image...** (keeps the name, takes the new file) or **Delete**. Deleting is refused while a saved form or report still uses the image; the message gives the number of objects. Unsaved open documents are not checked: an image they use and that no longer exists shows a placeholder in Design view and prints nothing, and the report warns about it.

In a database opened read-only the gallery opens and draws, but Browse, Replace and Delete are disabled.

## The Image control

In the Property Sheet an Image control has:

- **Picture type**: *Embedded* or *Shared*. Switching type clears the picture.
- **Picture**: a file (embedded) or a gallery image (shared).
- **Size Mode**: *Clip*, *Stretch* or *Zoom* (default *Zoom*).
- **Picture alignment**: top left, top right, center, bottom left, bottom right (default center).
- **Picture tiling**: repeats the picture at its natural size to fill the control (the size mode is then ignored).

## Background picture

**Format > Background Image** (forms and reports) opens the same gallery; **None** removes the background. The Property Sheet of the form or report has the five rows *Picture type*, *Picture*, *Picture tiling*, *Picture alignment* and *Picture size mode* (*Clip*, *Stretch*, *Zoom*, *Stretch horizontally*, *Stretch vertically*).

- On a **form**, the picture is drawn in **each section**, above the section's back color and under its controls. Alignment is relative to the section; *Form center* behaves as *center* of that section. Tiles restart at each section.
- On a **report**, the picture is drawn on **each page**, above the white page and under the bands and items. Alignment is relative to the page. The preview, the print HTML and the PDF all carry it.
- Tiling uses the picture's natural size, whatever the size mode.
- **Design view** shows the background under the grid of dots.

## Command button picture

A command button has **Picture type** and **Picture**. The picture is drawn before the caption, clipped and centered. If the shared image no longer exists, the button shows its caption alone. Reports never draw command buttons.

## Not supported yet

**Linked** pictures (a path to a file outside the database) do not exist yet; a document that says so reads as embedded. SVG is refused.

## Command line

```
basecraft-cli resources FILE.basecraft
```

prints the gallery as JSON: `[{ "name": "logo", "type": "png", "bytes": 1234 }]`. In a script (`basecraft-cli script SPEC FILE`) the operation `{ "op": "resource.add", "file": "logo.png", "name": "logo" }` adds an image (`name` is optional; same checks and unique naming; exit code 1 on refusal). `form.create` and `report.create` (with `layout: "doc"`) refuse a shared *Picture* that is not in the gallery.

## File format 1.4

The gallery needs **format 1.4**. BaseCraft upgrades an older database when you open it, after making a backup copy. An older BaseCraft opens a 1.4 database but ignores the gallery: shared images stay blank there (embedded ones are unaffected), so upgrade every workstation before you share a database.

Compact and Repair, Save As and the Runtime local copy carry the gallery. **Split Database** keeps it with the forms in the front-end; the back-end data file gets none.

## Limits

PNG, JPEG, GIF and WebP only; 1 MB per image; no rename and no linked pictures in this version.
