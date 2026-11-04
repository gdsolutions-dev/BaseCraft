# Python in BaseCraft

BaseCraft can run Python code, in place of the VBA you would write in Access. This first release (D1) gives you **modules** (files of Python functions), the **Immediate window** to try code on the spot, and two ready-made dialogs, `msgbox` and `inputbox`. Python reacting to form and report events, and reading or writing your data, come in the next releases (see the end of this page).

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

## What Python cannot do

Python in BaseCraft is a closed room:

- **No files.** It cannot read or write anything on your disk.
- **No network.** Any attempt to reach a web address fails with an error line.
- **No programs.** It cannot start other programs or reach the system.

It can use only what BaseCraft hands it: your modules, the standard library, numpy, pandas, `msgbox` and `inputbox`.

## When content is disabled

Like macros, Python code is disabled in a database you have just opened until you click **Enable Content** in the security bar (or the file sits in a trusted folder). While content is disabled, nothing you wrote runs: not a module, not a line typed in the Immediate window. Python itself does not even start. You can still open and edit modules. Clicking **Enable Content** is enough; you do not need to reopen the database.

A database with no active content at all (nothing that would need to be enabled) lets you run code in the Immediate window freely.

## BaseCraft Runtime

The Runtime, which runs a database without design access, includes the Python engine, so modules keep working there. It has no module editor and no Immediate window.

## Size and memory

Python adds about **21.3 MB** of files to BaseCraft (the Python core 13.4 MB, numpy 3.0 MB, pandas 4.2 MB, and three small helper packages for pandas). The Windows installers measured for this release are 130.3 MB (BaseCraft) and 130.0 MB (BaseCraft Runtime).

BaseCraft itself starts as fast as before: Python is loaded only when needed. Loading Python's core adds about 130 MB of memory to the window; importing pandas adds about 150 MB more (measured in the test window with the editor and Immediate window open, so these are upper bounds for Python alone). When a database with modules is opened and content is enabled, BaseCraft prepares Python in the background a couple of seconds after opening, so that the first call is quick.

## What comes next

- **D2: Python in your application.** Python reacting to events (a button click, Before Update), functions in event properties, objects for forms, reports and the database (`forms`, `reports`, `me`, `db` with recordsets), and dialog forms.
- **D3: Python in expressions.** Your functions in calculated controls on forms and reports, in macro conditions, and in a control's validation rule and default value; autocomplete on BaseCraft objects; *View Code* buttons.
