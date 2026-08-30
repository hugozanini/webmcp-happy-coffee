import { render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DevelopmentBridgeResult } from '../../../lib/development-bridge';

const mocks = vi.hoisted(() => ({ requestDevelopmentAction: vi.fn() }));

vi.mock('../../../lib/development-bridge', () => ({
  requestDevelopmentAction: mocks.requestDevelopmentAction,
  registerDevelopmentActionHandler: vi.fn(() => () => undefined),
}));

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: vi.fn(),
}));

vi.mock('../../../hooks/useCatalogData', () => ({
  useCatalogData: () => ({ datasets: [], pipelines: [], pipelineRuns: [], costs: [] }),
}));

import { WebMCPIntegration } from '../WebMCPIntegration';

type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
  annotations: { readOnlyHint: boolean };
  execute: (args: Record<string, unknown>) => Promise<string>;
};

describe('development WebMCP tools', () => {
  let navigate: ReturnType<typeof vi.fn>;
  let registerTool: ReturnType<typeof vi.fn>;

  const respond = (result: DevelopmentBridgeResult) => mocks.requestDevelopmentAction.mockResolvedValue(result);

  const tools = (): RegisteredTool[] => {
    render(<MemoryRouter><WebMCPIntegration /></MemoryRouter>);
    return registerTool.mock.calls.map((call) => call[0] as RegisteredTool);
  };

  const tool = (name: string) => {
    const found = tools().find((item) => item.name === name);
    if (!found) throw new Error(`${name} is not registered`);
    return found;
  };

  const actions = () => mocks.requestDevelopmentAction.mock.calls.map((call) => call[0]);
  const lastAction = () => actions()[actions().length - 1];

  beforeEach(() => {
    navigate = vi.fn();
    (useNavigate as unknown as ReturnType<typeof vi.fn>).mockReturnValue(navigate);
    registerTool = vi.fn().mockResolvedValue(undefined);
    (document as unknown as { modelContext: unknown }).modelContext = { registerTool };
    respond({ ok: true, message: 'ok' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (document as unknown as { modelContext?: unknown }).modelContext;
  });

  describe('registration', () => {
    it('registers every development workspace tool', () => {
      const names = tools().map((item) => item.name);

      expect(names).toEqual(expect.arrayContaining([
        'open_development_workspace', 'inspect_development_workspace', 'inspect_development_tables',
        'create_development_notebook', 'select_development_notebook', 'close_development_notebook',
        'create_development_sql_cell', 'update_development_sql_cell', 'delete_development_sql_cell',
        'run_development_sql_cell', 'run_duckdb_sql', 'create_workspace_table',
        'prepare_table_publication', 'open_table_publishing', 'reset_development_workspace',
      ]));
      expect(new Set(names).size).toBe(names.length);
    });

    it('marks inspection read-only and state changes not read-only', () => {
      const byName = Object.fromEntries(tools().map((item) => [item.name, item.annotations.readOnlyHint]));

      expect(byName['inspect_development_workspace']).toBe(true);
      expect(byName['inspect_development_tables']).toBe(true);
      for (const name of [
        'create_development_notebook', 'select_development_notebook', 'close_development_notebook',
        'create_development_sql_cell', 'update_development_sql_cell', 'delete_development_sql_cell',
        'run_development_sql_cell', 'prepare_table_publication', 'reset_development_workspace',
      ]) {
        expect(byName[name]).toBe(false);
      }
    });

    it('requires the identifiers the workspace needs to act', () => {
      expect(tool('select_development_notebook').inputSchema.required).toEqual(['notebookId']);
      expect(tool('close_development_notebook').inputSchema.required).toEqual(['notebookId']);
      expect(tool('update_development_sql_cell').inputSchema.required).toEqual(['cellId']);
      expect(tool('delete_development_sql_cell').inputSchema.required).toEqual(['cellId']);
      expect(tool('run_development_sql_cell').inputSchema.required).toEqual(['cellId']);
      expect(tool('create_development_sql_cell').inputSchema.required).toEqual(['sql']);
    });

    it('tells the agent that publishing stays with the user', () => {
      expect(tool('prepare_table_publication').description).toContain('cannot publish');
      expect(tool('prepare_table_publication').inputSchema.required).toBeUndefined();
    });
  });

  describe('inspect_development_workspace', () => {
    it('opens Develop and returns the workspace state as JSON', async () => {
      respond({ ok: true, message: 'state', data: { notebooks: [{ id: 'nb-1' }] } });

      const output = await tool('inspect_development_workspace').execute({});

      expect(navigate).toHaveBeenCalledWith('/develop');
      expect(lastAction()).toEqual({ type: 'inspect' });
      expect(JSON.parse(output)).toEqual({ notebooks: [{ id: 'nb-1' }] });
    });

    it('explains a failure instead of returning empty state', async () => {
      respond({ ok: false, message: 'DuckDB is still starting.' });

      const output = await tool('inspect_development_workspace').execute({});

      expect(output).toBe('Could not inspect the development workspace: DuckDB is still starting.');
    });
  });

  describe('notebook tools', () => {
    it('creates a notebook with an optional name', async () => {
      respond({ ok: true, message: 'Created and selected notebook Origins.', data: { notebookId: 'nb-2' } });

      const output = await tool('create_development_notebook').execute({ name: 'Origins' });

      expect(lastAction()).toEqual({ type: 'create-notebook', name: 'Origins' });
      expect(output).toContain('Created and selected notebook Origins.');
      expect(output).toContain('nb-2');
    });

    it('selects a notebook by ID', async () => {
      respond({ ok: true, message: 'Selected notebook Origins.' });

      const output = await tool('select_development_notebook').execute({ notebookId: 'nb-2' });

      expect(lastAction()).toEqual({ type: 'select-notebook', notebookId: 'nb-2' });
      expect(output).toBe('Selected notebook Origins.');
    });

    it('closes a notebook and passes the refusal straight back', async () => {
      respond({ ok: false, message: 'The only notebook cannot be closed.' });

      const output = await tool('close_development_notebook').execute({ notebookId: 'nb-1' });

      expect(lastAction()).toEqual({ type: 'close-notebook', notebookId: 'nb-1' });
      expect(output).toBe('The only notebook cannot be closed.');
    });
  });

  describe('cell tools', () => {
    it('creates a query cell in the active notebook by default', async () => {
      respond({ ok: true, message: 'Created query cell.', data: { cellId: 'c-9' } });

      const output = await tool('create_development_sql_cell').execute({ sql: 'SELECT 1' });

      expect(lastAction()).toMatchObject({ type: 'create-cell', sql: 'SELECT 1', kind: 'query', activate: true });
      expect(output).toContain('Added a query cell');
      expect(output).toContain('c-9');
    });

    it('creates a quality-check cell with its metadata in a chosen notebook', async () => {
      respond({ ok: true, message: 'Created quality-check cell.', data: { cellId: 'c-10' } });

      const output = await tool('create_development_sql_cell').execute({
        sql: 'SELECT * FROM t WHERE weight_kg < 0', notebookId: 'nb-2', kind: 'quality',
        name: 'No negative weights', description: 'Weights must be positive', severity: 'Critical',
      });

      expect(lastAction()).toMatchObject({
        type: 'create-cell', notebookId: 'nb-2', kind: 'quality',
        name: 'No negative weights', description: 'Weights must be positive', severity: 'Critical',
      });
      expect(output).toContain('Added a quality-check cell');
    });

    it('rejects blank SQL without touching the workspace', async () => {
      const output = await tool('create_development_sql_cell').execute({ sql: '   ' });

      expect(mocks.requestDevelopmentAction).not.toHaveBeenCalled();
      expect(output).toBe('SQL is required to create a notebook cell.');
    });

    it('reports a failed cell creation', async () => {
      respond({ ok: false, message: 'Notebook not found.' });

      const output = await tool('create_development_sql_cell').execute({ sql: 'SELECT 1', notebookId: 'nope' });

      expect(output).toBe('Could not create the notebook cell: Notebook not found.');
    });

    it('updates a cell, forwarding only the fields the agent supplied', async () => {
      respond({ ok: true, message: 'Updated development cell.' });

      await tool('update_development_sql_cell').execute({ cellId: 'c-1', sql: 'SELECT 2' });

      expect(lastAction()).toEqual({
        type: 'update-cell', cellId: 'c-1', sql: 'SELECT 2',
        kind: undefined, name: undefined, description: undefined, severity: undefined,
      });
    });

    it('converts a cell into a quality check', async () => {
      respond({ ok: true, message: 'Updated development cell.' });

      await tool('update_development_sql_cell').execute({
        cellId: 'c-1', kind: 'quality', name: 'Freshness', description: 'Rows must be recent', severity: 'Error',
      });

      expect(lastAction()).toMatchObject({
        type: 'update-cell', cellId: 'c-1', kind: 'quality',
        name: 'Freshness', description: 'Rows must be recent', severity: 'Error',
      });
    });

    it('deletes a cell', async () => {
      respond({ ok: true, message: 'Deleted development cell.' });

      const output = await tool('delete_development_sql_cell').execute({ cellId: 'c-1' });

      expect(lastAction()).toEqual({ type: 'delete-cell', cellId: 'c-1' });
      expect(output).toBe('Deleted development cell.');
    });

    it('runs a cell and returns its result', async () => {
      respond({ ok: true, message: 'Executed development cell.', data: { result: { rowCount: 12 } } });

      const output = await tool('run_development_sql_cell').execute({ cellId: 'c-1' });

      expect(lastAction()).toEqual({ type: 'run-cell', cellId: 'c-1' });
      expect(output).toContain('Executed development cell.');
      expect(output).toContain('"rowCount": 12');
    });

    it('returns the SQL error when a run fails', async () => {
      respond({ ok: false, message: 'Catalog Error: no such table' });

      const output = await tool('run_development_sql_cell').execute({ cellId: 'c-1' });

      expect(output).toBe('Catalog Error: no such table');
    });
  });

  describe('publishing tools', () => {
    it('stages a publication draft from cells the agent already created', async () => {
      respond({ ok: true, message: 'Prepared Table Publishing.' });

      await tool('prepare_table_publication').execute({
        sourceCellId: 'c-1', name: 'inventory_by_origin', displayName: 'Inventory by Origin',
        description: 'Rolled up by origin.', owner: 'Supply Chain', tags: 'inventory',
        criticality: 'High', frequency: 'Daily', cron: '0 6 * * *',
        transformations: 'Groups by origin.', qualityCellIds: ['c-2'],
        fieldDescriptions: { origin: 'Farm origin' },
      });

      expect(navigate).toHaveBeenCalledWith('/develop');
      expect(lastAction()).toEqual({
        type: 'prepare-publication', sourceCellId: 'c-1', name: 'inventory_by_origin',
        displayName: 'Inventory by Origin', description: 'Rolled up by origin.', owner: 'Supply Chain',
        tags: 'inventory', criticality: 'High', frequency: 'Daily', cron: '0 6 * * *',
        transformations: 'Groups by origin.', qualityCellIds: ['c-2'],
        fieldDescriptions: { origin: 'Farm origin' },
      });
    });

    it('never issues a publish action of its own', async () => {
      await tool('prepare_table_publication').execute({ name: 'inventory_by_origin' });

      expect(lastAction().type).toBe('prepare-publication');
      expect(actions().map((action) => action.type)).not.toContain('publish');
    });

    it('opens the publishing tab and tells the agent the user clicks Publish', async () => {
      const output = await tool('open_table_publishing').execute({});

      expect(lastAction()).toEqual({ type: 'set-view', bottomTab: 'publishing' });
      expect(output).toContain('let the user click Publish table');
    });

    it('reports when the publishing tab cannot be opened', async () => {
      respond({ ok: false, message: 'The workspace is not mounted.' });

      const output = await tool('open_table_publishing').execute({});

      expect(output).toBe('Could not open Table Publishing: The workspace is not mounted.');
    });
  });

  describe('reset_development_workspace', () => {
    it('resets the browser-local session', async () => {
      respond({ ok: true, message: 'Reset the local DuckDB workspace and removed ephemeral published bundles.' });

      const output = await tool('reset_development_workspace').execute({});

      expect(navigate).toHaveBeenCalledWith('/develop');
      expect(lastAction()).toEqual({ type: 'reset-workspace' });
      expect(output).toContain('removed ephemeral published bundles');
    });
  });

  describe('run_duckdb_sql', () => {
    it('creates a visible cell and then runs it', async () => {
      mocks.requestDevelopmentAction
        .mockResolvedValueOnce({ ok: true, message: 'Created query cell.', data: { cellId: 'c-5' } })
        .mockResolvedValueOnce({
          ok: true, message: 'Executed development cell.',
          data: { result: { rowCount: 3, elapsedMs: 7, truncated: false, rows: [{ variety: 'Bourbon' }] } },
        });

      const output = await tool('run_duckdb_sql').execute({ sql: 'SELECT 1' });

      const [first, second] = actions();
      expect(first).toMatchObject({ type: 'create-cell', sql: 'SELECT 1', kind: 'query', activate: true });
      expect(second).toEqual({ type: 'run-cell', cellId: 'c-5' });
      expect(output).toContain('Rows: 3; elapsed: 7 ms');
      expect(output).toContain('Bourbon');
    });

    it('stops after a failed cell creation rather than running a phantom cell', async () => {
      respond({ ok: false, message: 'Notebook not found.' });

      const output = await tool('run_duckdb_sql').execute({ sql: 'SELECT 1' });

      expect(mocks.requestDevelopmentAction).toHaveBeenCalledTimes(1);
      expect(output).toBe('Could not create the visible SQL cell: Notebook not found.');
    });

    it('reports a truncated result set', async () => {
      mocks.requestDevelopmentAction
        .mockResolvedValueOnce({ ok: true, message: 'Created query cell.', data: { cellId: 'c-6' } })
        .mockResolvedValueOnce({
          ok: true, message: 'Executed development cell.',
          data: { result: { rowCount: 5000, elapsedMs: 20, truncated: true, rows: [] } },
        });

      const output = await tool('run_duckdb_sql').execute({ sql: 'SELECT 1' });

      expect(output).toContain('first 250 rows returned');
    });
  });
});
