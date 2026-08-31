import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { QueryResult } from '../../../lib/duckdb-workspace';
import type { DevelopmentBridgeAction, DevelopmentBridgeResult } from '../../../lib/development-bridge';

// CodeMirror needs a real layout engine; the SQL text is all these tests care about.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => <pre data-testid="cell-sql">{value}</pre>,
}));

const okResult = (rowCount = 2): QueryResult => ({
  columns: [{ name: 'variety', type: 'VARCHAR' }, { name: 'inventory_kg', type: 'DOUBLE' }],
  rows: Array.from({ length: rowCount }, (_, index) => ({ variety: `variety-${index}`, inventory_kg: index * 10 })),
  rowCount,
  elapsedMs: 4,
  truncated: false,
});

const EXPIRES_AT = new Date('2026-01-01T00:00:00Z');
const WORKSPACE_TABLES = [
  { schema: 'happy_coffee', name: 'coffee_inventory', type: 'BASE TABLE' },
  { schema: 'workspace', name: 'scratch', type: 'BASE TABLE' },
];

// vi.mock factories are hoisted above the module body, so their doubles have to
// be created in a hoisted block too.
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  reset: vi.fn(),
  createTable: vi.fn(),
  listTables: vi.fn(),
  prepare: vi.fn(),
  getSessionInfo: vi.fn(),
  publishEphemeralBundle: vi.fn(),
  clearEphemeralBundles: vi.fn(),
}));

vi.mock('../../../lib/duckdb-workspace', () => ({
  WORKSPACE_CHANGED_EVENT: 'happy-coffee-workspace-changed',
  duckdbWorkspace: {
    prepare: mocks.prepare,
    listTables: mocks.listTables,
    run: mocks.run,
    createTable: mocks.createTable,
    reset: mocks.reset,
    getSessionInfo: mocks.getSessionInfo,
  },
}));

vi.mock('../../../hooks/useCatalogData', () => {
  const datasets = [{ id: 'ds-1', name: 'coffee_inventory', sampleData: [{ variety: 'Bourbon' }] }];
  // A stable object: the workspace re-seeds DuckDB whenever `datasets` changes identity.
  const value = {
    datasets, pipelines: [], pipelineRuns: [], costs: [],
    publishEphemeralBundle: mocks.publishEphemeralBundle,
    clearEphemeralBundles: mocks.clearEphemeralBundles,
  };
  return { useCatalogData: () => value };
});

import { DevelopmentWorkspace } from '../DevelopmentWorkspace';
import { requestDevelopmentAction } from '../../../lib/development-bridge';
import { useCatalogTools } from '../../mcp/useCatalogTools';

type InspectState = {
  status: string;
  activeNotebookId: string;
  activeCellId: string;
  bottomTab: string;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number | null;
  notebooks: {
    id: string;
    name: string;
    cells: {
      id: string;
      index: number;
      kind: 'query' | 'quality';
      sql: string;
      quality?: { name: string; description: string; severity: string };
      result?: { rowCount: number };
      qualityExecution?: { result: string; violations: number };
      error?: string;
    }[];
  }[];
  publicationDraft: Record<string, unknown> & { publishRequiresUserClick: boolean };
  catalogTableCount: number;
  workspaceTables: { name: string }[];
};

/** Mirrors how useCatalogTools drives the workspace: one awaited action at a time. */
const send = async (action: DevelopmentBridgeAction): Promise<DevelopmentBridgeResult> => {
  let result!: DevelopmentBridgeResult;
  await act(async () => {
    result = await requestDevelopmentAction(action);
  });
  return result;
};

const inspect = async () => {
  const result = await send({ type: 'inspect' });
  expect(result.ok).toBe(true);
  return result.data as InspectState;
};

let executeTool: ReturnType<typeof useCatalogTools>['executeTool'];

function ToolHarness() {
  const tools = useCatalogTools();
  useEffect(() => {
    executeTool = tools.executeTool;
  });
  return null;
}

async function renderWorkspace({ withTools = false } = {}) {
  render(
    <MemoryRouter>
      {withTools && <ToolHarness />}
      <DevelopmentWorkspace />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('DuckDB ready')).toBeInTheDocument());
}

