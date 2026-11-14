# Navigation Pane in BaseCraft

The Navigation Pane lists the objects of the open database: tables, queries, forms, reports, macros and modules. This page covers how to group, sort, filter and hide them.

## Categories

The **Navigation Pane header** (the title bar of the pane) opens a menu. Its **Navigate To Category** section picks how the objects are grouped:

| Category | What it shows |
|---|---|
| **Custom** | Your own groups (see below). |
| **Object Type** | One group per kind: Tables, Queries, Forms, Reports, Macros, Modules. |
| **Tables and Related Views** | One group per table. A group holds the table, then every object that depends on it, directly or through a query. Objects that depend on no table go in **Unrelated Objects**. An object appears in every group it belongs to. |
| **Created Date**, **Modified Date** | Today, Yesterday, Last Week, Two Weeks Ago, Three Weeks Ago, Last Month, Older. An object with no date is Older. Weeks start on Sunday in en-US, en-CA, ja, ko, zh-TW, pt-BR and he regions, on Saturday in ar and fa regions, and on Monday elsewhere. Last Week also covers the earlier days of the current week. |

Under **Filter By Group**, pick one group to show only it, or **All Access Objects** to show everything. The choice is kept for the next time you open the database.

Click a group heading to collapse or expand it. **Show All Groups** (background menu) expands every group again.

## The background menu

Right-click an empty part of the pane:

- **Category**: the same category choice as the header menu.
- **Sort By**: Sort Ascending or Descending, then Name, Type, Created Date or Modified Date. **Remove Automatic Sorts** goes back to the default order.
- **View By**: **Details** (name and type), **Icon** (large icons) or **List**.
- **Show All Groups**, **Paste**, **Navigation Options...** and **Search Bar** (show or hide the search box).

## Navigation Options

Open **Navigation Options...** from the background menu, or from File › Options › Current Database. The dialog has two parts.

**Grouping Options**

- Click a category to see its groups. Untick a group to hide it from the pane. You cannot hide the last visible group.
- For **Custom** categories you can add, rename and delete categories and groups, and move a category up or down. Custom categories reorder among themselves; the built-in categories stay first.
- Names must be unique among categories, and among the groups of a category.

**Display Options**

- **Show Hidden Objects**: shows objects marked Hidden, dimmed.
- **Show System Objects**: shown but disabled, see Limits.
- **Show Search Bar**.
- **Open Objects with**: **Single-click** or **Double-click**.

The options are saved in the database file, so each database has its own.

## Custom groups

1. In the Navigation Options dialog, add a custom category, then add groups to it.
2. Pick the category in the header menu.
3. Right-click an object and choose **Add to Group**, then a group, or **New Group...** to create one on the spot.

Objects you have not placed fall into **Unassigned Objects**. An object can be in several groups.

In a custom group:

- **Delete** removes the object from that group only. The object itself stays.
- **Hide in this Group** hides the object in that group only; other groups still show it. With **Show Hidden Objects** on, the hidden object appears dimmed and its menu offers **Unhide**.
- Renaming or deleting an object keeps the groups in step.

## Hidden objects

In **Properties** (right-click an object), tick **Hidden** to hide it from every category. Show it again with **Show Hidden Objects**, or untick **Hidden**.

## Read-only databases and the Runtime

- On a **read-only** database, your category, filter, sort and View By changes last for the session and are not saved. Navigation Options and group edits are refused with the read-only message.
- In the **Runtime** (run mode), there is no **Tables and Related Views** category: it falls back to Object Type. The background menu has no **Paste** or **Navigation Options...**.
- The header menu still opens when default shortcut menus are turned off.

## Limits

- Show System Objects is not available yet.
- You cannot drag an object into a group; use **Add to Group**.
- Access's own navigation groups are not imported with an Access file.
- Two workstations on the same shared database read the options when they open it. There is no live sync; the last save wins.
