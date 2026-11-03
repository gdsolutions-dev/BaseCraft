// The part of `pg` 8.23.1's API BaseCraft uses (pg ships no types; @types/pg would be one more dependency).
declare module 'pg' {
  import type { EventEmitter } from 'node:events';
  import type { ConnectionOptions } from 'node:tls';

  export type TypeParser = (oid: number, format?: 'text' | 'binary') => (value: string) => unknown;
  export interface ClientConfig {
    host?: string; port?: number; database?: string; user?: string; password?: string; ssl?: boolean | ConnectionOptions;
    connectionTimeoutMillis?: number; statement_timeout?: number; application_name?: string; types?: { getTypeParser: TypeParser };
  }
  export interface FieldDesc { name: string; dataTypeID: number; dataTypeModifier: number }
  export interface QueryResult<R> { rows: R[]; rowCount: number | null; fields: FieldDesc[] }
  export class Client extends EventEmitter {
    constructor(config?: ClientConfig);
    connect(): Promise<void>;
    query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
    query(config: { text: string; values?: unknown[]; rowMode: 'array' }): Promise<QueryResult<unknown[]> | QueryResult<unknown[]>[]>; // an array: several statements
    readonly processID: number | null; readonly secretKey: number | null; // the cancel key (BackendKeyData)
    end(): Promise<void>;
  }
  const pg: { Client: typeof Client; types: { getTypeParser: TypeParser } };
  export default pg;
}
