import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  Code2,
  Database,
  LoaderCircle,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Table2,
  XCircle,
} from 'lucide-react';
import { useCatalogData } from '../../hooks/useCatalogData';
import { duckdbWorkspace, WORKSPACE_CHANGED_EVENT, type QueryResult, type WorkspaceTable } from '../../lib/duckdb-workspace';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

type Cell = {
  id: string;
  sql: string;
  result?: QueryResult;
  error?: string;
  running?: boolean;
};

const EXAMPLE_SQL = `SELECT
  variety,
  grade,
  SUM(weight_kg) AS inventory_kg,
  SUM(bags) AS bags_on_hand
FROM happy_coffee.coffee_inventory
GROUP BY 1, 2
ORDER BY inventory_kg DESC;`;

function makeCell(sql = ''): Cell {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, sql };
}

function formatExpiry(expiresAt: Date | null) {
  if (!expiresAt) return 'Starting session…';
  const minutes = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 60_000));
  return `Resets in about ${minutes} min`;
}

function ResultGrid({ result }: { result: QueryResult }) {
  if (result.columns.length === 0) {
    return <p className="px-4 py-3 text-xs text-accent-700">Statement completed successfully.</p>;
  }

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-left text-xs">
        <thead className="bg-cream-50 text-cream-600">
          <tr>
            {result.columns.map((column) => (
              <th key={column.name} className="px-3 py-2 font-medium whitespace-nowrap border-b border-cream-200">
                <span className="text-cream-800">{column.name}</span>
                <span className="block text-[10px] font-normal text-cream-400 mt-0.5">{column.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-cream-100 text-cream-700">
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-cream-50">
              {result.columns.map((column) => (
                <td key={column.name} className="px-3 py-2 whitespace-nowrap max-w-64 truncate">
                  {row[column.name] === null || row[column.name] === undefined ? (
                    <span className="text-cream-400 italic">null</span>
                  ) : typeof row[column.name] === 'object' ? (
                    JSON.stringify(row[column.name])
                  ) : (
                    String(row[column.name])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DevelopmentWorkspace() {
  const { datasets } = useCatalogData();
  const [cells, setCells] = useState<Cell[]>(() => [makeCell(EXAMPLE_SQL)]);
  const [tables, setTables] = useState<WorkspaceTable[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMessage, setStatusMessage] = useState('Preparing your local DuckDB session…');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  useDocumentTitle('Develop with DuckDB');

  const refreshTables = useCallback(async () => {
    if (!datasets.length) return;
    const nextTables = await duckdbWorkspace.listTables(datasets);
    setTables(nextTables);
    setExpiresAt(duckdbWorkspace.getSessionInfo().expiresAt);
  }, [datasets]);

  useEffect(() => {
    if (!datasets.length) return;
    let cancelled = false;
    const initialize = async () => {
      try {
        setStatus('loading');
        setStatusMessage('Loading DuckDB and the Happy Coffee sample tables…');
        const session = await duckdbWorkspace.prepare(datasets);
        const nextTables = await duckdbWorkspace.listTables(datasets);
        if (cancelled) return;
        setTables(nextTables);
        setExpiresAt(session.expiresAt);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setStatusMessage(error instanceof Error ? error.message : 'DuckDB could not start in this browser.');
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, [datasets]);

  useEffect(() => {
    const handleWorkspaceChange = () => { void refreshTables(); };
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChange);
  }, [refreshTables]);

  const updateCell = (id: string, patch: Partial<Cell>) => {
    setCells((current) => current.map((cell) => cell.id === id ? { ...cell, ...patch } : cell));
  };

  const runCell = async (id: string) => {
    const cell = cells.find((item) => item.id === id);
    if (!cell || status !== 'ready') return;
    setActiveCellId(id);
    updateCell(id, { running: true, error: undefined });
    try {
      const result = await duckdbWorkspace.run(cell.sql, datasets);
      updateCell(id, { running: false, result });
      await refreshTables();
    } catch (error) {
      updateCell(id, { running: false, error: error instanceof Error ? error.message : 'Query execution failed.' });
    } finally {
      setActiveCellId(null);
    }
  };

  const resetSession = async () => {
    try {
      setStatus('loading');
      setStatusMessage('Resetting the local workspace…');
      await duckdbWorkspace.reset();
      const session = await duckdbWorkspace.prepare(datasets);
      const nextTables = await duckdbWorkspace.listTables(datasets);
      setTables(nextTables);
      setExpiresAt(session.expiresAt);
      setCells((current) => current.map((cell) => ({ ...cell, result: undefined, error: undefined })));
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'The workspace could not be reset.');
    }
  };

  const catalogTables = useMemo(() => tables.filter((table) => table.schema === 'happy_coffee'), [tables]);
  const workingTables = useMemo(() => tables.filter((table) => table.schema === 'workspace'), [tables]);

  return (
    <div className="min-h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Code2 className="w-5 h-5 text-brand-700" />
            <h1 className="text-2xl font-semibold text-cream-950">Develop</h1>
          </div>
          <p className="text-sm text-cream-500">Query Happy Coffee’s generated data and build temporary tables with DuckDB in your browser.</p>
        </div>
        <button
          type="button"
          onClick={() => void resetSession()}
          disabled={status === 'loading'}
          className="inline-flex self-start items-center gap-2 px-3 py-2 rounded-lg border border-cream-200 bg-white text-xs font-medium text-cream-600 hover:bg-cream-50 disabled:opacity-50 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset workspace
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_220px] border border-cream-200 rounded-xl shadow-card bg-white overflow-hidden min-h-[650px]">
        <aside className="border-b xl:border-b-0 xl:border-r border-cream-200 bg-cream-50/70 p-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-cream-600">Data explorer</h2>
            <button type="button" onClick={() => void refreshTables()} className="p-1 text-cream-500 hover:text-cream-800" title="Refresh tables">
              <RefreshCcw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-4 text-xs">
            <div>
              <p className="flex items-center gap-1.5 text-cream-700 font-medium mb-1.5"><Database className="w-3.5 h-3.5" /> happy_coffee</p>
              <div className="space-y-0.5">
                {catalogTables.map((table) => (
                  <button key={`${table.schema}.${table.name}`} type="button" onClick={() => setCells((current) => [...current, makeCell(`SELECT *\nFROM ${table.schema}.${table.name}\nLIMIT 25;`)])} className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-cream-600 hover:bg-white hover:text-cream-900">
                    <Table2 className="w-3.5 h-3.5 text-cream-400" /> <span className="truncate">{table.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-cream-700 font-medium mb-1.5"><Database className="w-3.5 h-3.5" /> workspace</p>
              <div className="space-y-0.5">
                {workingTables.length === 0 ? <p className="px-2 text-[11px] text-cream-400">No temporary tables yet</p> : workingTables.map((table) => (
                  <button key={`${table.schema}.${table.name}`} type="button" onClick={() => setCells((current) => [...current, makeCell(`SELECT *\nFROM ${table.schema}.${table.name}\nLIMIT 25;`)])} className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-cream-600 hover:bg-white hover:text-cream-900">
                    <Table2 className="w-3.5 h-3.5 text-accent-600" /> <span className="truncate">{table.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="bg-cream-50/40 p-3 sm:p-4 space-y-3 overflow-y-auto">
          {status === 'loading' && (
            <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
              <LoaderCircle className="w-4 h-4 animate-spin" /> {statusMessage}
            </div>
          )}
          {status === 'error' && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <XCircle className="w-4 h-4" /> {statusMessage}
            </div>
          )}
          {cells.map((cell, index) => (
            <article key={cell.id} className="border border-cream-200 rounded-lg bg-white overflow-hidden shadow-card">
              <div className="h-10 flex items-center justify-between border-b border-cream-100 px-3 bg-white">
                <span className="text-xs font-medium text-cream-600">SQL cell {index + 1}</span>
                <button type="button" onClick={() => void runCell(cell.id)} disabled={status !== 'ready' || cell.running} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-800 hover:text-brand-950 disabled:opacity-50">
                  {cell.running ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />} {cell.running ? 'Running' : 'Run'}
                </button>
              </div>
              <textarea
                aria-label={`SQL cell ${index + 1}`}
                value={cell.sql}
                onChange={(event) => updateCell(cell.id, { sql: event.target.value, result: undefined, error: undefined })}
                onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void runCell(cell.id); } }}
                spellCheck={false}
                className="block w-full min-h-36 resize-y border-0 bg-brand-950 px-4 py-3 font-mono text-xs leading-5 text-cream-100 outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
              />
              {cell.error && <div className="border-t border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 whitespace-pre-wrap">{cell.error}</div>}
              {cell.result && (
                <div className="border-t border-cream-200">
                  <div className="flex items-center justify-between px-3 py-2 text-[11px] text-cream-500 bg-cream-50">
                    <span>{cell.result.rowCount.toLocaleString()} row{cell.result.rowCount === 1 ? '' : 's'} {cell.result.truncated ? '(first 250 shown)' : ''}</span>
                    <span>{cell.result.elapsedMs} ms</span>
                  </div>
                  <ResultGrid result={cell.result} />
                </div>
              )}
            </article>
          ))}
          <button type="button" onClick={() => setCells((current) => [...current, makeCell()])} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-cream-600 hover:bg-cream-100 transition-colors">
            <Plus className="w-4 h-4" /> Add SQL cell
          </button>
        </section>

        <aside className="border-t xl:border-t-0 xl:border-l border-cream-200 p-4 space-y-5 bg-white">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-cream-600 mb-2">Session</h2>
            <div className="rounded-lg bg-cream-50 p-3 space-y-2 text-xs">
              <p className="flex items-center gap-2 text-accent-700"><CheckCircle2 className="w-3.5 h-3.5" /> {status === 'ready' ? 'DuckDB ready' : 'Starting DuckDB'}</p>
              <p className="flex items-center gap-2 text-cream-500"><Clock3 className="w-3.5 h-3.5" /> {formatExpiry(expiresAt)}</p>
            </div>
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-cream-600 mb-2">Try next</h2>
            <div className="space-y-2">
              <button type="button" onClick={() => setCells((current) => [...current, makeCell('SHOW TABLES;')])} className="w-full text-left rounded-lg border border-cream-200 px-3 py-2 text-xs text-cream-600 hover:bg-cream-50">List available tables</button>
              <button type="button" onClick={() => setCells((current) => [...current, makeCell(`CREATE TABLE workspace.inventory_by_origin AS\nSELECT origin, SUM(weight_kg) AS total_kg\nFROM happy_coffee.coffee_inventory\nGROUP BY origin;`)])} className="w-full text-left rounded-lg border border-cream-200 px-3 py-2 text-xs text-cream-600 hover:bg-cream-50">Create an inventory summary</button>
            </div>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs font-medium text-brand-900 mb-1">Agent-ready workspace</p>
            <p className="text-[11px] leading-4 text-brand-700">Ask an AI agent to open this workspace, query the catalog data, or create a temporary table. The same steps appear here as you work.</p>
          </div>
          {activeCellId && <p className="flex items-center gap-1.5 text-[11px] text-cream-500"><ChevronDown className="w-3.5 h-3.5" /> Executing cell…</p>}
        </aside>
      </div>
    </div>
  );
}
