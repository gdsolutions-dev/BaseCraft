"""Recordsets over the bridge (R8): rows are read 1000 at a time."""
import base64

from ._bridge import call
from .errors import BaseCraftError

PAGE = 1000


class Attachment:
    """One file of an Attachment cell: `name`, `type` (lowercase extension), `size`, `data` (bytes, read when first used), `save_to(path)`."""

    def __init__(self, where, info):
        self._where, self._id = where, info['id']
        self.name, self.type, self.size = info['name'], info['type'], info['bytes']
        self._data = None

    @property
    def data(self):
        if self._data is None:
            self._data = base64.b64decode(call('db.attachmentData', [*self._where, self._id]))
        return self._data

    def save_to(self, path):
        """Writes the file to `path` (absolute; a program or script file, or a file that exists, is refused)."""
        call('db.attachmentSave', [*self._where, self._id, str(path)])

    def __repr__(self):
        return f'<Attachment {self.name!r} {self.size} bytes>'


class Row:
    def __init__(self, rs, values, rowid, pos=None, gone=None):
        self._rs, self._values, self._rowid = rs, values, rowid
        self._pos, self._gone = pos, gone  # position seen by the iterator, and its set of deleted positions

    def _key(self, name):
        if name in self._values:
            return name
        for k in self._values:
            if k.casefold() == str(name).casefold():
                return k
        raise KeyError(name)

    def __getitem__(self, name):
        key = self._key(name)
        if self._rs._types.get(key) == 'attachment':  # the files of the cell, not the count the datasheet shows
            if not self._values[key] or self._rowid is None:
                return []
            where = [self._rs._handle, self._rowid, key]
            return [Attachment(where, i) for i in call('db.attachments', where)]
        return self._values[key]

    def get(self, name, default=None):
        try:
            return self[name]
        except KeyError:
            return default

    def to_dict(self):
        return dict(self._values)

    def update(self, values):
        values = {self._key(k): v for k, v in values.items()}
        call('db.save', [self._rs._handle, self._rowid, values])
        self._values.update(values)

    def delete(self):
        call('db.delete', [self._rs._handle, self._rowid])
        if self._gone is not None:
            self._gone.add(self._pos)


class Recordset:
    def __init__(self, info):
        self._handle = info['handle']
        self.fields = [f['name'] for f in info['fields']]
        self._types = {f['name']: f['type'] for f in info['fields']}
        self.updatable = info['updatable']
        self._total = info['total']
        # DAO cursor (separate from `for row in rs`): position, current row, pending edit values (None: not editing)
        self._pos, self._cur, self._edit, self._new, self._deleted, self._fresh = 0, None, None, False, False, False

    def __len__(self):
        return self._total

    # ---- DAO-style cursor: move_*, eof/bof, rs["Name"], edit/add_new/update/cancel_update/delete ----
    # ponytail: one row fetched per move (db.page limit 1); batch it if a loop over a huge table is too slow.
    def _load(self):
        page = call('db.page', [self._handle, self._pos, 1]) if 0 <= self._pos < self._total else {'rows': []}
        self._cur = Row(self, dict(zip(self.fields, page['rows'][0])), page['rowids'][0]) if page['rows'] else None
        self._fresh = True

    def _ensure(self):  # the first row is read on first use, so a loop with `for row in rs` costs nothing more
        if not self._fresh:
            self._load()

    def _go(self, pos):
        if self._edit is not None:
            raise BaseCraftError('Move without Update or CancelUpdate: finish the edit first')
        self._pos, self._deleted = max(-1, min(pos, self._total)), False
        self._load()

    @property
    def eof(self):
        self._ensure()
        return self._cur is None and self._pos >= self._total

    @property
    def bof(self):
        self._ensure()
        return self._cur is None and self._pos < 0

    @property
    def record_count(self):
        return self._total

    def move_first(self):
        self._go(0)

    def move_last(self):
        self._go(self._total - 1)

    def move_next(self):
        self._go(self._pos if self._deleted else self._pos + 1)  # after delete(), the next row has taken the position

    def move_previous(self):
        self._go(self._pos - 1)

    def _row(self):
        self._ensure()
        if self._cur is None or self._deleted:
            raise BaseCraftError('No current record')
        return self._cur

    def _known(self, name):
        for f in self.fields:
            if f.casefold() == str(name).casefold():
                return f
        raise KeyError(name)

    def __getitem__(self, name):
        if self._edit is not None and self._new:
            return self._edit.get(self._known(name))
        if self._edit is not None and self._known(name) in self._edit:
            return self._edit[self._known(name)]
        return self._row()[name]

    def __setitem__(self, name, value):
        if self._edit is None:
            raise BaseCraftError('Update or CancelUpdate without AddNew or Edit: call edit() or add_new() first')
        self._edit[self._known(name)] = value

    def edit(self):
        self._row()
        self._edit, self._new = {}, False

    def add_new(self):
        if self._edit is not None:
            raise BaseCraftError('Finish the current edit with update() or cancel_update() first')
        self._edit, self._new = {}, True

    def update(self):
        if self._edit is None:
            raise BaseCraftError('Update or CancelUpdate without AddNew or Edit')
        values, new = self._edit, self._new
        call('db.save', [self._handle, None if new else self._row()._rowid, values])  # a refused change raises: the edit stays open
        self._edit, self._new = None, False
        if new:
            self._total += 1
        else:
            self._load()

    def cancel_update(self):
        self._edit, self._new = None, False

    def delete(self):
        row = self._row()
        if self._edit is not None:
            raise BaseCraftError('Cannot delete during an edit')
        call('db.delete', [self._handle, row._rowid])
        self._total -= 1
        self._deleted, self._cur = True, None

    def __iter__(self):
        # Positions are those of the table before any delete; each page is requested at
        # next - (rows deleted through this loop's rows before it), since a delete shifts later rows down.
        # Deletes made by other means during the loop (e.g. db.execute) are not compensated.
        gone, nxt = set(), 0
        while True:
            offset = nxt - sum(1 for p in gone if p < nxt)
            page = call('db.page', [self._handle, offset, PAGE])
            for values, rowid in zip(page['rows'], page['rowids']):
                yield Row(self, dict(zip(self.fields, values)), rowid, nxt, gone)
                nxt += 1
            if len(page['rows']) < PAGE:
                return

    def add(self, values):
        call('db.save', [self._handle, None, values])

    def to_pandas(self):
        import pandas
        return pandas.DataFrame([r.to_dict() for r in self], columns=self.fields)


class Db:
    def open_recordset(self, source, params=None):
        return Recordset(call('db.open', [source, params]))

    def execute(self, sql, params=None):
        return call('db.execute', [sql, params])


db = Db()
