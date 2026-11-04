# Python in BaseCraft

BaseCraft can run Python code, in place of the VBA you would write in Access. It gives you **modules** (files of Python functions), the **Immediate window** to try code on the spot, two ready-made dialogs (`msgbox` and `inputbox`), and Python that **reacts to events** and works on your **forms, reports and data** (see *Python in your application* below). Python in expressions comes in the next release (see the end of this page).

Python runs entirely inside BaseCraft. Nothing needs to be installed on your computer, and it works offline.

## Modules

A module is a named piece of Python code saved in your database, like a macro or a form.

1. Click **Create** › **Module**. An editor opens with a new module, `Module1`.
2. Type your code.
3. Press **Ctrl+S** and give the module a name. It now appears in the Navigation Pane under *Modules*. Double-click it to reopen it.

```python
def double(x):
    return x * 2
```

Things to know:

- **Names.** A module name is a valid Python name: letters, digits and `_`, not starting with a digit, and not a Python keyword (`class`, `if`...). BaseCraft tells you when the name is not accepted.
- **Modules can use each other.** If you saved a module called `Outils`, another module writes `import Outils` and calls `Outils.double(3)`.
- **Saving restarts the state of every module.** Variables a module held are forgotten each time you save any module, so a module never works from stale code. The variables you created in the Immediate window stay; after a save, names brought in with `from module import name` keep the old version until you import them again.
- **A standard Python name cannot be used.** A module called `math`, `random` or `json` is saved, but `import math` still gives you Python's own `math`, never yours. Choose another name.
- **A mistake in the code still saves.** If the code has a syntax error, the module is saved anyway and a bar under the editor shows the line and the message. Fix it and save again.
- If Python is not available at the moment you save, the module is saved too; its list of functions is simply not refreshed until the next save.

## The Immediate window

Press **Ctrl+G** (or **Create** › **Python Editor**) to open the Immediate window at the bottom of the screen. Press Ctrl+G again to hide it; its content is kept.

| You type | What happens |
|---|---|
| `?2+2` | Prints the value of the expression: `4` |
| `x = 5` | Runs the statement. `x` stays available for the next lines. |
| `import Outils` then `?Outils.double(21)` | Uses your modules: prints `42` |
| `?1/0` | Prints the error, here `ZeroDivisionError` |

Press the **Up** and **Down** arrows to bring back the lines you typed before.

The first line you run in a session takes a few seconds, while Python starts. The input is greyed out until it is ready.

If the Ctrl+G shortcut does nothing, the database's *Use Access special keys* option is off; use **Create** › **Python Editor** instead.

## Message boxes and input boxes

```python
answer = msgbox("Delete this?", "yes_no")
name = inputbox("Your name?")
```

`msgbox(prompt, buttons="ok", title="BaseCraft", icon=None)` shows a message and returns what the user clicked, as a word.

| `buttons` | Buttons shown | Possible answers |
|---|---|---|
| `"ok"` | OK | `ok` |
| `"ok_cancel"` | OK, Cancel | `ok`, `cancel` |
| `"yes_no"` | Yes, No | `yes`, `no` |
| `"yes_no_cancel"` | Yes, No, Cancel | `yes`, `no`, `cancel` |
| `"retry_cancel"` | Retry, Cancel | `retry`, `cancel` |
| `"abort_retry_ignore"` | Abort, Retry, Ignore | `abort`, `retry`, `ignore` |

`icon` can be `None` (default), `"critical"`, `"warning"`, `"question"` or `"information"`.

If the user closes the box without clicking a button (Escape or the close button), the answer is the same as clicking **Cancel** when there is one, otherwise **OK**, otherwise **No**; for Abort/Retry/Ignore it is `abort`.

`inputbox(prompt, title="BaseCraft", default="")` asks for a text and returns it, or `None` if the user cancels.

## Stopping a program: Ctrl+Break

If a program runs too long (`while True: pass`), the window is greyed out after two seconds and an **Interrupt** button appears. Click it or press **Ctrl+Break** (Ctrl+Pause on most keyboards): Python stops with `KeyboardInterrupt`.

While Python runs, the other keyboard shortcuts (Ctrl+S, F11...) do nothing. If Python still does not stop two seconds after the interruption, BaseCraft restarts it and tells you: the state held by your modules is then lost, your saved modules are not.

## Packages: numpy and pandas, offline

`numpy` and `pandas` (with their own requirements) come with BaseCraft; just `import numpy` or `import pandas`. They load the first time you import them, in a few seconds, and need no internet connection. No other package is available, and nothing can be installed.

## Python in your application

### Events: `=function(args)`

In the Property Sheet (Event tab), type a call instead of a macro name:

```
=remise([Prix]; [Client])
```

