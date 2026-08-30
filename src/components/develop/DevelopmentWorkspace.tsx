import { useCallback, useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import {
  CheckCircle2, ChevronDown, Clock3, Code2, Database, Download,
  LoaderCircle, PanelLeftClose, PanelLeftOpen, Play, Plus, RefreshCcw,
  RotateCcw, Search, Table2, X, XCircle,
} from 'lucide-react';
import { useCatalogData } from '../../hooks/useCatalogData';
import {
  duckdbWorkspace, WORKSPACE_CHANGED_EVENT, type QueryResult, type WorkspaceTable,
} from '../../lib/duckdb-workspace';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import clsx from 'clsx';

type Cell = { id: string; sql: string; result?: QueryResult; error?: string; running?: boolean };
type Notebook = { id: string; name: string; cells: Cell[] };

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

function makeNotebook(name: string, sql = ''): Notebook {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, cells: [makeCell(sql)] };
}

function formatExpiry(expiresAt: Date | null) {
  if (!expiresAt) return 'Starting session…';
  return `Resets in ${Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 60_000))} min`;
}

function formatCell(value: unknown) {
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (value === null || value === undefined) return 'null';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function ResultGrid({ result }: { result: QueryResult }) {
  if (result.columns.length === 0) {
    return <p className="px-4 py-3 text-xs text-accent-700">Statement completed successfully.</p>;
  }

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <table className="w-full min-w-max text-left text-xs">
        <thead className="sticky top-0 z-10 bg-[#f8fafc] text-cream-600 shadow-[0_1px_0_#e5e5e5]">
          <tr>
            <th className="w-10 px-3 py-2 text-right font-normal text-cream-400">#</th>
            {result.columns.map((column) => (
              <th key={column.name} className="px-3 py-2 font-medium whitespace-nowrap">
                <span className="text-cream-800">{column.name}</span>
                <span className="ml-1.5 text-[10px] font-normal text-cream-400">{column.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-cream-100 text-cream-700">
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-blue-50/40">
              <td className="px-3 py-2 text-right text-[10px] text-cream-400">{rowIndex + 1}</td>
              {result.columns.map((column) => (
                <td key={column.name} className="max-w-72 px-3 py-2 whitespace-nowrap truncate">
                  {row[column.name] === null || row[column.name] === undefined
                    ? <span className="italic text-cream-400">null</span>
                    : formatCell(row[column.name])}
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
  const [notebooks, setNotebooks] = useState<Notebook[]>(() => [makeNotebook('Inventory analysis', EXAMPLE_SQL)]);
  const [activeNotebookId, setActiveNotebookId] = useState(() => notebooks[0].id);
  const [activeCellId, setActiveCellId] = useState(() => notebooks[0].cells[0].id);
  const [tables, setTables] = useState<WorkspaceTable[]>([]);
  const [explorerQuery, setExplorerQuery] = useState('');
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [catalogExpanded, setCatalogExpanded] = useState(true);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMessage, setStatusMessage] = useState('Preparing your local DuckDB session…');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [resultSearch, setResultSearch] = useState('');
  useDocumentTitle('Develop with DuckDB');

  const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? notebooks[0];
  const activeCell = activeNotebook.cells.find((cell) => cell.id === activeCellId) ?? activeNotebook.cells[0];

  const updateNotebook = (id: string, update: (notebook: Notebook) => Notebook) => {
    setNotebooks((current) => current.map((notebook) => notebook.id === id ? update(notebook) : notebook));
  };

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
        setStatusMessage('Loading DuckDB and Happy Coffee sample tables…');
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
    const handleWorkspaceChange = () => {
      void refreshTables();
    };
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChange);
  }, [refreshTables]);

  const updateCell = (id: string, patch: Partial<Cell>) => {
    updateNotebook(activeNotebookId, (notebook) => ({
      ...notebook,
      cells: notebook.cells.map((cell) => cell.id === id ? { ...cell, ...patch } : cell),
    }));
  };

  const addCell = (sql = '') => {
    const nextCell = makeCell(sql);
    updateNotebook(activeNotebookId, (notebook) => ({ ...notebook, cells: [...notebook.cells, nextCell] }));
    setActiveCellId(nextCell.id);
  };

  const addNotebook = () => {
    const notebook = makeNotebook(`Untitled query ${notebooks.length + 1}`);
    setNotebooks((current) => [...current, notebook]);
    setActiveNotebookId(notebook.id);
    setActiveCellId(notebook.cells[0].id);
  };

  const closeNotebook = (id: string) => {
    if (notebooks.length === 1) return;
    const remaining = notebooks.filter((notebook) => notebook.id !== id);
    setNotebooks(remaining);
    if (activeNotebookId === id) {
      setActiveNotebookId(remaining[0].id);
      setActiveCellId(remaining[0].cells[0].id);
    }
  };

  const runCell = async (id: string) => {
    const cell = activeNotebook.cells.find((item) => item.id === id);
    if (!cell || status !== 'ready') return;
    setActiveCellId(id);
    updateCell(id, { running: true, error: undefined });
    try {
      const result = await duckdbWorkspace.run(cell.sql, datasets);
      updateCell(id, { running: false, result });
      setResultSearch('');
      await refreshTables();
    } catch (error) {
      updateCell(id, { running: false, error: error instanceof Error ? error.message : 'Query execution failed.' });
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
      setNotebooks((current) => current.map((notebook) => ({
        ...notebook,
        cells: notebook.cells.map((cell) => ({ ...cell, result: undefined, error: undefined })),
      })));
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'The workspace could not be reset.');
    }
  };

  const catalogTables = useMemo(
    () => tables.filter((table) => table.schema === 'happy_coffee' && table.name.includes(explorerQuery.toLowerCase())),
    [tables, explorerQuery],
  );
  const workingTables = useMemo(
    () => tables.filter((table) => table.schema === 'workspace' && table.name.includes(explorerQuery.toLowerCase())),
    [tables, explorerQuery],
  );
  const visibleResult = useMemo(() => {
    if (!activeCell?.result || !resultSearch.trim()) return activeCell?.result;
    const query = resultSearch.toLowerCase();
    return {
      ...activeCell.result,
      rows: activeCell.result.rows.filter((row) => Object.values(row).some((value) => formatCell(value).toLowerCase().includes(query))),
    };
  }, [activeCell?.result, resultSearch]);

  return (
    <div className="-m-4 sm:-m-6 h-screen min-h-[640px] overflow-hidden bg-[#f7f8fa] text-cream-900 flex flex-col">
      <header className="h-14 flex items-center justify-between border-b border-cream-200 bg-white px-4 sm:px-5 flex-shrink-0">
        <div className="flex items-center min-w-0">
          <div className="mr-3 flex h-7 w-7 items-center justify-center rounded bg-brand-900 text-white"><Code2 className="w-4 h-4" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h1 className="text-sm font-semibold text-cream-900">Develop</h1><span className="hidden sm:inline text-xs text-cream-400">/ DuckDB workspace</span></div>
            <p className="hidden md:block text-[11px] text-cream-500">Browser-local SQL development for Happy Coffee data</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx('hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]', status === 'ready' ? 'bg-emerald-50 text-emerald-700' : 'bg-cream-100 text-cream-500')}>
            {status === 'loading' ? <LoaderCircle className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} {status === 'ready' ? 'DuckDB ready' : 'Starting'}
          </span>
          <button type="button" onClick={() => void resetSession()} disabled={status === 'loading'} className="inline-flex items-center gap-1.5 rounded-md border border-cream-200 px-2.5 py-1.5 text-xs font-medium text-cream-600 hover:bg-cream-50 disabled:opacity-50">
            <RotateCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </header>

      <div className="min-h-0 flex flex-1">
        <aside className={clsx('hidden lg:flex flex-shrink-0 flex-col border-r border-cream-200 bg-white transition-[width] duration-200', explorerCollapsed ? 'w-12' : 'w-64')}>
          {explorerCollapsed ? (
            <div className="flex flex-col items-center gap-3 pt-3">
              <button type="button" onClick={() => setExplorerCollapsed(false)} aria-label="Expand catalog" title="Expand catalog" className="rounded-md p-2 text-cream-500 hover:bg-cream-100 hover:text-cream-800"><PanelLeftOpen className="w-4 h-4" /></button>
              <Database className="w-4 h-4 text-brand-600" />
            </div>
          ) : <>
            <div className="border-b border-cream-100 p-3">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-semibold text-cream-700">Catalog</h2><div className="flex items-center gap-2"><button type="button" onClick={() => void refreshTables()} title="Refresh tables" className="text-cream-500 hover:text-cream-800"><RefreshCcw className="w-3.5 h-3.5" /></button><button type="button" onClick={() => setExplorerCollapsed(true)} aria-label="Collapse catalog" title="Collapse catalog" className="text-cream-500 hover:text-cream-800"><PanelLeftClose className="w-3.5 h-3.5" /></button></div></div>
              <label className="flex items-center gap-2 rounded-md border border-cream-200 bg-cream-50 px-2 py-1.5 text-cream-400 focus-within:border-brand-400 focus-within:bg-white"><Search className="w-3.5 h-3.5" /><input value={explorerQuery} onChange={(event) => setExplorerQuery(event.target.value)} placeholder="Filter tables" className="w-full bg-transparent text-xs text-cream-700 outline-none placeholder:text-cream-400" /></label>
            </div>
            <div className="flex-1 overflow-y-auto p-2 text-xs scrollbar-thin">
              <button type="button" onClick={() => setCatalogExpanded((value) => !value)} className="flex w-full items-center gap-1.5 rounded px-2 py-2 text-left font-medium text-cream-700 hover:bg-cream-50"><ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', !catalogExpanded && '-rotate-90')} /><Database className="w-3.5 h-3.5 text-brand-600" /> happy_coffee <span className="ml-auto text-[10px] text-cream-400">{catalogTables.length}</span></button>
              {catalogExpanded && <div className="mb-2 ml-2 border-l border-cream-200 py-1">{catalogTables.map((table) => <button key={`${table.schema}.${table.name}`} type="button" onClick={() => addCell(`SELECT *\nFROM ${table.schema}.${table.name}\nLIMIT 25;`)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-cream-600 hover:bg-blue-50 hover:text-blue-800"><Table2 className="w-3.5 h-3.5 text-cream-400" /><span className="truncate">{table.name}</span></button>)}</div>}
              <button type="button" onClick={() => setWorkspaceExpanded((value) => !value)} className="flex w-full items-center gap-1.5 rounded px-2 py-2 text-left font-medium text-cream-700 hover:bg-cream-50"><ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', !workspaceExpanded && '-rotate-90')} /><Database className="w-3.5 h-3.5 text-accent-600" /> workspace <span className="ml-auto text-[10px] text-cream-400">{workingTables.length}</span></button>
              {workspaceExpanded && <div className="ml-2 border-l border-cream-200 py-1">{workingTables.length ? workingTables.map((table) => <button key={`${table.schema}.${table.name}`} type="button" onClick={() => addCell(`SELECT *\nFROM ${table.schema}.${table.name}\nLIMIT 25;`)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-cream-600 hover:bg-emerald-50 hover:text-emerald-800"><Table2 className="w-3.5 h-3.5 text-accent-600" /><span className="truncate">{table.name}</span></button>) : <p className="px-3 py-1.5 text-[11px] text-cream-400">No temporary tables</p>}</div>}
            </div>
            <div className="border-t border-cream-200 px-3 py-2 text-[11px] text-cream-500"><span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" /> {formatExpiry(expiresAt)}</span></div>
          </>}
        </aside>

        <main className="min-w-0 flex flex-1 flex-col bg-white">
          <div className="flex h-10 items-end gap-0 border-b border-cream-200 bg-[#f5f6f8] px-2 overflow-x-auto scrollbar-thin">
            {notebooks.map((notebook) => <div key={notebook.id} className={clsx('group flex h-10 min-w-[150px] items-center gap-2 border-r border-cream-200 px-3 text-xs', notebook.id === activeNotebookId ? 'border-t-2 border-t-blue-500 bg-white font-medium text-cream-900' : 'text-cream-500 hover:bg-cream-100')}><button type="button" onClick={() => { setActiveNotebookId(notebook.id); setActiveCellId(notebook.cells[0].id); }} className="min-w-0 flex-1 truncate text-left">{notebook.name}</button>{notebooks.length > 1 && <button type="button" onClick={() => closeNotebook(notebook.id)} className="opacity-0 group-hover:opacity-100 hover:text-cream-900"><X className="w-3.5 h-3.5" /></button>}</div>)}
            <button type="button" onClick={addNotebook} title="New query tab" className="mb-1 ml-1 rounded p-1.5 text-cream-500 hover:bg-cream-200 hover:text-cream-800"><Plus className="w-4 h-4" /></button>
          </div>
          {status === 'error' && <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700"><XCircle className="w-4 h-4" /> {statusMessage}</div>}
          {status === 'loading' && <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-700"><LoaderCircle className="w-4 h-4 animate-spin" /> {statusMessage}</div>}
          <section className="min-h-0 flex flex-1 flex-col overflow-y-auto bg-[#fbfcfd] p-3 sm:p-4 scrollbar-thin">
            <div className="mx-auto w-full max-w-6xl space-y-3">
              {activeNotebook.cells.map((cell, index) => <article key={cell.id} onClick={() => setActiveCellId(cell.id)} className={clsx('overflow-hidden rounded-lg border bg-white shadow-card transition-shadow', cell.id === activeCellId ? 'border-blue-400 shadow-[0_0_0_1px_rgba(59,130,246,0.12)]' : 'border-cream-200')}>
                <div className="flex h-10 items-center justify-between border-b border-cream-100 bg-white px-3"><div className="flex items-center gap-2"><span className="font-mono text-[11px] text-cream-400">{index + 1}</span><span className="text-xs font-medium text-cream-600">SQL</span></div><button type="button" onClick={() => void runCell(cell.id)} disabled={status !== 'ready' || cell.running} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{cell.running ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}{cell.running ? 'Running' : 'Run'} <span className="hidden sm:inline text-blue-200">⌘↵</span></button></div>
                <CodeMirror value={cell.sql} height="200px" theme={oneDark} extensions={[sql(), keymap.of([{ key: 'Mod-Enter', run: () => { void runCell(cell.id); return true; } }])]} onChange={(value) => updateCell(cell.id, { sql: value, result: undefined, error: undefined })} basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: true }} />
                {cell.error && <div className="border-t border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 whitespace-pre-wrap">{cell.error}</div>}
              </article>)}
              <button type="button" onClick={() => addCell()} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-cream-600 hover:bg-cream-100"><Plus className="w-3.5 h-3.5" /> Add SQL cell</button>
            </div>
          </section>
          <section className="h-[38%] min-h-[230px] flex-shrink-0 border-t border-cream-300 bg-white flex flex-col">
            <div className="flex h-10 items-center border-b border-cream-200 px-3"><div className="flex h-full items-center border-b-2 border-blue-600 text-xs font-medium text-blue-700">Results {activeCell?.result ? `(${activeCell.result.rowCount.toLocaleString()})` : ''}</div><div className="ml-auto flex items-center gap-2">{activeCell?.result && <><span className="hidden sm:inline text-[11px] text-cream-500">{activeCell.result.elapsedMs} ms{activeCell.result.truncated ? ' · first 250 rows' : ''}</span><label className="hidden md:flex items-center gap-1.5 rounded border border-cream-200 px-2 py-1 text-cream-400"><Search className="w-3 h-3" /><input value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} placeholder="Search results" className="w-28 bg-transparent text-[11px] text-cream-700 outline-none" /></label><button type="button" title="CSV export is planned" className="text-cream-400 hover:text-cream-700"><Download className="w-3.5 h-3.5" /></button></>}</div></div>
            <div className="min-h-0 flex-1">{visibleResult ? <ResultGrid result={visibleResult} /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-cream-400"><Table2 className="w-5 h-5" /><p className="text-xs">Run the active SQL cell to view results.</p></div>}</div>
          </section>
        </main>

      </div>
    </div>
  );
}
