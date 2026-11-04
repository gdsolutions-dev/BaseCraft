"""Recordsets over the bridge (R8): rows are read 1000 at a time."""
from ._bridge import call

PAGE = 1000


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
        return self._values[self._key(name)]

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
        self.updatable = info['updatable']
        self._total = info['total']

    def __len__(self):
        return self._total

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
