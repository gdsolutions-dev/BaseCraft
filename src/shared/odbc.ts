// External Data › Import › ODBC Database (C4): what the dialog sends. Exactly one of `dsn` (a data source name) and `connection`
// (a connection string without the login) is non-empty; the login is kept apart and never written anywhere.
export interface OdbcRequest { dsn: string; connection: string; user: string; password: string }
export const MAX_ODBC = { dsn: 256, connection: 4096, user: 256, password: 1024 } as const;
