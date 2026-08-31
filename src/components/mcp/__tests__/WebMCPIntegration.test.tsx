import { render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebMCPIntegration } from '../WebMCPIntegration';
import { useCatalogData } from '../../../hooks/useCatalogData';

// Mock the dependencies
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: vi.fn(),
    };
});

vi.mock('../../../hooks/useCatalogData', () => ({
    useCatalogData: vi.fn(),
}));

describe('WebMCPIntegration', () => {
    let mockNavigate: any;
    let modelContextMock: any;

    beforeEach(() => {
        mockNavigate = vi.fn();
        (useNavigate as any).mockReturnValue(mockNavigate);

        (useCatalogData as any).mockReturnValue({
            initialized: true,
            datasets: [{ id: 'ds-1', name: 'mock_dataset', displayName: 'Mock Dataset', type: 'Table', owner: 'Test', source: 'MockDB', schema: { database: 'demo', schema: 'public' }, fields: [{ name: 'amount' }], sampleData: [{ amount: 42 }], qualityScore: 90 }],
            dataSources: [{ id: 'source-1', name: 'Mock source', system: 'MockDB', owner: 'Test', type: 'Database', connectionStatus: 'Connected' }],
            lineage: [{ id: 'lineage-1', name: 'Bronze mock', type: 'Bronze', datasetIds: ['ds-1'], location: 'demo.public', metadata: {} }],
            pipelines: [{ id: 'p-1', name: 'mock_pipeline', displayName: 'Mock Pipeline', inputDatasets: [], outputDatasets: ['ds-1'] }],
            pipelineRuns: [{ pipelineId: 'p-1', id: 'run-1', logs: [{ message: 'Test Log' }] }],
            qualityChecks: [{ id: 'check-1', datasetId: 'ds-1', datasetName: 'Mock Dataset', checkType: 'Schema', result: 'Passed', severity: 'Info', message: 'Schema matches', rule: 'type check', timestamp: new Date().toISOString(), metadata: {} }],
            costs: [{ id: 'c-1', category: 'Compute', subcategory: 'Snowflake Warehouse Credits', entityType: 'Pipeline', entityId: 'p-1', amount: 150.50, currency: 'USD', date: new Date().toISOString(), description: 'Compute cost' }],
        });

        modelContextMock = {
            registerTool: vi.fn().mockResolvedValue(undefined)
        };
        (global.document as any).modelContext = modelContextMock;
    });

    afterEach(() => {
        vi.clearAllMocks();
        delete (global.document as any).modelContext;
    });

    it('handles missing modelContext safely', () => {
        delete (global.document as any).modelContext;
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        render(
            <MemoryRouter>
                <WebMCPIntegration />
            </MemoryRouter>
        );

        expect(consoleSpy).toHaveBeenCalledWith('WebMCP not available (document.modelContext is undefined).');
        consoleSpy.mockRestore();
    });

  it('registers 31 tools when mounted', () => {
        render(
            <MemoryRouter>
                <WebMCPIntegration />
            </MemoryRouter>
        );

        expect(modelContextMock.registerTool).toHaveBeenCalledTimes(31);
        expect(modelContextMock.registerTool.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
        const triggerTool = modelContextMock.registerTool.mock.calls
            .map(([tool]: [any]) => tool)
            .find((tool: any) => tool.name === 'trigger_pipeline_execution');
        expect(triggerTool.annotations.readOnlyHint).toBe(false);
        const queryTool = modelContextMock.registerTool.mock.calls
            .map(([tool]: [any]) => tool)
            .find((tool: any) => tool.name === 'run_duckdb_sql');
        expect(queryTool.annotations.readOnlyHint).toBe(false);
    });

    describe('Tool Execution', () => {
        // Helper to get a registered tool by name
        const getTool = (name: string) => {
            render(
                <MemoryRouter>
                    <WebMCPIntegration />
                </MemoryRouter>
            );
            const tools = modelContextMock.registerTool.mock.calls.map(([tool]: [any]) => tool);
            return tools.find((tool: any) => tool.name === name);
        };

        it('returns a versioned portal snapshot without requiring UI inspection', async () => {
            const tool = getTool('get_portal_snapshot');

            const result = JSON.parse(await tool.execute({}));

            expect(result).toMatchObject({
                schemaVersion: '1.0', kind: 'portal_snapshot', ok: true,
                data: { counts: { datasets: 1, dataSources: 1, qualityChecks: 1 } },
            });
            expect(result.data.routes).toEqual(expect.arrayContaining([
                expect.objectContaining({ path: '/develop' }),
                expect.objectContaining({ path: '/sources' }),
            ]));
            expect(result.nextActions).toContain('inspect_development_workspace');
        });

        it('returns source, quality, lineage, and dataset-preview data as structured contracts', async () => {
            const sources = JSON.parse(await getTool('list_data_sources').execute({}));
            expect(sources).toMatchObject({ kind: 'data_source_list', data: { total: 1 } });
            expect(sources.data.sources[0].linkedDatasetIds).toEqual(['ds-1']);

            const quality = JSON.parse(await getTool('list_quality_checks').execute({ datasetId: 'ds-1' }));
            expect(quality).toMatchObject({ kind: 'quality_check_list', data: { total: 1 } });

            const lineage = JSON.parse(await getTool('get_dataset_lineage').execute({ datasetId: 'ds-1' }));
            expect(lineage.data.nodes[0]).toMatchObject({ name: 'Bronze mock' });

            const preview = JSON.parse(await getTool('preview_dataset_data').execute({ id: 'ds-1', columns: ['amount'] }));
            expect(preview).toMatchObject({ kind: 'dataset_preview', data: { rows: [{ amount: 42 }] } });
        });

        it('view_home_dashboard navigates correctly', async () => {
            const tool = getTool('view_home_dashboard');
            const result = await tool.execute({ tab: 'datasets' });

            expect(mockNavigate).toHaveBeenCalledWith('/?tab=datasets');
            expect(result).toContain('datasets');
        });

        it('search_global_catalog navigates correctly', async () => {
            const tool = getTool('search_global_catalog');
            await tool.execute({ query: 'test query', type: 'sources' });

            expect(mockNavigate).toHaveBeenCalledWith('/search?q=test%20query&tab=sources');
        });

        it('filter_datasets pushes exact searchParams', async () => {
            const tool = getTool('filter_datasets');
            await tool.execute({ query: 'sales', types: ['dbt', 'sql'], sortKey: 'updated', page: 2 });

            expect(mockNavigate).toHaveBeenCalledWith('/datasets?q=sales&type=dbt&type=sql&sort=updated&page=2');
        });

        it('view_dataset_details paths correctly', async () => {
            const tool = getTool('view_dataset_details');
            await tool.execute({ id: 'ds-1', tab: 'costs', dateRange: '30' });

            expect(mockNavigate).toHaveBeenCalledWith('/datasets/ds-1?tab=costs&dateRange=30');
        });

        it('view_pipeline_details paths correctly for costs', async () => {
            const tool = getTool('view_pipeline_details');
            const result = await tool.execute({ id: 'p-1', tab: 'costs', dateRange: '7' });

            expect(mockNavigate).toHaveBeenCalledWith('/pipelines/p-1?tab=costs&dateRange=7');
            expect(result).toContain('producedDatasets');
            expect(result).toContain('150.5');
        });

        it('view_pipeline_run_logs retrieves logs', async () => {
            const tool = getTool('view_pipeline_run_logs');
            const result = await tool.execute({ pipelineId: 'p-1', runId: 'run-1' });

            expect(mockNavigate).toHaveBeenCalledWith('/pipelines/p-1?tab=runs&run=run-1');
            expect(result).toContain('Test Log');
        });

        it('analyze_infrastructure_costs navigates and computes aggregation correctly', async () => {
            const tool = getTool('analyze_infrastructure_costs');
            const result = await tool.execute({ dateRange: '30', search: 'compute' });

            expect(mockNavigate).toHaveBeenCalledWith('/costs?range=30&q=compute');
            expect(result).toContain('150.50');
            expect(result).toContain('Snowflake');
        });
    });
});
