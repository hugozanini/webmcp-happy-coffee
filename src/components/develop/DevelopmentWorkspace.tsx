import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { EditorView, keymap } from '@codemirror/view';
import {
  AlertTriangle, CheckCircle2, ChevronDown, Clock3, Code2, Database, Download,
  LoaderCircle, PanelBottomClose, PanelBottomOpen, PanelLeftClose, PanelLeftOpen, Play, Plus, RefreshCcw,
  RotateCcw, Search, Table2, Trash2, X, XCircle,
} from 'lucide-react';
import { useCatalogData } from '../../hooks/useCatalogData';
import { duckdbWorkspace, WORKSPACE_CHANGED_EVENT, type QueryResult, type WorkspaceTable } from '../../lib/duckdb-workspace';
import {
  registerDevelopmentActionHandler, type DevelopmentBridgeAction, type DevelopmentBridgeResult,
} from '../../lib/development-bridge';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useLiveState } from '../../hooks/useLiveState';
import { useNavigate } from 'react-router-dom';
import type { Dataset, EphemeralPublicationBundle, Pipeline, PipelineRun, QualityEntry } from '../../data/types';
import clsx from 'clsx';

type QualitySeverity = QualityEntry['severity'];
type QualityExecution = { result: 'Passed' | 'Warning' | 'Failed'; violations: number; elapsedMs: number; ranAt: Date };
type QualityConfig = { name: string; description: string; severity: QualitySeverity };
type Cell = {
  id: string;
  sql: string;
  kind: 'query' | 'quality';
  quality?: QualityConfig;
  qualityExecution?: QualityExecution;
  result?: QueryResult;
  error?: string;
  running?: boolean;
};
type Notebook = { id: string; name: string; cells: Cell[] };
type BottomTab = 'results' | 'publishing';
type PublishingDraft = {
  sourceCellId: string;
  name: string;
  displayName: string;
  description: string;
  owner: string;
  tags: string;
  criticality: Dataset['criticality'];
  frequency: string;
  cron: string;
  transformations: string;
  includedQualityCellIds: string[];
  fieldDescriptions: Record<string, string>;
};

const EXAMPLE_SQL = `SELECT
  variety,
  grade,
  SUM(weight_kg) AS inventory_kg,
  SUM(bags) AS bags_on_hand
FROM happy_coffee.coffee_inventory
GROUP BY 1, 2
ORDER BY inventory_kg DESC;`;