describe('DevelopmentWorkspace WebMCP bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockImplementation(async () => okResult());
    mocks.listTables.mockImplementation(async () => WORKSPACE_TABLES);
    mocks.prepare.mockImplementation(async () => ({ expiresAt: EXPIRES_AT }));
    mocks.getSessionInfo.mockImplementation(() => ({ expiresAt: EXPIRES_AT, ttlMinutes: 90 }));
    mocks.createTable.mockImplementation(async () => 'workspace.published');
    mocks.reset.mockImplementation(async () => undefined);
  });

  describe('inspect_development_workspace', () => {
    it('reports notebooks, cells, tables, and that publishing needs a human', async () => {
      await renderWorkspace();
      const state = await inspect();

      expect(state.status).toBe('ready');
      expect(state.bottomTab).toBe('results');
      expect(state.bottomPanelOpen).toBe(true);
      expect(state.bottomPanelHeight).toBeNull();
      expect(state.notebooks).toHaveLength(1);
      expect(state.notebooks[0].name).toBe('Inventory analysis');
      expect(state.notebooks[0].cells[0]).toMatchObject({ index: 1, kind: 'query' });
      expect(state.notebooks[0].cells[0].sql).toContain('FROM happy_coffee.coffee_inventory');
      expect(state.activeNotebookId).toBe(state.notebooks[0].id);
      expect(state.activeCellId).toBe(state.notebooks[0].cells[0].id);
      expect(state.catalogTableCount).toBe(1);
      expect(state.workspaceTables).toEqual([{ schema: 'workspace', name: 'scratch', type: 'BASE TABLE' }]);
      expect(state.publicationDraft.publishRequiresUserClick).toBe(true);
    });

    it('reflects results after a cell runs', async () => {
      await renderWorkspace();
      const { notebooks } = await inspect();

      await send({ type: 'run-cell', cellId: notebooks[0].cells[0].id });
      const state = await inspect();

      expect(state.notebooks[0].cells[0].result?.rowCount).toBe(2);
    });
  });

  describe('notebooks', () => {
    it('creates and selects a notebook, defaulting the name', async () => {
      await renderWorkspace();

      const named = await send({ type: 'create-notebook', name: 'Origins' });
      expect(named.ok).toBe(true);

      const unnamed = await send({ type: 'create-notebook' });
      expect(unnamed.ok).toBe(true);

      const state = await inspect();
      expect(state.notebooks.map((notebook) => notebook.name)).toEqual([
        'Inventory analysis', 'Origins', 'Untitled query 3',
      ]);
      expect(state.activeNotebookId).toBe((unnamed.data as { notebookId: string }).notebookId);
      expect(await screen.findByText('Origins')).toBeInTheDocument();
    });

    it('selects an existing notebook by ID and rejects an unknown one', async () => {
      await renderWorkspace();
      const first = (await inspect()).notebooks[0].id;
      await send({ type: 'create-notebook', name: 'Origins' });

      const selected = await send({ type: 'select-notebook', notebookId: first });
      expect(selected.ok).toBe(true);
      expect((await inspect()).activeNotebookId).toBe(first);

      const missing = await send({ type: 'select-notebook', notebookId: 'nope' });
      expect(missing.ok).toBe(false);
      expect(missing.message).toContain('inspect_development_workspace');
    });

    it('closes a notebook and moves the selection off it', async () => {
      await renderWorkspace();
      const first = (await inspect()).notebooks[0].id;
      const created = await send({ type: 'create-notebook', name: 'Origins' });
      const second = (created.data as { notebookId: string }).notebookId;

      const closed = await send({ type: 'close-notebook', notebookId: second });
      expect(closed.ok).toBe(true);

      const state = await inspect();
      expect(state.notebooks).toHaveLength(1);
      expect(state.activeNotebookId).toBe(first);
    });

    it('refuses to close the last notebook', async () => {
      await renderWorkspace();
      const only = (await inspect()).notebooks[0].id;

      const result = await send({ type: 'close-notebook', notebookId: only });

      expect(result.ok).toBe(false);
      expect(result.message).toContain('only notebook cannot be closed');
      expect((await inspect()).notebooks).toHaveLength(1);
    });

    it('reports a missing notebook instead of closing an arbitrary one', async () => {
      await renderWorkspace();
      await send({ type: 'create-notebook', name: 'Origins' });

      const result = await send({ type: 'close-notebook', notebookId: 'nope' });

      expect(result).toEqual({ ok: false, message: 'Notebook not found.' });
      expect((await inspect()).notebooks).toHaveLength(2);
    });
  });

  describe('cells', () => {
    it('creates a query cell in the active notebook and selects it', async () => {
      await renderWorkspace();

      const created = await send({ type: 'create-cell', sql: 'SELECT 1;', kind: 'query', activate: true });
      const { cellId } = created.data as { cellId: string };

      const state = await inspect();
      expect(state.notebooks[0].cells).toHaveLength(2);
      expect(state.notebooks[0].cells[1]).toMatchObject({ id: cellId, kind: 'query', sql: 'SELECT 1;' });
      expect(state.activeCellId).toBe(cellId);
      expect(screen.getAllByTestId('cell-sql')[1]).toHaveTextContent('SELECT 1;');
    });

    it('creates a cell in a named notebook without stealing the selection', async () => {
      await renderWorkspace();
      const activeBefore = (await inspect()).activeCellId;
      const created = await send({ type: 'create-notebook', name: 'Origins' });
      const target = (created.data as { notebookId: string }).notebookId;
      await send({ type: 'select-notebook', notebookId: (await inspect()).notebooks[0].id });

      await send({ type: 'create-cell', notebookId: target, sql: 'SELECT 2;', activate: false });

      const state = await inspect();
      expect(state.notebooks[1].cells.map((cell) => cell.sql)).toContain('SELECT 2;');
      expect(state.activeCellId).toBe(activeBefore);
    });

    it('creates a quality-check cell with its configuration', async () => {
      await renderWorkspace();

      await send({
        type: 'create-cell', sql: 'SELECT * FROM t WHERE weight_kg < 0', kind: 'quality',
        name: 'No negative weights', description: 'Weights must be positive', severity: 'Critical',
      });

      const state = await inspect();
      expect(state.notebooks[0].cells[1]).toMatchObject({
        kind: 'quality',
        quality: { name: 'No negative weights', description: 'Weights must be positive', severity: 'Critical' },
      });
      expect(screen.getByDisplayValue('No negative weights')).toBeInTheDocument();
    });

    it('names an unlabelled quality check rather than leaving it blank', async () => {
      await renderWorkspace();

      await send({ type: 'create-cell', sql: 'SELECT 1', kind: 'quality' });

      const state = await inspect();
      expect(state.notebooks[0].cells[1].quality).toEqual({
        name: 'Untitled quality check', description: '', severity: 'Warning',
      });
    });

    it('rejects an empty statement', async () => {
      await renderWorkspace();

      const result = await send({ type: 'create-cell', sql: '   ' });

      expect(result).toEqual({ ok: false, message: 'SQL is required to create a cell.' });
      expect((await inspect()).notebooks[0].cells).toHaveLength(1);
    });

    it('rejects an unknown target notebook', async () => {
      await renderWorkspace();

      const result = await send({ type: 'create-cell', notebookId: 'nope', sql: 'SELECT 1' });

      expect(result).toEqual({ ok: false, message: 'Notebook not found.' });
    });

    it('updates SQL and discards the stale result', async () => {
      await renderWorkspace();
      const cellId = (await inspect()).notebooks[0].cells[0].id;
      await send({ type: 'run-cell', cellId });
      expect((await inspect()).notebooks[0].cells[0].result?.rowCount).toBe(2);

      const updated = await send({ type: 'update-cell', cellId, sql: 'SELECT 42;' });

      expect(updated.ok).toBe(true);
      const cell = (await inspect()).notebooks[0].cells[0];
      expect(cell.sql).toBe('SELECT 42;');
      expect(cell.result).toBeUndefined();
    });

    it('keeps the result when only quality metadata changes', async () => {
      await renderWorkspace();
      const cellId = (await inspect()).notebooks[0].cells[0].id;
      await send({ type: 'run-cell', cellId });

      await send({ type: 'update-cell', cellId, kind: 'quality', name: 'Row count', severity: 'Error' });

      const cell = (await inspect()).notebooks[0].cells[0];
      expect(cell.kind).toBe('quality');
      expect(cell.quality).toMatchObject({ name: 'Row count', severity: 'Error' });
      expect(cell.result?.rowCount).toBe(2);
    });

    it('converts a quality cell back to a query and drops its check config', async () => {
      await renderWorkspace();
      const created = await send({ type: 'create-cell', sql: 'SELECT 1', kind: 'quality', name: 'Check' });
      const { cellId } = created.data as { cellId: string };

      await send({ type: 'update-cell', cellId, kind: 'query' });

      const cell = (await inspect()).notebooks[0].cells[1];
      expect(cell.kind).toBe('query');
      expect(cell.quality).toBeUndefined();
    });

    it('rejects an unknown cell ID with a recovery hint', async () => {
      await renderWorkspace();

      const result = await send({ type: 'update-cell', cellId: 'nope', sql: 'SELECT 1' });

      expect(result.ok).toBe(false);
      expect(result.message).toContain('inspect_development_workspace');
    });

    it('deletes a cell and moves the selection off it', async () => {
      await renderWorkspace();
      const created = await send({ type: 'create-cell', sql: 'SELECT 1;', activate: true });
      const { cellId } = created.data as { cellId: string };

      const deleted = await send({ type: 'delete-cell', cellId });

      expect(deleted.ok).toBe(true);
      const state = await inspect();
      expect(state.notebooks[0].cells).toHaveLength(1);
      expect(state.activeCellId).not.toBe(cellId);
      expect(screen.getAllByTestId('cell-sql')).toHaveLength(1);
    });

    it('reports a missing cell instead of deleting an arbitrary one', async () => {
      await renderWorkspace();

      const result = await send({ type: 'delete-cell', cellId: 'nope' });

      expect(result).toEqual({ ok: false, message: 'Cell not found.' });
      expect((await inspect()).notebooks[0].cells).toHaveLength(1);
    });
  });

  describe('running cells', () => {
    it('runs a cell and returns the result to the agent', async () => {
      await renderWorkspace();
      const cellId = (await inspect()).notebooks[0].cells[0].id;

      const result = await send({ type: 'run-cell', cellId });

      expect(result.ok).toBe(true);
      expect((result.data as { result: QueryResult }).result.rowCount).toBe(2);
      expect(mocks.run).toHaveBeenCalledWith(expect.stringContaining('FROM happy_coffee.coffee_inventory'), expect.anything());
    });

    it('evaluates a quality check and shows the outcome in the UI', async () => {
      await renderWorkspace();
      mocks.run.mockImplementation(async () => okResult(3));
      const created = await send({
        type: 'create-cell', sql: 'SELECT * FROM t WHERE weight_kg < 0',
        kind: 'quality', name: 'No negative weights', severity: 'Critical',
      });
      const { cellId } = created.data as { cellId: string };

      await send({ type: 'run-cell', cellId });

      const cell = (await inspect()).notebooks[0].cells[1];
      expect(cell.qualityExecution).toMatchObject({ result: 'Failed', violations: 3 });
      expect(await screen.findByText('Check failed')).toBeInTheDocument();
    });

    it('passes a clean quality check', async () => {
      await renderWorkspace();
      mocks.run.mockImplementation(async () => okResult(0));
      const created = await send({ type: 'create-cell', sql: 'SELECT 1', kind: 'quality', name: 'Clean' });

      await send({ type: 'run-cell', cellId: (created.data as { cellId: string }).cellId });

      expect((await inspect()).notebooks[0].cells[1].qualityExecution).toMatchObject({ result: 'Passed', violations: 0 });
      expect(await screen.findByText('Check passed')).toBeInTheDocument();
    });

    it('surfaces a SQL error as a failed action and shows it in the cell', async () => {
      await renderWorkspace();
      const cellId = (await inspect()).notebooks[0].cells[0].id;
      mocks.run.mockRejectedValueOnce(new Error('Catalog Error: no such table'));

      const result = await send({ type: 'run-cell', cellId });

      expect(result).toEqual({ ok: false, message: 'Catalog Error: no such table' });
      expect((await inspect()).notebooks[0].cells[0].error).toBe('Catalog Error: no such table');
      expect(await screen.findByText('Catalog Error: no such table')).toBeInTheDocument();
    });

    it('rejects an unknown cell ID', async () => {
      await renderWorkspace();

      expect(await send({ type: 'run-cell', cellId: 'nope' })).toEqual({ ok: false, message: 'Cell not found.' });
    });
  });

  describe('publication staging', () => {
    it('fills the draft, opens the publishing tab, and does not publish', async () => {
      await renderWorkspace();
      const sourceCellId = (await inspect()).notebooks[0].cells[0].id;

      const result = await send({
        type: 'prepare-publication', sourceCellId,
        name: 'inventory_by_origin', displayName: 'Inventory by Origin',
        description: 'Inventory rolled up by origin.', owner: 'Supply Chain',
        tags: 'inventory, curated', criticality: 'High', frequency: 'Hourly',
        transformations: 'Groups inventory by origin.',
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ sourceCellId, requiresUserPublish: true });
      expect(result.message).toContain('agents cannot publish');

      const state = await inspect();
      expect(state.bottomTab).toBe('publishing');
      expect(state.publicationDraft).toMatchObject({
        name: 'inventory_by_origin', displayName: 'Inventory by Origin', owner: 'Supply Chain',
        criticality: 'High', frequency: 'Hourly', cron: '0 * * * *',
      });

      // The staged form is on screen, and nothing reached the catalog.
      expect(await screen.findByText('Publish a table')).toBeInTheDocument();
      expect(screen.getByDisplayValue('inventory_by_origin')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Publish table/ })).toBeInTheDocument();
      expect(mocks.publishEphemeralBundle).not.toHaveBeenCalled();
      expect(mocks.createTable).not.toHaveBeenCalled();
    });

    it('derives the cron from the frequency but lets an explicit cron win', async () => {
      await renderWorkspace();

      await send({ type: 'prepare-publication', frequency: 'Weekly' });
      expect((await inspect()).publicationDraft.cron).toBe('0 6 * * 1');

      await send({ type: 'prepare-publication', frequency: 'Custom', cron: '30 4 * * *' });
      expect((await inspect()).publicationDraft.cron).toBe('30 4 * * *');
    });

    it('attaches selected quality cells', async () => {
      await renderWorkspace();
      const created = await send({ type: 'create-cell', sql: 'SELECT 1', kind: 'quality', name: 'Freshness' });
      const qualityCellId = (created.data as { cellId: string }).cellId;

      const result = await send({ type: 'prepare-publication', qualityCellIds: [qualityCellId] });

      expect(result.ok).toBe(true);
      expect((await inspect()).publicationDraft.includedQualityCellIds).toEqual([qualityCellId]);
    });

    it('refuses a source cell that is not a query', async () => {
      await renderWorkspace();
      const created = await send({ type: 'create-cell', sql: 'SELECT 1', kind: 'quality', name: 'Check' });

      const result = await send({
        type: 'prepare-publication', sourceCellId: (created.data as { cellId: string }).cellId,
      });

      expect(result).toEqual({ ok: false, message: 'The publication source must be a query cell.' });
      expect((await inspect()).bottomTab).toBe('results');
    });

    it('refuses quality cell IDs that are not quality checks', async () => {
      await renderWorkspace();
      const queryCellId = (await inspect()).notebooks[0].cells[0].id;

      const result = await send({ type: 'prepare-publication', qualityCellIds: [queryCellId] });

      expect(result.ok).toBe(false);
      expect(result.message).toContain('must exist and be marked as a quality check');
    });

    it('merges field descriptions instead of replacing them', async () => {
      await renderWorkspace();

      await send({ type: 'prepare-publication', fieldDescriptions: { variety: 'Coffee variety' } });
      await send({ type: 'prepare-publication', fieldDescriptions: { inventory_kg: 'Kilograms on hand' } });

      expect((await inspect()).publicationDraft.fieldDescriptions).toEqual({
        variety: 'Coffee variety', inventory_kg: 'Kilograms on hand',
      });
    });
  });

  describe('view and session', () => {
    it('switches the bottom tab', async () => {
      await renderWorkspace();

      await send({ type: 'set-view', bottomTab: 'publishing' });
      expect((await inspect()).bottomTab).toBe('publishing');
      expect(await screen.findByText('Publish a table')).toBeInTheDocument();

      await send({ type: 'set-view', bottomTab: 'results' });
      expect((await inspect()).bottomTab).toBe('results');
    });

    it('opens, closes, and sets a custom output-panel height', async () => {
      await renderWorkspace();

      await send({ type: 'set-view', bottomPanelHeight: 510 });
      expect((await inspect()).bottomPanelHeight).toBe(510);

      await send({ type: 'set-view', bottomPanelOpen: false });
      expect((await inspect()).bottomPanelOpen).toBe(false);
      expect(await screen.findByRole('button', { name: 'Open output panel' })).toBeInTheDocument();

      await send({ type: 'set-view', bottomPanelOpen: true, bottomPanelHeight: 240 });
      const state = await inspect();
      expect(state.bottomPanelOpen).toBe(true);
      expect(state.bottomPanelHeight).toBe(240);
      expect(await screen.findByRole('button', { name: 'Close output panel' })).toBeInTheDocument();
    });

    it('collapses and expands the table explorer', async () => {
      await renderWorkspace();

      await send({ type: 'set-view', explorerCollapsed: true });
      expect(await screen.findByLabelText('Expand catalog')).toBeInTheDocument();

      await send({ type: 'set-view', explorerCollapsed: false });
      expect(await screen.findByLabelText('Collapse catalog')).toBeInTheDocument();
    });

    it('resets the workspace, clearing results and ephemeral bundles', async () => {
      await renderWorkspace();
      const cellId = (await inspect()).notebooks[0].cells[0].id;
      await send({ type: 'run-cell', cellId });
      expect((await inspect()).notebooks[0].cells[0].result).toBeDefined();

      const result = await send({ type: 'reset-workspace' });

      expect(result.ok).toBe(true);
      expect(mocks.reset).toHaveBeenCalled();
      expect(mocks.clearEphemeralBundles).toHaveBeenCalled();
      expect((await inspect()).notebooks[0].cells[0].result).toBeUndefined();
    });
  });

  describe('chained actions inside one tool call', () => {
    // Regression: the bridge handler used to read component state from the render
    // closure, so the second action in a chain ran against pre-update state and
    // failed with "Cell not found."
    it('runs a cell created moments earlier, before React can re-render', async () => {
      await renderWorkspace();

      let created!: DevelopmentBridgeResult;
      let executed!: DevelopmentBridgeResult;
      await act(async () => {
        created = await requestDevelopmentAction({ type: 'create-cell', sql: 'SELECT 1;', kind: 'query', activate: true });
        executed = await requestDevelopmentAction({ type: 'run-cell', cellId: (created.data as { cellId: string }).cellId });
      });

      expect(created.ok).toBe(true);
      expect(executed.ok).toBe(true);
      expect((executed.data as { result: QueryResult }).result.rowCount).toBe(2);
      expect(mocks.run).toHaveBeenCalledWith('SELECT 1;', expect.anything());
    });

    it('inspects, edits, and re-runs without a render in between', async () => {
      await renderWorkspace();

      let state!: InspectState;
      let updated!: DevelopmentBridgeResult;
      let executed!: DevelopmentBridgeResult;
      await act(async () => {
        state = (await requestDevelopmentAction({ type: 'inspect' })).data as InspectState;
        const cellId = state.notebooks[0].cells[0].id;
        updated = await requestDevelopmentAction({ type: 'update-cell', cellId, sql: 'SELECT 99;' });
        executed = await requestDevelopmentAction({ type: 'run-cell', cellId });
      });

      expect(updated.ok).toBe(true);
      expect(executed.ok).toBe(true);
      expect(mocks.run).toHaveBeenCalledWith('SELECT 99;', expect.anything());
    });

    it('creates a notebook and immediately adds a cell to it', async () => {
      await renderWorkspace();

      let created!: DevelopmentBridgeResult;
      let cell!: DevelopmentBridgeResult;
      await act(async () => {
        created = await requestDevelopmentAction({ type: 'create-notebook', name: 'Origins' });
        cell = await requestDevelopmentAction({
          type: 'create-cell', notebookId: (created.data as { notebookId: string }).notebookId, sql: 'SELECT 3;',
        });
      });

      expect(cell.ok).toBe(true);
      const state = await inspect();
      expect(state.notebooks[1].cells.map((item) => item.sql)).toContain('SELECT 3;');
    });
  });

  describe('run_duckdb_sql end to end', () => {
    it('creates a visible cell, runs it, and reports the rows back to the agent', async () => {
      await renderWorkspace({ withTools: true });

      let output!: string;
      await act(async () => {
        const result = await executeTool('run_duckdb_sql', { sql: 'SELECT variety FROM happy_coffee.coffee_inventory;' });
        output = result.content.map((item) => item.text).join('\n');
      });

      expect(output).toContain('added it as a visible notebook cell');
      expect(output).toContain('Rows: 2');
      expect(output).toContain('variety-0');
      expect(output).not.toContain('Cell not found');

      const state = await inspect();
      expect(state.notebooks[0].cells).toHaveLength(2);
      expect(state.notebooks[0].cells[1]).toMatchObject({
        sql: 'SELECT variety FROM happy_coffee.coffee_inventory;',
        result: { rowCount: 2 },
      });
      expect(screen.getAllByTestId('cell-sql')[1]).toHaveTextContent('SELECT variety FROM happy_coffee.coffee_inventory;');
    });

    it('reports the DuckDB error instead of pretending the cell ran', async () => {
      await renderWorkspace({ withTools: true });
      mocks.run.mockRejectedValueOnce(new Error('Parser Error: syntax error'));

      let output!: string;
      await act(async () => {
        const result = await executeTool('run_duckdb_sql', { sql: 'SELEC 1' });
        output = result.content.map((item) => item.text).join('\n');
      });

      expect(output).toContain('SQL execution failed: Parser Error: syntax error');
    });
  });
});
