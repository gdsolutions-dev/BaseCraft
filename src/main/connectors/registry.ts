// The server connectors by `bc_sources.kind` (C4 R1). A kind not here is `unsupportedKind`, as an older BaseCraft reports it.
import type { Connector, ServerKind } from './connector';
import { postgresql } from './postgres';
import { sqlserver } from './sqlserver';

export { isServerKind } from './connector';

export type ConnectorRegistry = Partial<Record<ServerKind, Connector>>;
export const CONNECTORS: ConnectorRegistry = { postgresql, sqlserver };