const softSqlTheme = EditorView.theme({
  '&': { backgroundColor: '#f3f4f6', color: '#262626' },
  '.cm-content': { caretColor: '#2563eb' },
  '.cm-gutters': { backgroundColor: '#eef0f2', color: '#a3a3a3', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#e8edf5' },
  '.cm-activeLineGutter': { backgroundColor: '#e8edf5' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#bfdbfe' },
});

const DEFAULT_OUTPUT_PANEL_HEIGHT = 'h-[42%] min-h-[190px]';
const MIN_OUTPUT_PANEL_HEIGHT = 190;
const MIN_EDITOR_HEIGHT = 240;
const OUTPUT_PANEL_HEIGHT_STORAGE_KEY = 'happy-coffee:develop-output-panel-height';

function readSavedOutputPanelHeight(): number | null {
  if (typeof window === 'undefined') return null;
  const value = Number(window.sessionStorage.getItem(OUTPUT_PANEL_HEIGHT_STORAGE_KEY));
  return Number.isFinite(value) && value >= MIN_OUTPUT_PANEL_HEIGHT ? value : null;
}

function makeCell(sql = '', kind: Cell['kind'] = 'query', id?: string): Cell {
  return {
    id: id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sql,
    kind,
    quality: kind === 'quality' ? { name: 'Untitled quality check', description: '', severity: 'Warning' } : undefined,
  };
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

function displayNameFor(name: string) {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cronForFrequency(frequency: string) {
  return ({ Manual: '', Hourly: '0 * * * *', Daily: '0 6 * * *', Weekly: '0 6 * * 1' } as Record<string, string>)[frequency] ?? '';
}

function qualityOutcome(violations: number, severity: QualitySeverity): QualityExecution['result'] {
  if (violations === 0) return 'Passed';
  return severity === 'Info' || severity === 'Warning' ? 'Warning' : 'Failed';
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

function QualityExecutionCard({ execution, severity }: { execution: QualityExecution; severity: QualitySeverity }) {
  const passed = execution.result === 'Passed';
  const warned = execution.result === 'Warning';
  const Icon = passed ? CheckCircle2 : AlertTriangle;
  return (
    <div className={clsx(
      'flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs',
      passed ? 'border-emerald-100 bg-emerald-50/70' : warned ? 'border-amber-100 bg-amber-50/70' : 'border-red-100 bg-red-50/70',
    )}>
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={clsx('h-4 w-4 flex-shrink-0', passed ? 'text-emerald-600' : warned ? 'text-amber-600' : 'text-red-600')} />
        <span className="font-medium text-cream-800">{passed ? 'Check passed' : warned ? 'Check warned' : 'Check failed'}</span>
        <span className="truncate text-cream-500">{execution.violations.toLocaleString()} {execution.violations === 1 ? 'violation' : 'violations'} · {severity}</span>
      </div>
      <span className="whitespace-nowrap text-[11px] text-cream-500">{execution.elapsedMs} ms</span>
    </div>
  );
}

export function DevelopmentWorkspace() {
  const { datasets, publishEphemeralBundle, clearEphemeralBundles } = useCatalogData();
  const navigate = useNavigate();
  // State the WebMCP bridge reads is held in useLiveState so that chained agent
  // actions observe each other without waiting for a re-render.
  const [notebooks, setNotebooks, notebooksRef] = useLiveState<Notebook[]>(() => [makeNotebook('Inventory analysis', EXAMPLE_SQL)]);
  const [activeNotebookId, setActiveNotebookId, activeNotebookIdRef] = useLiveState(() => notebooks[0].id);
  const [activeCellId, setActiveCellId, activeCellIdRef] = useLiveState(() => notebooks[0].cells[0].id);
  const [tables, setTables, tablesRef] = useLiveState<WorkspaceTable[]>([]);
  const [explorerQuery, setExplorerQuery] = useState('');
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [catalogExpanded, setCatalogExpanded] = useState(true);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
  const [status, setStatus, statusRef] = useLiveState<'loading' | 'ready' | 'error'>('loading');
  const [statusMessage, setStatusMessage] = useState('Preparing your local DuckDB session…');
  const [expiresAt, setExpiresAt, expiresAtRef] = useLiveState<Date | null>(null);
  const [resultSearch, setResultSearch] = useState('');
  const [bottomTab, setBottomTab, bottomTabRef] = useLiveState<BottomTab>('results');
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number | null>(readSavedOutputPanelHeight);
  const outputPanelRef = useRef<HTMLElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publicationError, setPublicationError] = useState('');
  const [publishedDatasetId, setPublishedDatasetId, publishedDatasetIdRef] = useLiveState<string | null>(null);
  const [draft, setDraft, draftRef] = useLiveState<PublishingDraft>(() => ({
    sourceCellId: '', name: 'inventory_summary', displayName: 'Inventory Summary',
    description: 'A curated inventory summary developed in the Happy Coffee workspace.', owner: 'Analytics',
    tags: 'workspace, curated', criticality: 'Medium', frequency: 'Daily', cron: '0 6 * * *',
    transformations: 'Aggregates Happy Coffee inventory by variety and grade.', includedQualityCellIds: [], fieldDescriptions: {},
  }));
  useDocumentTitle('Develop with DuckDB');

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const setPreferredOutputPanelHeight = useCallback((height: number) => {
    const preferredHeight = Math.max(MIN_OUTPUT_PANEL_HEIGHT, Math.round(height));
    setBottomPanelHeight(preferredHeight);
    window.sessionStorage.setItem(OUTPUT_PANEL_HEIGHT_STORAGE_KEY, String(preferredHeight));
  }, []);

  const startOutputPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeCleanupRef.current?.();

    const panel = outputPanelRef.current;
    const workspace = panel?.parentElement;
    if (!panel || !workspace) return;

    const startY = event.clientY;
    const startHeight = panel.getBoundingClientRect().height;
    const maximumHeight = Math.max(MIN_OUTPUT_PANEL_HEIGHT, workspace.getBoundingClientRect().height - MIN_EDITOR_HEIGHT);
    const resize = (moveEvent: PointerEvent) => {
      const nextHeight = Math.min(maximumHeight, Math.max(MIN_OUTPUT_PANEL_HEIGHT, startHeight + startY - moveEvent.clientY));
      setPreferredOutputPanelHeight(nextHeight);
    };
    const stop = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      resizeCleanupRef.current = null;
    };

    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    resizeCleanupRef.current = stop;
  }, [setPreferredOutputPanelHeight]);

  const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? notebooks[0];
  const activeCell = activeNotebook.cells.find((cell) => cell.id === activeCellId) ?? activeNotebook.cells[0];

  const updateNotebook = useCallback((id: string, update: (notebook: Notebook) => Notebook) => {
    setNotebooks((current) => current.map((notebook) => notebook.id === id ? update(notebook) : notebook));
  }, [setNotebooks]);

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

  const updateCellInNotebook = useCallback((notebookId: string, id: string, patch: Partial<Cell>) => {
    updateNotebook(notebookId, (notebook) => ({
      ...notebook,
      cells: notebook.cells.map((cell) => cell.id === id ? { ...cell, ...patch } : cell),
    }));
  }, [updateNotebook]);

  const updateCell = (id: string, patch: Partial<Cell>) => updateCellInNotebook(activeNotebookId, id, patch);

  const setCellKind = (id: string, kind: Cell['kind']) => {
    updateCell(id, {
      kind,
      quality: kind === 'quality'
        ? activeNotebook.cells.find((cell) => cell.id === id)?.quality ?? { name: `Quality check ${activeNotebook.cells.findIndex((cell) => cell.id === id) + 1}`, description: '', severity: 'Warning' }
        : undefined,
      qualityExecution: kind === 'quality' ? activeNotebook.cells.find((cell) => cell.id === id)?.qualityExecution : undefined,
    });
  };

  const updateQualityConfig = (id: string, patch: Partial<QualityConfig>) => {
    const cell = activeNotebook.cells.find((item) => item.id === id);
    if (!cell?.quality) return;
    updateCell(id, { quality: { ...cell.quality, ...patch } });
  };

  const addCell = (sql = '') => {
    const nextCell = makeCell(sql);
    updateNotebook(activeNotebookId, (notebook) => ({ ...notebook, cells: [...notebook.cells, nextCell] }));
    setActiveCellId(nextCell.id);
  };

  const deleteCell = (id: string) => {
    updateNotebook(activeNotebookId, (notebook) => {
      const remainingCells = notebook.cells.filter((cell) => cell.id !== id);
      if (activeCellId === id) setActiveCellId(remainingCells[0]?.id ?? '');
      return { ...notebook, cells: remainingCells };
    });
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
      setActiveCellId(remaining[0].cells[0]?.id ?? '');
    }
  };

  const executeCell = useCallback(async (notebookId: string, id: string): Promise<{ result?: QueryResult; error?: string }> => {
    const notebook = notebooksRef.current.find((item) => item.id === notebookId);
    const cell = notebook?.cells.find((item) => item.id === id);
    if (!cell) return { error: 'Cell not found.' };
    if (statusRef.current !== 'ready') return { error: 'DuckDB is still starting. Try again when the workspace is ready.' };
    setActiveCellId(id);
    updateCellInNotebook(notebookId, id, { running: true, error: undefined });
    try {
      const result = await duckdbWorkspace.run(cell.sql, datasets);
      const execution = cell.kind === 'quality' && cell.quality
        ? {
          result: qualityOutcome(result.rowCount, cell.quality.severity),
          violations: result.rowCount,
          elapsedMs: result.elapsedMs,
          ranAt: new Date(),
        } satisfies QualityExecution
        : undefined;
      updateCellInNotebook(notebookId, id, { running: false, result, qualityExecution: execution });
      setResultSearch('');
      await refreshTables();
      return { result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Query execution failed.';
      updateCellInNotebook(notebookId, id, { running: false, error: message });
      return { error: message };
    }
  }, [datasets, notebooksRef, statusRef, refreshTables, setActiveCellId, updateCellInNotebook]);

  const runCell = async (id: string) => executeCell(activeNotebookId, id);

  const resetSession = useCallback(async () => {
    try {
      setStatus('loading');
      setStatusMessage('Resetting the local workspace…');
      await duckdbWorkspace.reset();
      clearEphemeralBundles();
      const session = await duckdbWorkspace.prepare(datasets);
      const nextTables = await duckdbWorkspace.listTables(datasets);
      setTables(nextTables);
      setExpiresAt(session.expiresAt);
      setNotebooks((current) => current.map((notebook) => ({
        ...notebook,
        cells: notebook.cells.map((cell) => ({ ...cell, result: undefined, error: undefined, qualityExecution: undefined })),
      })));
      setPublishedDatasetId(null);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'The workspace could not be reset.');
    }
  }, [clearEphemeralBundles, datasets, setExpiresAt, setNotebooks, setPublishedDatasetId, setStatus, setTables]);

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

  const sourceCells = useMemo(
    () => activeNotebook.cells.filter((cell) => cell.kind === 'query' && /^\s*(select|with)\b/i.test(cell.sql)),
    [activeNotebook.cells],
  );
  const qualityCells = useMemo(
    () => activeNotebook.cells.filter((cell) => cell.kind === 'quality'),
    [activeNotebook.cells],
  );
  const selectedSource = sourceCells.find((cell) => cell.id === draft.sourceCellId) ?? sourceCells[0];
  const selectedQualityCells = qualityCells.filter((cell) => draft.includedQualityCellIds.includes(cell.id));

  useEffect(() => {
    setDraft((current) => {
      const sourceCellId = sourceCells.some((cell) => cell.id === current.sourceCellId)
        ? current.sourceCellId
        : sourceCells[0]?.id ?? '';
      const validQualityIds = new Set(qualityCells.map((cell) => cell.id));
      const includedQualityCellIds = current.includedQualityCellIds.length
        ? current.includedQualityCellIds.filter((id) => validQualityIds.has(id))
        : qualityCells.map((cell) => cell.id);
      if (sourceCellId === current.sourceCellId && includedQualityCellIds.join('|') === current.includedQualityCellIds.join('|')) return current;
      return { ...current, sourceCellId, includedQualityCellIds };
    });
  }, [sourceCells, qualityCells]);

  const selectSourceCell = (sourceCellId: string) => {
    const source = sourceCells.find((cell) => cell.id === sourceCellId);
    const descriptions = Object.fromEntries(source?.result?.columns.map((column) => [column.name, draft.fieldDescriptions[column.name] ?? '']) ?? []);
    setDraft((current) => ({ ...current, sourceCellId, fieldDescriptions: descriptions }));
  };

  const publishTable = async () => {
    if (!selectedSource) {
      setPublicationError('Add a SELECT or WITH query cell before publishing a table.');
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(draft.name)) {
      setPublicationError('Table name must start with a letter or underscore and use only letters, numbers, and underscores.');
      return;
    }
    if (datasets.some((dataset) => dataset.name === draft.name)) {
      setPublicationError('A dataset with this table name already exists. Choose a different name.');
      return;
    }
    const incompleteCheck = selectedQualityCells.find((cell) => !cell.sql.trim() || !cell.quality?.name.trim());
    if (incompleteCheck) {
      setPublicationError('Every included quality check needs a name and SQL statement.');
      return;
    }

    setPublishing(true);
    setPublicationError('');
    try {
      await duckdbWorkspace.createTable(draft.name, selectedSource.sql, datasets);
      const publishedTable = `workspace.${draft.name}`;
      const qualityEntries: QualityEntry[] = [];
      let failed = 0;
      let warned = 0;
      for (const cell of selectedQualityCells) {
        const definition = cell.quality!;
        try {
          const result = await duckdbWorkspace.run(cell.sql.replace(/{{published_table}}/g, publishedTable), datasets);
          const outcome = qualityOutcome(result.rowCount, definition.severity);
          updateCell(cell.id, { result, qualityExecution: { result: outcome, violations: result.rowCount, elapsedMs: result.elapsedMs, ranAt: new Date() } });
          if (outcome === 'Failed') failed += 1;
          if (outcome === 'Warning') warned += 1;
          qualityEntries.push({
            id: crypto.randomUUID(), timestamp: new Date(), checkType: 'Accuracy', severity: definition.severity,
            datasetId: '', datasetName: draft.displayName || displayNameFor(draft.name),
            message: outcome === 'Passed' ? `${definition.name} passed with no violations` : `${definition.name} found ${result.rowCount.toLocaleString()} violating rows`,
            rule: definition.description || definition.name, result: outcome,
            metadata: { executionTimeMs: result.elapsedMs, engine: 'DuckDB WASM', sql: cell.sql },
          });
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : 'Quality check execution failed.';
          updateCell(cell.id, { error: message, qualityExecution: { result: 'Failed', violations: 0, elapsedMs: 0, ranAt: new Date() } });
          qualityEntries.push({
            id: crypto.randomUUID(), timestamp: new Date(), checkType: 'Accuracy', severity: definition.severity,
            datasetId: '', datasetName: draft.displayName || displayNameFor(draft.name), message: `${definition.name} could not run`,
            rule: definition.description || definition.name, result: 'Failed', metadata: { engine: 'DuckDB WASM', error: message, sql: cell.sql },
          });
        }
      }

      const result = selectedSource.result ?? await duckdbWorkspace.run(selectedSource.sql, datasets, { notify: false });
      const bundleId = crypto.randomUUID();
      const datasetId = crypto.randomUUID();
      const pipelineId = crypto.randomUUID();
      const displayName = draft.displayName.trim() || displayNameFor(draft.name);
      const now = new Date();
      const expiry = expiresAt ?? new Date(Date.now() + 90 * 60 * 1000);
      const marker = `ephemeral-bundle:${bundleId}`;
      const healthScore = Math.max(0, 100 - (failed * 25) - (warned * 10));
      const fields = result.columns.map((column) => ({ name: column.name, type: column.type, description: draft.fieldDescriptions[column.name]?.trim() || 'Description pending' }));
      const inputDatasetIds = datasets.filter((dataset) => selectedSource.sql.includes(`happy_coffee.${dataset.name}`)).map((dataset) => dataset.id);
      const dataset: Dataset = {
        id: datasetId, name: draft.name, displayName, type: 'Table', schema: { database: 'workspace', schema: 'published' },
        description: draft.description.trim() || `Published from the ${activeNotebook.name} notebook.`, columns: fields.length,
        rows: result.rowCount, sizeBytes: Math.max(1, new Blob([JSON.stringify(result.rows)]).size), owner: draft.owner.trim() || 'Analytics',
        tags: [...draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean), 'workspace', 'published', marker], qualityScore: healthScore,
        criticality: draft.criticality, freshness: { lastUpdated: now, updateFrequency: draft.frequency }, source: 'DuckDB workspace', createdAt: now,
        sampleData: result.rows.slice(0, 10), fields,
        qualityDashboard: { checksFailed: failed, checksWarned: warned, healthScore, activeChecks: selectedQualityCells.length, avgAlertsPerDay: failed + warned, dailyChecks: [{ date: now.toISOString().slice(0, 10), pass: selectedQualityCells.length - failed - warned, warn: warned, fail: failed }] },
        publication: {
          sourceCellId: selectedSource.id, sourceSql: selectedSource.sql, transformations: draft.transformations,
          schedule: { frequency: draft.frequency, cron: draft.cron },
          qualityChecks: selectedQualityCells.map((cell) => ({ id: crypto.randomUUID(), cellId: cell.id, name: cell.quality!.name, description: cell.quality!.description, severity: cell.quality!.severity, sql: cell.sql })),
          expiresAt: expiry,
        },
      };
      const pipeline: Pipeline = {
        id: pipelineId, name: `publish_${draft.name}`, displayName: `Publish ${displayName}`,
        description: `Mock transformation pipeline for ${displayName}.`, type: 'Transformation', owner: dataset.owner,
        schedule: draft.frequency === 'Manual' ? null : { enabled: true, cron: draft.cron, timezone: 'UTC', nextRun: new Date(now.getTime() + 60 * 60 * 1000) },
        engine: 'DuckDB WASM', cluster: 'Browser-local workspace', inputDatasets: inputDatasetIds, outputDatasets: [datasetId],
        tags: ['workspace', 'mock-schedule', marker], createdAt: now, lastRunStatus: 'Success', lastRunTime: now, avgDuration: Math.max(1, result.elapsedMs / 1000), totalRuns: 1,
      };
      const initialRun: PipelineRun = {
        id: crypto.randomUUID(), runNumber: `RUN-PUB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        pipelineId, pipelineName: pipeline.name, type: 'Transformation', status: 'Success', startTime: now, endTime: now,
        duration: Math.max(1, Math.round(result.elapsedMs / 1000)), recordsProcessed: result.rowCount, recordsFailed: 0, triggerType: 'Manual',
        inputDatasets: inputDatasetIds, outputDatasets: [datasetId], parameters: { schedule: draft.frequency, source: 'Table Publishing' },
        logs: [{ timestamp: now, level: 'INFO', message: `Published ${publishedTable} with ${result.rowCount.toLocaleString()} rows.` }, { timestamp: now, level: 'INFO', message: `${selectedQualityCells.length} quality checks evaluated.` }],
      };
      const bundle: EphemeralPublicationBundle = {
        id: bundleId, dataset, pipeline, pipelineRuns: [initialRun],
        qualityChecks: qualityEntries.map((check) => ({ ...check, datasetId, datasetName: displayName })),
        lineage: [{ id: crypto.randomUUID(), type: 'Gold', name: displayName, timestamp: now, location: publishedTable, datasetIds: [datasetId], metadata: { pipelineId, sourceCellId: selectedSource.id, ephemeral: true } }],
        costs: [{ id: crypto.randomUUID(), category: 'Query', subcategory: 'DuckDB WASM', entityType: 'Pipeline', entityId: pipelineId, amount: 0.04, currency: 'USD', date: now, description: `Mock query cost for publishing ${displayName}` }], expiresAt: expiry,
      };
      publishEphemeralBundle(bundle);
      setPublishedDatasetId(datasetId);
      await refreshTables();
    } catch (error) {
      setPublicationError(error instanceof Error ? error.message : 'The table could not be published.');
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    const respond = (message: string, data?: unknown): DevelopmentBridgeResult => ({ ok: true, message, data });
    const fail = (message: string): DevelopmentBridgeResult => ({ ok: false, message });
    const findCell = (cellId: string) => {
      const notebook = notebooksRef.current.find((item) => item.cells.some((cell) => cell.id === cellId));
      return { notebook, cell: notebook?.cells.find((cell) => cell.id === cellId) };
    };
    const handleAction = async (action: DevelopmentBridgeAction): Promise<DevelopmentBridgeResult> => {
      switch (action.type) {
        case 'inspect':
          return respond('Current development workspace state.', {
            status: statusRef.current, expiresAt: expiresAtRef.current,
            activeNotebookId: activeNotebookIdRef.current, activeCellId: activeCellIdRef.current,
            bottomTab: bottomTabRef.current,
            bottomPanelOpen,
            bottomPanelHeight,
            notebooks: notebooksRef.current.map((notebook) => ({
              id: notebook.id, name: notebook.name,
              cells: notebook.cells.map((cell, index) => ({
                id: cell.id, index: index + 1, kind: cell.kind, sql: cell.sql,
                quality: cell.quality, running: Boolean(cell.running), error: cell.error,
                result: cell.result ? { columns: cell.result.columns, rowCount: cell.result.rowCount, elapsedMs: cell.result.elapsedMs, rows: cell.result.rows } : undefined,
                qualityExecution: cell.qualityExecution,
              })),
            })),
            publicationDraft: { ...draftRef.current, publishedDatasetId: publishedDatasetIdRef.current, publishRequiresUserClick: true },
            catalogTableCount: tablesRef.current.filter((table) => table.schema === 'happy_coffee').length,
            workspaceTables: tablesRef.current.filter((table) => table.schema === 'workspace'),
          });
        case 'create-notebook': {
          const notebook = makeNotebook(action.name?.trim() || `Untitled query ${notebooksRef.current.length + 1}`);
          setNotebooks((current) => [...current, notebook]);
          setActiveNotebookId(notebook.id);
          setActiveCellId(notebook.cells[0].id);
          return respond(`Created and selected notebook ${notebook.name}.`, { notebookId: notebook.id, cellId: notebook.cells[0].id });
        }
        case 'select-notebook': {
          const notebook = notebooksRef.current.find((item) => item.id === action.notebookId);
          if (!notebook) return fail('Notebook not found. Call inspect_development_workspace to get available notebook IDs.');
          setActiveNotebookId(notebook.id);
          setActiveCellId(notebook.cells[0]?.id ?? '');
          return respond(`Selected notebook ${notebook.name}.`, { notebookId: notebook.id });
        }
        case 'close-notebook': {
          const current = notebooksRef.current;
          if (current.length === 1) return fail('The only notebook cannot be closed. Delete its cells or create another notebook first.');
          const remaining = current.filter((item) => item.id !== action.notebookId);
          if (remaining.length === current.length) return fail('Notebook not found.');
          setNotebooks(remaining);
          if (activeNotebookIdRef.current === action.notebookId) {
            setActiveNotebookId(remaining[0].id);
            setActiveCellId(remaining[0].cells[0]?.id ?? '');
          }
          return respond('Closed notebook.', { notebookId: action.notebookId });
        }
        case 'create-cell': {
          if (!action.sql.trim()) return fail('SQL is required to create a cell.');
          const notebookId = action.notebookId ?? activeNotebookIdRef.current;
          const notebook = notebooksRef.current.find((item) => item.id === notebookId);
          if (!notebook) return fail('Notebook not found.');
          const kind = action.kind ?? 'query';
          const cell = makeCell(action.sql, kind);
          if (kind === 'quality') cell.quality = { name: action.name?.trim() || 'Untitled quality check', description: action.description ?? '', severity: action.severity ?? 'Warning' };
          setNotebooks((current) => current.map((item) => item.id === notebookId ? { ...item, cells: [...item.cells, cell] } : item));
          if (action.activate !== false) {
            setActiveNotebookId(notebookId);
            setActiveCellId(cell.id);
          }
          return respond(`Created ${kind === 'quality' ? 'quality-check' : 'query'} cell.`, { notebookId, cellId: cell.id });
        }
        case 'update-cell': {
          const { notebook, cell } = findCell(action.cellId);
          if (!notebook || !cell) return fail('Cell not found. Call inspect_development_workspace to get valid cell IDs.');
          const kind = action.kind ?? cell.kind;
          const quality = kind === 'quality'
            ? { name: action.name?.trim() || cell.quality?.name || 'Untitled quality check', description: action.description ?? cell.quality?.description ?? '', severity: action.severity ?? cell.quality?.severity ?? 'Warning' }
            : undefined;
          updateCellInNotebook(notebook.id, cell.id, {
            kind, quality,
            sql: action.sql ?? cell.sql,
            result: action.sql === undefined ? cell.result : undefined,
            error: action.sql === undefined ? cell.error : undefined,
            qualityExecution: action.sql === undefined ? cell.qualityExecution : undefined,
          });
          return respond('Updated development cell.', { notebookId: notebook.id, cellId: cell.id, kind });
        }
        case 'delete-cell': {
          const { notebook, cell } = findCell(action.cellId);
          if (!notebook || !cell) return fail('Cell not found.');
          const remainingCells = notebook.cells.filter((item) => item.id !== cell.id);
          setNotebooks((current) => current.map((item) => item.id === notebook.id ? { ...item, cells: remainingCells } : item));
          if (activeCellIdRef.current === cell.id) setActiveCellId(remainingCells[0]?.id ?? '');
          return respond('Deleted development cell.', { notebookId: notebook.id, cellId: cell.id });
        }
        case 'run-cell': {
          const { notebook, cell } = findCell(action.cellId);
          if (!notebook || !cell) return fail('Cell not found.');
          setActiveNotebookId(notebook.id);
          const execution = await executeCell(notebook.id, cell.id);
          if (execution.error) return fail(execution.error);
          return respond('Executed development cell.', { notebookId: notebook.id, cellId: cell.id, result: execution.result });
        }
        case 'reset-workspace':
          await resetSession();
          return respond('Reset the local DuckDB workspace and removed ephemeral published bundles.');
        case 'prepare-publication': {
          const source = action.sourceCellId ? findCell(action.sourceCellId) : undefined;
          if (action.sourceCellId && (!source?.notebook || !source.cell || source.cell.kind !== 'query')) return fail('The publication source must be a query cell.');
          if (source?.notebook) {
            setActiveNotebookId(source.notebook.id);
            setActiveCellId(source.cell!.id);
          }
          const qualityIds = action.qualityCellIds;
          if (qualityIds?.some((id) => findCell(id).cell?.kind !== 'quality')) return fail('Every selected quality cell must exist and be marked as a quality check.');
          setDraft((current) => ({
            ...current,
            sourceCellId: action.sourceCellId ?? current.sourceCellId,
            name: action.name ?? current.name,
            displayName: action.displayName ?? current.displayName,
            description: action.description ?? current.description,
            owner: action.owner ?? current.owner,
            tags: action.tags ?? current.tags,
            criticality: action.criticality ?? current.criticality,
            frequency: action.frequency ?? current.frequency,
            cron: action.cron ?? (action.frequency ? cronForFrequency(action.frequency) : current.cron),
            transformations: action.transformations ?? current.transformations,
            includedQualityCellIds: qualityIds ?? current.includedQualityCellIds,
            fieldDescriptions: action.fieldDescriptions ? { ...current.fieldDescriptions, ...action.fieldDescriptions } : current.fieldDescriptions,
          }));
          setPublicationError('');
          setBottomTab('publishing');
          setBottomPanelOpen(true);
          return respond('Prepared Table Publishing. The user must review and click Publish table; agents cannot publish.', { sourceCellId: draftRef.current.sourceCellId, requiresUserPublish: true });
        }
        case 'set-view':
          if (action.bottomTab) setBottomTab(action.bottomTab);
          if (action.explorerCollapsed !== undefined) setExplorerCollapsed(action.explorerCollapsed);
          if (action.bottomPanelOpen !== undefined) setBottomPanelOpen(action.bottomPanelOpen);
          if (action.bottomPanelHeight !== undefined) setPreferredOutputPanelHeight(action.bottomPanelHeight);
          return respond('Updated development workspace view.');
        default:
          return fail('Unsupported development workspace action.');
      }
    };
    return registerDevelopmentActionHandler(handleAction);
  }, [
    activeCellIdRef, activeNotebookIdRef, bottomPanelHeight, bottomPanelOpen, bottomTabRef, draftRef, executeCell, expiresAtRef, notebooksRef,
    publishedDatasetIdRef, resetSession, setActiveCellId, setActiveNotebookId, setBottomTab, setDraft,
    setExplorerCollapsed, setNotebooks, setPreferredOutputPanelHeight, setPublicationError, statusRef, tablesRef, updateCellInNotebook,
  ]);

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
        <aside className={clsx('hidden md:flex flex-shrink-0 flex-col border-r border-cream-200 bg-white transition-[width] duration-200', explorerCollapsed ? 'w-12' : 'w-64')}>
          {explorerCollapsed ? (
            <div className="flex h-full flex-col items-center gap-3 py-3">
              <Database className="w-4 h-4 text-brand-600" />
              <button type="button" onClick={() => setExplorerCollapsed(false)} aria-label="Expand catalog" title="Expand catalog" className="mt-auto rounded-md p-2 text-cream-500 hover:bg-cream-100 hover:text-cream-800"><PanelLeftOpen className="w-4 h-4" /></button>
            </div>
          ) : <>
            <div className="border-b border-cream-100 p-3">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-semibold text-cream-700">Catalog</h2><button type="button" onClick={() => void refreshTables()} title="Refresh tables" className="text-cream-500 hover:text-cream-800"><RefreshCcw className="w-3.5 h-3.5" /></button></div>
              <label className="flex items-center gap-2 rounded-md border border-cream-200 bg-cream-50 px-2 py-1.5 text-cream-400 focus-within:border-brand-400 focus-within:bg-white"><Search className="w-3.5 h-3.5" /><input value={explorerQuery} onChange={(event) => setExplorerQuery(event.target.value)} placeholder="Filter tables" className="w-full bg-transparent text-xs text-cream-700 outline-none placeholder:text-cream-400" /></label>
            </div>
            <div className="flex-1 overflow-y-auto p-2 text-xs scrollbar-thin">
              <button type="button" onClick={() => setCatalogExpanded((value) => !value)} className="flex w-full items-center gap-1.5 rounded px-2 py-2 text-left font-medium text-cream-700 hover:bg-cream-50"><ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', !catalogExpanded && '-rotate-90')} /><Database className="w-3.5 h-3.5 text-brand-600" /> happy_coffee <span className="ml-auto text-[10px] text-cream-400">{catalogTables.length}</span></button>
              {catalogExpanded && <div className="mb-2 ml-2 border-l border-cream-200 py-1">{catalogTables.map((table) => <button key={`${table.schema}.${table.name}`} type="button" onClick={() => addCell(`SELECT *\nFROM ${table.schema}.${table.name}\nLIMIT 25;`)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-cream-600 hover:bg-blue-50 hover:text-blue-800"><Table2 className="w-3.5 h-3.5 text-cream-400" /><span className="truncate">{table.name}</span></button>)}</div>}
              <button type="button" onClick={() => setWorkspaceExpanded((value) => !value)} className="flex w-full items-center gap-1.5 rounded px-2 py-2 text-left font-medium text-cream-700 hover:bg-cream-50"><ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', !workspaceExpanded && '-rotate-90')} /><Database className="w-3.5 h-3.5 text-accent-600" /> workspace <span className="ml-auto text-[10px] text-cream-400">{workingTables.length}</span></button>
              {workspaceExpanded && <div className="ml-2 border-l border-cream-200 py-1">{workingTables.length ? workingTables.map((table) => <button key={`${table.schema}.${table.name}`} type="button" onClick={() => addCell(`SELECT *\nFROM ${table.schema}.${table.name}\nLIMIT 25;`)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-cream-600 hover:bg-emerald-50 hover:text-emerald-800"><Table2 className="w-3.5 h-3.5 text-accent-600" /><span className="truncate">{table.name}</span></button>) : <p className="px-3 py-1.5 text-[11px] text-cream-400">No temporary tables</p>}</div>}
            </div>
            <div className="flex items-center justify-between border-t border-cream-200 px-3 py-2 text-[11px] text-cream-500"><span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" /> {formatExpiry(expiresAt)}</span><button type="button" onClick={() => setExplorerCollapsed(true)} aria-label="Collapse catalog" title="Collapse catalog" className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-cream-100 hover:text-cream-800"><PanelLeftClose className="w-3.5 h-3.5" /><span className="hidden xl:inline">Collapse</span></button></div>
          </>}
        </aside>

        <main className="min-w-0 flex flex-1 flex-col bg-white">
          <div className="flex h-10 items-end gap-0 border-b border-cream-200 bg-[#f5f6f8] px-2 overflow-x-auto scrollbar-thin">
            {notebooks.map((notebook) => <div key={notebook.id} className={clsx('group flex h-10 min-w-[150px] items-center gap-2 border-r border-cream-200 px-3 text-xs', notebook.id === activeNotebookId ? 'border-t-2 border-t-blue-500 bg-white font-medium text-cream-900' : 'text-cream-500 hover:bg-cream-100')}><button type="button" onClick={() => { setActiveNotebookId(notebook.id); setActiveCellId(notebook.cells[0]?.id ?? ''); }} className="min-w-0 flex-1 truncate text-left">{notebook.name}</button>{notebooks.length > 1 && <button type="button" onClick={() => closeNotebook(notebook.id)} className="opacity-0 group-hover:opacity-100 hover:text-cream-900"><X className="w-3.5 h-3.5" /></button>}</div>)}
            <button type="button" onClick={addNotebook} title="New query tab" className="mb-1 ml-1 rounded p-1.5 text-cream-500 hover:bg-cream-200 hover:text-cream-800"><Plus className="w-4 h-4" /></button>
          </div>
          {status === 'error' && <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700"><XCircle className="w-4 h-4" /> {statusMessage}</div>}
          {status === 'loading' && <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-700"><LoaderCircle className="w-4 h-4 animate-spin" /> {statusMessage}</div>}
          <section className="min-h-0 flex flex-1 flex-col overflow-y-auto bg-[#fbfcfd] p-3 sm:p-4 scrollbar-thin">
            <div className="mx-auto w-full max-w-6xl space-y-3">
              {activeNotebook.cells.map((cell, index) => <article key={cell.id} onClick={() => setActiveCellId(cell.id)} className={clsx('overflow-hidden rounded-lg border bg-white shadow-card transition-shadow', cell.id === activeCellId ? 'border-blue-400 shadow-[0_0_0_1px_rgba(59,130,246,0.12)]' : 'border-cream-200')}>
                <div className="flex h-10 items-center justify-between border-b border-cream-100 bg-white px-3"><div className="flex items-center gap-2"><span className="font-mono text-[11px] text-cream-400">{index + 1}</span><select aria-label={`Cell ${index + 1} type`} value={cell.kind} onChange={(event) => setCellKind(cell.id, event.target.value as Cell['kind'])} className={clsx('rounded border px-1.5 py-1 text-[11px] font-medium outline-none', cell.kind === 'quality' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-cream-200 bg-white text-cream-600')}><option value="query">Query</option><option value="quality">Quality check</option></select></div><div className="flex items-center gap-1"><button type="button" onClick={(event) => { event.stopPropagation(); deleteCell(cell.id); }} aria-label={`Delete cell ${index + 1}`} title="Delete cell" className="rounded p-1.5 text-cream-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button><button type="button" onClick={() => void runCell(cell.id)} disabled={status !== 'ready' || cell.running} className={clsx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50', cell.kind === 'quality' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700')}>{cell.running ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}{cell.running ? 'Running' : cell.kind === 'quality' ? 'Run check' : 'Run'} <span className="hidden sm:inline text-white/70">⌘↵</span></button></div></div>
                <CodeMirror value={cell.sql} height="200px" extensions={[sql(), softSqlTheme, keymap.of([{ key: 'Mod-Enter', run: () => { void runCell(cell.id); return true; } }])]} onChange={(value) => updateCell(cell.id, { sql: value, result: undefined, error: undefined, qualityExecution: undefined })} basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: true }} />
                {cell.kind === 'quality' && cell.quality && <div className="grid gap-2 border-t border-amber-100 bg-amber-50/40 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_120px]"><input value={cell.quality.name} onChange={(event) => updateQualityConfig(cell.id, { name: event.target.value })} placeholder="Check name" className="rounded border border-amber-200 bg-white px-2 py-1.5 text-xs text-cream-800 outline-none focus:border-amber-400" /><input value={cell.quality.description} onChange={(event) => updateQualityConfig(cell.id, { description: event.target.value })} placeholder="Describe the rule (optional)" className="rounded border border-amber-200 bg-white px-2 py-1.5 text-xs text-cream-800 outline-none focus:border-amber-400" /><select aria-label="Quality severity" value={cell.quality.severity} onChange={(event) => updateQualityConfig(cell.id, { severity: event.target.value as QualitySeverity })} className="rounded border border-amber-200 bg-white px-2 py-1.5 text-xs text-cream-700 outline-none focus:border-amber-400"><option value="Info">Info</option><option value="Warning">Warning</option><option value="Error">Error</option><option value="Critical">Critical</option></select><p className="sm:col-span-3 text-[11px] text-amber-800">Return violating rows from this query. Use <code className="rounded bg-amber-100 px-1">{'{{published_table}}'}</code> to test the table during publishing.</p></div>}
                {cell.qualityExecution && cell.quality && <QualityExecutionCard execution={cell.qualityExecution} severity={cell.quality.severity} />}
                {cell.error && <div className="border-t border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 whitespace-pre-wrap">{cell.error}</div>}
              </article>)}
              {!activeNotebook.cells.length && <div className="rounded-lg border border-dashed border-cream-300 bg-white px-4 py-8 text-center text-xs text-cream-500">This notebook has no cells. Add a SQL cell to continue.</div>}
              <button type="button" onClick={() => addCell()} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-cream-600 hover:bg-cream-100"><Plus className="w-3.5 h-3.5" /> Add SQL cell</button>
            </div>
          </section>
          {bottomPanelOpen ? <section ref={outputPanelRef} aria-label="Workspace output panel" style={bottomPanelHeight ? { height: `${bottomPanelHeight}px` } : undefined} className={clsx(DEFAULT_OUTPUT_PANEL_HEIGHT, 'relative flex-shrink-0 border-t border-cream-300 bg-white flex flex-col')}>
            <div role="separator" aria-label="Resize output panel" aria-orientation="horizontal" onPointerDown={startOutputPanelResize} title="Drag to resize the output panel" className="group absolute inset-x-0 -top-1 z-10 flex h-2 cursor-row-resize touch-none items-center"><span className="mx-3 h-px flex-1 bg-transparent transition-colors group-hover:bg-blue-400 group-active:bg-blue-600" /></div>
            <div className="flex h-10 items-center border-b border-cream-200 px-3">
              <div className="flex h-full items-center gap-5">
                <button type="button" onClick={() => setBottomTab('results')} className={clsx('h-full border-b-2 text-xs font-medium', bottomTab === 'results' ? 'border-blue-600 text-blue-700' : 'border-transparent text-cream-500 hover:text-cream-800')}>Results {activeCell?.result ? `(${activeCell.result.rowCount.toLocaleString()})` : ''}</button>
                <button type="button" onClick={() => setBottomTab('publishing')} className={clsx('h-full border-b-2 text-xs font-medium', bottomTab === 'publishing' ? 'border-blue-600 text-blue-700' : 'border-transparent text-cream-500 hover:text-cream-800')}>Table Publishing</button>
              </div>
              <div className="ml-auto flex items-center gap-1.5">{bottomTab === 'results' && activeCell?.result && <><span className="hidden sm:inline text-[11px] text-cream-500">{activeCell.result.elapsedMs} ms{activeCell.result.truncated ? ' · first 250 rows' : ''}</span><label className="hidden md:flex items-center gap-1.5 rounded border border-cream-200 px-2 py-1 text-cream-400"><Search className="w-3 h-3" /><input value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} placeholder="Search results" className="w-28 bg-transparent text-[11px] text-cream-700 outline-none" /></label><button type="button" title="CSV export is planned" className="rounded p-1 text-cream-400 hover:text-cream-700"><Download className="w-3.5 h-3.5" /></button></>}<button type="button" onClick={() => setBottomPanelOpen(false)} aria-label="Close output panel" title="Close results and publishing panel" className="ml-1 rounded p-1 text-cream-500 hover:bg-cream-100 hover:text-cream-800"><PanelBottomClose className="w-3.5 h-3.5" /></button></div>
            </div>
            {bottomTab === 'results' ? <div className="min-h-0 flex-1">{visibleResult ? <ResultGrid result={visibleResult} /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-cream-400"><Table2 className="w-5 h-5" /><p className="text-xs">Run the active SQL cell to view results.</p></div>}</div> : <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbfcfd] p-3 scrollbar-thin sm:p-4">
              <div className="mx-auto grid max-w-5xl gap-3 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3 rounded-lg border border-cream-200 bg-white p-3">
                  <div><h2 className="text-sm font-semibold text-cream-900">Publish a table</h2><p className="mt-0.5 text-xs text-cream-500">Create an ephemeral catalog dataset and mock pipeline from a notebook query.</p></div>
                  <label className="block text-xs font-medium text-cream-700">Source query cell<select value={draft.sourceCellId} onChange={(event) => selectSourceCell(event.target.value)} className="mt-1.5 w-full rounded-md border border-cream-200 bg-white px-2.5 py-2 text-xs text-cream-800 outline-none focus:border-blue-400"><option value="">Select a SELECT or WITH cell</option>{sourceCells.map((cell) => <option key={cell.id} value={cell.id}>Cell {activeNotebook.cells.indexOf(cell) + 1} · {cell.result ? `${cell.result.rowCount.toLocaleString()} rows` : 'run to preview fields'}</option>)}</select></label>
                  <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-medium text-cream-700">Table name<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="mt-1.5 w-full rounded-md border border-cream-200 px-2.5 py-2 font-mono text-xs text-cream-800 outline-none focus:border-blue-400" /></label><label className="text-xs font-medium text-cream-700">Display name<input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} className="mt-1.5 w-full rounded-md border border-cream-200 px-2.5 py-2 text-xs text-cream-800 outline-none focus:border-blue-400" /></label></div>
                  <label className="block text-xs font-medium text-cream-700">Description<textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={2} className="mt-1.5 w-full resize-none rounded-md border border-cream-200 px-2.5 py-2 text-xs text-cream-800 outline-none focus:border-blue-400" /></label>
                  <div className="grid gap-2 sm:grid-cols-3"><label className="text-xs font-medium text-cream-700">Owner<input value={draft.owner} onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))} className="mt-1.5 w-full rounded-md border border-cream-200 px-2.5 py-2 text-xs text-cream-800 outline-none focus:border-blue-400" /></label><label className="text-xs font-medium text-cream-700">Tags<input value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} className="mt-1.5 w-full rounded-md border border-cream-200 px-2.5 py-2 text-xs text-cream-800 outline-none focus:border-blue-400" /></label><label className="text-xs font-medium text-cream-700">Criticality<select value={draft.criticality} onChange={(event) => setDraft((current) => ({ ...current, criticality: event.target.value as Dataset['criticality'] }))} className="mt-1.5 w-full rounded-md border border-cream-200 bg-white px-2.5 py-2 text-xs text-cream-800 outline-none focus:border-blue-400"><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></label></div>
                  <label className="block text-xs font-medium text-cream-700">Transformation summary<textarea value={draft.transformations} onChange={(event) => setDraft((current) => ({ ...current, transformations: event.target.value }))} rows={2} className="mt-1.5 w-full resize-none rounded-md border border-cream-200 px-2.5 py-2 text-xs text-cream-800 outline-none focus:border-blue-400" /></label>
                </div>
                <div className="space-y-3 rounded-lg border border-cream-200 bg-white p-3">
                  <div><h3 className="text-sm font-semibold text-cream-900">Operate and validate</h3><p className="mt-0.5 text-xs text-cream-500">The schedule and runs are intentionally mocked for this browser-local demo.</p></div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1"><label className="text-xs font-medium text-cream-700">Frequency<select value={draft.frequency} onChange={(event) => { const frequency = event.target.value; setDraft((current) => ({ ...current, frequency, cron: cronForFrequency(frequency) })); }} className="mt-1.5 w-full rounded-md border border-cream-200 bg-white px-2.5 py-2 text-xs text-cream-800 outline-none focus:border-blue-400"><option>Manual</option><option>Hourly</option><option>Daily</option><option>Weekly</option><option>Custom</option></select></label>{draft.frequency === 'Custom' && <label className="text-xs font-medium text-cream-700">Cron expression<input value={draft.cron} onChange={(event) => setDraft((current) => ({ ...current, cron: event.target.value }))} placeholder="0 6 * * *" className="mt-1.5 w-full rounded-md border border-cream-200 px-2.5 py-2 font-mono text-xs text-cream-800 outline-none focus:border-blue-400" /></label>}</div>
                  <div className="rounded-md border border-amber-100 bg-amber-50/60 p-2.5"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-amber-900">Quality checks</p><p className="text-[11px] text-amber-800">Marked cells are included in the mock pipeline.</p></div><span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{selectedQualityCells.length}</span></div><div className="mt-2 space-y-1.5">{qualityCells.length ? qualityCells.map((cell) => <label key={cell.id} className="flex items-center gap-2 rounded bg-white/70 px-2 py-1.5 text-xs text-cream-700"><input type="checkbox" checked={draft.includedQualityCellIds.includes(cell.id)} onChange={(event) => setDraft((current) => ({ ...current, includedQualityCellIds: event.target.checked ? [...current.includedQualityCellIds, cell.id] : current.includedQualityCellIds.filter((id) => id !== cell.id) }))} className="accent-amber-600" /><span className="min-w-0 flex-1 truncate">{cell.quality?.name || `Quality check ${activeNotebook.cells.indexOf(cell) + 1}`}</span><span className="text-[10px] text-cream-400">{cell.quality?.severity}</span></label>) : <p className="py-1 text-[11px] text-amber-800">Mark a notebook cell as a Quality check to include it here.</p>}</div></div>
                  <div className="rounded-md border border-cream-200 bg-cream-50 p-2.5"><p className="text-xs font-semibold text-cream-800">Column descriptions</p>{selectedSource?.result?.columns.length ? <div className="mt-2 space-y-1.5">{selectedSource.result.columns.map((column) => <label key={column.name} className="grid grid-cols-[minmax(90px,0.7fr)_minmax(0,1.3fr)] items-center gap-2 text-[11px]"><span className="truncate font-mono text-cream-600">{column.name}</span><input value={draft.fieldDescriptions[column.name] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, fieldDescriptions: { ...current.fieldDescriptions, [column.name]: event.target.value } }))} placeholder="Describe this column" className="rounded border border-cream-200 bg-white px-2 py-1.5 text-xs text-cream-800 outline-none focus:border-blue-400" /></label>)}</div> : <p className="mt-1 text-[11px] text-cream-500">Run the source query to infer columns and add descriptions.</p>}</div>
                  {publicationError && <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">{publicationError}</p>}
                  {publishedDatasetId ? <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2"><span className="text-xs text-emerald-800">Table published to the catalog.</span><button type="button" onClick={() => navigate(`/datasets/${publishedDatasetId}`)} className="text-xs font-medium text-emerald-800 hover:underline">Open dataset</button></div> : <button type="button" onClick={() => void publishTable()} disabled={publishing || status !== 'ready'} className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{publishing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}{publishing ? 'Publishing table…' : 'Publish table'}</button>}
                  <p className="text-[11px] text-cream-500">Published datasets and their mock pipeline bundle expire with this workspace: {formatExpiry(expiresAt)}.</p>
                </div>
              </div>
            </div>}
          </section> : <div className="flex h-9 flex-shrink-0 items-center justify-between border-t border-cream-300 bg-white px-3"><span className="text-[11px] text-cream-500">{bottomTab === 'results' ? 'Results panel is closed' : 'Table Publishing panel is closed'}</span><button type="button" onClick={() => setBottomPanelOpen(true)} aria-label="Open output panel" className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-cream-600 hover:bg-cream-100 hover:text-cream-800"><PanelBottomOpen className="w-3.5 h-3.5" /> Open panel</button></div>}
        </main>

      </div>
    </div>
  );
}
