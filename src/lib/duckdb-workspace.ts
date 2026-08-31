import * as duckdb from '@duckdb/duckdb-wasm';
import type { Dataset } from '../data/types';

const SESSION_TTL_MS = 90 * 60 * 1000;
const MAX_RESULT_ROWS = 250;
export const WORKSPACE_CHANGED_EVENT = 'happy-coffee-workspace-changed';

export type WorkspaceTable = {
  schema: string;
  name: string;
  type: string;
};

export type QueryResult = {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  elapsedMs: number;
  truncated: boolean;
};

export type WorkspaceRunOptions = {
  notify?: boolean;
  source?: 'user' | 'agent';
};

function valueForDisplay(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) {
    const words = Array.from(value as unknown as ArrayLike<number>);
    return words.reduceRight((total, word) => (total << 32n) + BigInt(word >>> 0), 0n).toString();
  }
  if (Array.isArray(value)) return value.map(valueForDisplay);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, valueForDisplay(nestedValue)]),
    );
  }
  return value;
}

function tableRows(table: { toArray: () => unknown[] }): Record<string, unknown>[] {
  return table.toArray().slice(0, MAX_RESULT_ROWS).map((row) => valueForDisplay(row) as Record<string, unknown>);
}

function validateIdentifier(name: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${label} must start with a letter or underscore and contain only letters, numbers, or underscores.`);
  }
  return name;
}

function validateSchema(name: string): 'happy_coffee' | 'workspace' {
  if (name !== 'happy_coffee' && name !== 'workspace') {
    throw new Error('Schema must be happy_coffee or workspace.');
  }
  return name;
}

class DuckDBWorkspace {
  private db: duckdb.AsyncDuckDB | null = null;
  private connection: duckdb.AsyncDuckDBConnection | null = null;
  private seededDataKey: string | null = null;
  private expiresAt = 0;
  private expiryTimer: number | null = null;

  private scheduleExpiry() {
    this.expiresAt = Date.now() + SESSION_TTL_MS;
    if (this.expiryTimer !== null) window.clearTimeout(this.expiryTimer);
    this.expiryTimer = window.setTimeout(() => {
      void this.reset();
    }, SESSION_TTL_MS);
  }

  private async connect() {
    if (this.connection) return this.connection;
    if (!this.db) {
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts('${bundle.mainWorker}');`], { type: 'text/javascript' }),
      );
      const worker = new Worker(workerUrl);
      this.db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      try {
        await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      } finally {
        URL.revokeObjectURL(workerUrl);
      }
    }
    this.connection = await this.db.connect();
    return this.connection;
  }

  private async seedCatalog(datasets: Dataset[]) {
    const connection = await this.connect();
    const dataKey = datasets.map((dataset) => `${dataset.id}:${dataset.sampleData.length}`).join('|');
    if (this.seededDataKey === dataKey) return;

    await connection.query('CREATE SCHEMA IF NOT EXISTS happy_coffee');
    await connection.query('CREATE SCHEMA IF NOT EXISTS workspace');

    for (const dataset of datasets) {
      const tableName = validateIdentifier(dataset.name, 'Catalog table name');
      const fileName = `happy-coffee-${dataset.id}.json`;
      await this.db!.registerFileText(fileName, JSON.stringify(dataset.sampleData));
      await connection.query(
        `CREATE OR REPLACE TABLE happy_coffee.${tableName} AS SELECT * FROM read_json_auto('${fileName}')`,
      );
    }
    this.seededDataKey = dataKey;
    this.scheduleExpiry();
  }

  async prepare(datasets: Dataset[]) {
    if (Date.now() >= this.expiresAt && this.db) await this.reset();
    await this.seedCatalog(datasets);
    return this.getSessionInfo();
  }

  async run(sql: string, datasets: Dataset[], options: WorkspaceRunOptions = {}): Promise<QueryResult> {
    if (!sql.trim()) throw new Error('Write a SQL statement before running it.');
    await this.prepare(datasets);
    const startedAt = performance.now();
    const table = await this.connection!.query(sql);
    const rows = tableRows(table);
    const rowCount = Number(table.numRows);
    this.scheduleExpiry();
    if (options.notify !== false) {
      window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT, {
        detail: { source: options.source ?? 'user', sql },
      }));
    }
    return {
      columns: table.schema.fields.map((field) => ({ name: field.name, type: field.type.toString() })),
      rows,
      rowCount,
      elapsedMs: Math.round(performance.now() - startedAt),
      truncated: rowCount > MAX_RESULT_ROWS,
    };
  }

  async listTables(datasets: Dataset[]): Promise<WorkspaceTable[]> {
    const result = await this.run(
      `SELECT table_schema AS schema, table_name AS name, table_type AS type
       FROM information_schema.tables
       WHERE table_schema IN ('happy_coffee', 'workspace')
       ORDER BY table_schema, table_name`,
      datasets,
      { notify: false },
    );
    return result.rows.map((row) => ({
      schema: String(row.schema),
      name: String(row.name),
      type: String(row.type),
    }));
  }

  async describeTable(schema: string, name: string, datasets: Dataset[]) {
    const tableSchema = validateSchema(schema);
    const tableName = validateIdentifier(name, 'Table name');
    const result = await this.run(
      `SELECT column_name AS name, data_type AS type, is_nullable AS nullable, ordinal_position AS position
       FROM information_schema.columns
       WHERE table_schema = '${tableSchema}' AND table_name = '${tableName}'
       ORDER BY ordinal_position`,
      datasets,
      { notify: false },
    );
    return result.rows;
  }

  async previewTable(schema: string, name: string, datasets: Dataset[], limit = 25, offset = 0) {
    const tableSchema = validateSchema(schema);
    const tableName = validateIdentifier(name, 'Table name');
    const boundedLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_RESULT_ROWS);
    const boundedOffset = Math.max(0, Math.floor(offset));
    return this.run(
      `SELECT * FROM ${tableSchema}.${tableName} LIMIT ${boundedLimit} OFFSET ${boundedOffset}`,
      datasets,
      { notify: false },
    );
  }

  async createTable(name: string, selectSql: string, datasets: Dataset[], source: WorkspaceRunOptions['source'] = 'user') {
    const tableName = validateIdentifier(name, 'Table name');
    if (!/^\s*(select|with)\b/i.test(selectSql)) {
      throw new Error('The table definition must begin with SELECT or WITH.');
    }
    await this.run(`CREATE OR REPLACE TABLE workspace.${tableName} AS ${selectSql}`, datasets, { source });
    return `workspace.${tableName}`;
  }

  getSessionInfo() {
    return {
      expiresAt: this.expiresAt ? new Date(this.expiresAt) : null,
      ttlMinutes: SESSION_TTL_MS / 60,
    };
  }

  async reset() {
    if (this.expiryTimer !== null) window.clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.expiresAt = 0;
    this.seededDataKey = null;
    await this.connection?.close();
    this.connection = null;
    await this.db?.terminate();
    this.db = null;
  }
}

export const duckdbWorkspace = new DuckDBWorkspace();
export { SESSION_TTL_MS };