The name is a function exported by one of your modules (the module name is not needed). The arguments are ordinary BaseCraft expressions, evaluated when the event fires: `[Field]`, `[Forms]![F]![Control]`, `[TempVars]!x`, constants. In a French BaseCraft the separator is `;`; the call is stored the same way in every language.

You can also click **...** next to the event. On an empty event BaseCraft first asks **Choose Builder**: *Macro Builder* or *Function Builder*. The Function Builder lists every function of your modules as `Module.function(parameters)`; OK writes the call for you.

Things to know:

- The function's return value is ignored. An event that can be cancelled (Before Update, On Open...) is cancelled when the Python code fails, as for a failing macro, or when it calls `docmd.cancel_event()`.
- A name that is also a built-in expression function (`Left`, `Sum`...) is refused in the Property Sheet. Two modules exporting the same name are both saved; the module editor shows a warning, and the event reports the ambiguity when it fires.
- Like macros, Python events do nothing while content is disabled; the security bar comes back.
- Events that call each other (On Current moving the record, which fires On Current...) stop at the same depth limit as macros, with the same message.
- The **RunCode** macro action runs the same call (`FunctionName`: `remise([Prix])`, with or without the `=`). It needs enabled content.

### `me`

Inside a function run by an event, `me` is the form (or report) that fired it:

```python
def verifier():
    if me.Montant.value < 0:
        msgbox("Negative amount")
        docmd.cancel_event()
```

`me.Control.value` reads or writes a control; `me.name` is the form's name. Outside an event, `me` raises an error: use `forms["Name"]` instead.

### Object reference

Names of forms, reports and controls are used as stored and are not case-sensitive. `forms.Clients` works for names that are valid Python names and not a member of the object; otherwise write `forms["Nom client"]`.

| In Python | What it does |
|---|---|
| `forms["F"]`, `forms.F`, `"F" in forms`, `len(forms)`, `for name in forms` | The forms that are open. Asking for a form that is not open raises `KeyError`. |
| `form.name` | The form's name. |
| `form["C"].value`, `form.C.value` | Reads or writes a control's value. |
| `ctl.visible`, `enabled`, `locked`, `caption`, `fore_color`, `back_color`, `left`, `top`, `width`, `height` | Reads or writes the property of a control. |
| `form.requery(control=None)`, `go_to_record(record="next", offset=1)`, `go_to_control(name)`, `save_record()`, `undo_record()`, `delete_record()`, `refresh_record()`, `apply_filter(where)`, `show_all_records()` | The form's actions. `delete_record()` asks for confirmation as the user gets it. |
| `reports["R"]`, `reports.R`, `rpt["C"].value` | The reports that are open; reads a control's value. |
| `rpt["C"].visible = ...`, `rpt["C"].value = ...`, `rpt.section.visible = ...`, `rpt.section.height = ...` | In a report's On Format and On Print events only. |
| `me` | The form or report that fired the running event. |
| `screen.active_form`, `screen.active_control` | The active form and control (`None` when there is none). |
| `docmd.<action>(...)` | Runs a macro action (below). |
| `docmd.cancel_event()` | Cancels the event being handled (when it can be cancelled). |
| `docmd.run_macro("M")` | Runs a saved macro. |
| `tempvars["x"]`, `tempvars["x"] = v`, `del tempvars["x"]`, `"x" in tempvars`, `len(tempvars)`, `keys()`, `items()`, `clear()` | Temporary variables, shared with macros. An absent variable is `None`. |
| `app.current_project.name`, `app.quit()` | The open database's name; quits BaseCraft. |
| `db.open_recordset(source, params=None)`, `db.execute(sql, params=None)` | Data (below). |

Values go both ways as Python values: text, numbers, `True`/`False`, `None` (empty) and `datetime.datetime` for dates (a `datetime.date` is stored at midnight; numpy numbers are converted).

### `docmd`: macro actions

`docmd.open_form("F", where_condition="[Id] = 3")` runs the macro action OpenForm. The action name is written in snake case (`open_form`, `run_sql`, `go_to_record`, `set_warnings`); `close` stands for CloseWindow. Keyword arguments use the action's argument names the same way (`where_condition`); positional arguments follow the order of the macro builder. A required argument left out raises `TypeError`; a value that is not allowed raises an error naming the argument.

The same rules as a macro apply, including `docmd.set_warnings(False)`, which lasts for the Python call that made it.

A few actions have a Python equivalent and are refused with a message that names it: `SetValue` (a control's `.value`), `SetTempVar` and `RemoveTempVar` (`tempvars`), `RunMacro` (`docmd.run_macro()`), `MessageBox` (`msgbox()`), `CancelEvent` (`docmd.cancel_event()`), and the macro-flow actions (`StopMacro`, `OnError`, `RunCode`...).

**Dialog forms.** `docmd.open_form("F", window_mode="dialog")` opens the form as a dialog and the calling function **waits** until the dialog is closed. The dialog's own buttons run their Python events normally, nested inside the waiting call. When the dialog closes, the caller carries on and can read what the dialog left, for example in `tempvars`.

### Recordsets: `db`

```python
total = 0
for row in db.open_recordset("Commandes"):
    total += row["Montant"]
```

`db.open_recordset(source)` takes a table name, a saved query name, or SQL text starting with `SELECT`, `TRANSFORM` or `PARAMETERS` (then `params` supplies the parameters). Rows are read page by page, so large tables are fine.

| In Python | What it does |
|---|---|
| `for row in rs`, `len(rs)`, `rs.fields` | Walks the rows; `len(rs)` is the number of rows when the recordset was opened. |
| `row["Name"]`, `row.get("Name")`, `row.to_dict()` | Reads a row. |
| `row.update({"Name": value})`, `row.delete()` | Changes or deletes the row in the database. |
| `rs.add({"Name": value})` | Adds a record. |
| `rs.to_pandas()` | All rows as a `pandas.DataFrame`. pandas is loaded for you. |
| `db.execute(sql, params=None)` | Runs an action query (INSERT, UPDATE, DELETE...) without confirmation and returns the number of records. A SELECT raises an error. |

Writes follow the rules of the interface: a required field, a validation rule or a read-only query refuses the change with the same message, as a Python error (`BaseCraftError`), and nothing is half-written.

**Deleting while looping.** Deleting rows with `row.delete()` inside the `for` loop is safe: the loop does not skip the rows that follow. Deleting with `db.execute("DELETE ...")` during the loop is not compensated, so the loop may skip rows. Collect first, or run the query after the loop.

### Errors and « Debug »

When Python fails in an event, BaseCraft shows the **Python Error** box: the error type and message, `Module Calculs, line 3`, and the full traceback in a collapsible section. **Debug** opens the module in the editor with the cursor on that line, the line marked and the message in the bar under the editor. **End** closes the box. The event is cancelled when it can be.

Ctrl+Break stops the innermost running call, so a runaway button in a dialog form can be stopped while the caller keeps waiting and the dialog stays usable. A **RunCode** failure is the macro action's failure: handle it with *OnError*, or the Action Failed box appears, with **Debug** when the cause is a Python error. In the Runtime, which has no module editor, the box has no **Debug** button.

## What Python cannot do

Python in BaseCraft is a closed room:

- **No files.** It cannot read or write anything on your disk.
- **No network.** Any attempt to reach a web address fails with an error line.
- **No programs.** It cannot start other programs or reach the system.

It can use only what BaseCraft hands it: your modules, the standard library, numpy, pandas, `msgbox`, `inputbox`, and the BaseCraft objects described above (`forms`, `db`, `docmd`...), which follow the same rules as the interface.

## When content is disabled

Like macros, Python code is disabled in a database you have just opened until you click **Enable Content** in the security bar (or the file sits in a trusted folder). While content is disabled, nothing you wrote runs: not a module, not a line typed in the Immediate window. Python itself does not even start. You can still open and edit modules. Clicking **Enable Content** is enough; you do not need to reopen the database.

A database with no active content at all (nothing that would need to be enabled) lets you run code in the Immediate window freely.

## BaseCraft Runtime

The Runtime, which runs a database without design access, includes the Python engine, so modules keep working there. It has no module editor and no Immediate window.

## Size and memory

Python adds about **21.3 MB** of files to BaseCraft (the Python core 13.4 MB, numpy 3.0 MB, pandas 4.2 MB, and three small helper packages for pandas). The Windows installers measured for this release are 130.3 MB (BaseCraft) and 130.0 MB (BaseCraft Runtime).

BaseCraft itself starts as fast as before: Python is loaded only when needed. Loading Python's core adds about 130 MB of memory to the window; importing pandas adds about 150 MB more (measured in the test window with the editor and Immediate window open, so these are upper bounds for Python alone). When a database with modules is opened and content is enabled, BaseCraft prepares Python in the background a couple of seconds after opening, so that the first call is quick.

## What comes next

- **D3: Python in expressions.** Your functions in calculated controls on forms and reports, in macro conditions, and in a control's validation rule and default value; autocomplete on BaseCraft objects; *View Code* buttons.
- Still out of reach: code behind a form (`[Event Procedure]`), recordsets in the style of DAO (`find_first`, `edit`/`update`), exporting or importing files from Python (`docmd.output_to`, `transfer_*`), and Python in queries or table rules.
