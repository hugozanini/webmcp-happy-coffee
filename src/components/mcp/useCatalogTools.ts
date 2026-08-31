import { useLocation, useNavigate } from 'react-router-dom';
import { useCatalogData } from '../../hooks/useCatalogData';
import { useCatalogStore } from '../../store/catalog-store';
import { hasDevelopmentActionHandler, requestDevelopmentAction } from '../../lib/development-bridge';
import { webmcpResponse } from '../../lib/webmcp-contract';

// ------------------------------------------------------------------
// Shared execution logic for the WebMCP catalog tools.
// ------------------------------------------------------------------

export type ToolResult = { content: Array<{ type: string; text: string }> };

function text(str: string): ToolResult {
  return { content: [{ type: 'text', text: str }] };
}

export function useCatalogTools() {
  const navigate = useNavigate();
  const location = useLocation();
  const { initialized, datasets, dataSources, lineage, pipelines, pipelineRuns, qualityChecks, costs } = useCatalogData();
  const startMockPipelineRun = useCatalogStore((s) => s.startMockPipelineRun);

  const executeTool = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> => {
    switch (name) {
      // ----------------------------------------------------------------
      case 'get_portal_snapshot': {
        const route = `${location.pathname}${location.search}`;
        return text(webmcpResponse('portal_snapshot', {
          portal: {
            name: 'Happy Coffee Data Developer Portal',
            dataMode: 'generated-demo-data',
            executionMode: 'browser-local DuckDB for Develop',
            initialized: Boolean(initialized),
          },
          counts: {
            datasets: datasets.length,
            dataSources: dataSources.length,
            pipelines: pipelines.length,
            pipelineRuns: pipelineRuns.length,
            qualityChecks: qualityChecks.length,
            lineageNodes: lineage.length,
            costEntries: costs.length,
          },
          routes: [
            { path: '/', purpose: 'Home dashboard and recent catalog activity' },
            { path: '/datasets', purpose: 'Dataset catalog and metadata' },
            { path: '/sources', purpose: 'Source health and connected datasets' },
            { path: '/quality', purpose: 'Quality-check history and failures' },
            { path: '/pipelines', purpose: 'Pipelines, runs, and logs' },
            { path: '/costs', purpose: 'Infrastructure cost analysis' },
            { path: '/develop', purpose: 'DuckDB notebook and user-confirmed table publishing' },
          ],
          safeguards: {
            publishing: 'Agents may stage a publication but only a user click can publish it.',
            pipelineExecution: 'Pipeline execution is mocked and browser-local to this demo.',
            expiry: 'Develop workspace tables and published demo bundles expire with the local session.',
          },
        }, {
          navigation: { route },
          nextActions: ['list_data_sources', 'filter_datasets', 'list_quality_checks', 'filter_pipelines', 'analyze_infrastructure_costs', 'inspect_development_workspace'],
        }));
      }

      // ----------------------------------------------------------------
      case 'list_data_sources': {
        const { query = '', statuses } = args as { query?: string; statuses?: string[] };
        const q = query.toLowerCase();
        const sources = dataSources.filter((source) =>
          (!q || [source.name, source.system, source.owner, source.type].some((value) => value.toLowerCase().includes(q))) &&
          (!statuses?.length || statuses.includes(source.connectionStatus)),
        ).map((source) => ({ ...source, linkedDatasetIds: datasets.filter((dataset) => dataset.source === source.name).map((dataset) => dataset.id) }));
        navigate(`/sources?${new URLSearchParams({ ...(query ? { q: query } : {}) }).toString()}`);
        return text(webmcpResponse('data_source_list', { total: sources.length, sources }, { navigation: { route: '/sources' }, nextActions: ['inspect_data_source', 'filter_datasets'] }));
      }

      case 'inspect_data_source': {
        const id = args['id'] as string;
        const source = dataSources.find((item) => item.id === id);
        if (!source) return text(webmcpResponse('data_source_detail', { id, found: false }, { navigation: { route: '/sources', selectedId: id } }));
        const linkedDatasets = datasets.filter((dataset) => dataset.source === source.name).map((dataset) => ({ id: dataset.id, name: dataset.displayName, type: dataset.type, qualityScore: dataset.qualityScore }));
        navigate(`/sources?source=${encodeURIComponent(id)}`);
        return text(webmcpResponse('data_source_detail', { source, linkedDatasets }, { navigation: { route: '/sources', selectedId: id }, nextActions: ['view_dataset_details', 'get_dataset_lineage'] }));
      }

      case 'list_quality_checks': {
        const { datasetId, query = '', severities, results, checkTypes, limit = 50 } = args as { datasetId?: string; query?: string; severities?: string[]; results?: string[]; checkTypes?: string[]; limit?: number };
        const q = query.toLowerCase();
        const checks = qualityChecks.filter((check) =>
          (!datasetId || check.datasetId === datasetId) &&
          (!q || [check.datasetName, check.message, check.rule].some((value) => value.toLowerCase().includes(q))) &&
          (!severities?.length || severities.includes(check.severity)) &&
          (!results?.length || results.includes(check.result)) &&
          (!checkTypes?.length || checkTypes.includes(check.checkType)),
        ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        navigate(`/quality${datasetId ? `?dataset=${encodeURIComponent(datasetId)}` : ''}`);
        return text(webmcpResponse('quality_check_list', { total: checks.length, checks: checks.slice(0, Math.min(Math.max(1, limit), 100)), truncated: checks.length > limit }, { navigation: { route: '/quality', selectedId: datasetId }, nextActions: ['inspect_quality_check', 'view_dataset_details'] }));
      }

      case 'inspect_quality_check': {
        const id = args['id'] as string;
        const check = qualityChecks.find((item) => item.id === id);
        navigate(`/quality?check=${encodeURIComponent(id)}`);
        return text(webmcpResponse('quality_check_detail', { found: Boolean(check), check: check ?? null, dataset: check ? datasets.find((dataset) => dataset.id === check.datasetId) : null }, { navigation: { route: '/quality', selectedId: id } }));
      }

      case 'get_dataset_lineage': {
        const datasetId = args['datasetId'] as string;
        const dataset = datasets.find((item) => item.id === datasetId);
        const nodes = lineage.filter((node) => node.datasetIds.includes(datasetId)).map((node) => ({ ...node, datasets: node.datasetIds.map((id) => ({ id, name: datasets.find((item) => item.id === id)?.displayName ?? id })) }));
        const nodeIds = new Set(nodes.map((node) => node.id));
        const edges = nodes.filter((node) => node.parentId && nodeIds.has(node.parentId)).map((node) => ({ source: node.parentId!, target: node.id }));
        navigate(`/datasets/${datasetId}?tab=lineage`);
        return text(webmcpResponse('dataset_lineage', { found: Boolean(dataset), dataset: dataset ? { id: dataset.id, name: dataset.displayName } : null, nodes, edges }, { navigation: { route: `/datasets/${datasetId}`, selectedId: datasetId, tab: 'lineage' }, nextActions: ['view_dataset_details', 'view_pipeline_details'] }));
      }

      case 'preview_dataset_data': {
        const { id, limit = 25, offset = 0, columns } = args as { id: string; limit?: number; offset?: number; columns?: string[] };
        const dataset = datasets.find((item) => item.id === id);
        if (!dataset) return text(webmcpResponse('dataset_preview', { found: false, id }, { navigation: { route: '/datasets', selectedId: id } }));
        const availableColumns = dataset.fields.map((field) => field.name);
        const selectedColumns = columns?.length ? columns.filter((column) => availableColumns.includes(column)) : availableColumns;
        const rows = dataset.sampleData.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(Math.max(1, limit), 100)).map((row) => Object.fromEntries(selectedColumns.map((column) => [column, row[column]])));
        navigate(`/datasets/${id}?tab=data`);
        return text(webmcpResponse('dataset_preview', { dataset: { id: dataset.id, name: dataset.displayName }, columns: selectedColumns, offset, totalSampleRows: dataset.sampleData.length, rows }, { navigation: { route: `/datasets/${id}`, selectedId: id, tab: 'data' }, nextActions: ['view_dataset_details', 'get_dataset_lineage'] }));
      }

      case 'list_pipeline_runs': {
        const { pipelineId, statuses, limit = 50, offset = 0 } = args as { pipelineId?: string; statuses?: string[]; limit?: number; offset?: number };
        const matching = pipelineRuns.filter((run) => (!pipelineId || run.pipelineId === pipelineId) && (!statuses?.length || statuses.includes(run.status))).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
        const page = matching.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(Math.max(1, limit), 100)).map((run) => ({
          id: run.id, pipelineId: run.pipelineId, pipelineName: run.pipelineName, runNumber: run.runNumber, status: run.status,
          startTime: run.startTime, endTime: run.endTime, duration: run.duration, recordsProcessed: run.recordsProcessed,
          recordsFailed: run.recordsFailed, triggerType: run.triggerType, environment: run.parameters?.environment ?? null,
        }));
        navigate(pipelineId ? `/pipelines/${pipelineId}?tab=runs` : '/pipelines');
        return text(webmcpResponse('pipeline_run_list', { total: matching.length, offset, runs: page }, { navigation: { route: pipelineId ? `/pipelines/${pipelineId}` : '/pipelines', selectedId: pipelineId, tab: 'runs' }, nextActions: ['inspect_pipeline_run', 'view_pipeline_details'] }));
      }

      case 'inspect_pipeline_run': {
        const { pipelineId, runId } = args as { pipelineId: string; runId: string };
        const run = pipelineRuns.find((item) => item.pipelineId === pipelineId && item.id === runId);
        navigate(`/pipelines/${pipelineId}?tab=runs&run=${encodeURIComponent(runId)}`);
        return text(webmcpResponse('pipeline_run_detail', { found: Boolean(run), run: run ?? null, pipeline: pipelines.find((pipeline) => pipeline.id === pipelineId) ?? null }, { navigation: { route: `/pipelines/${pipelineId}`, selectedId: runId, tab: 'runs' }, notices: ['Pipeline run execution is mocked in this demo.'] }));
      }

      case 'list_cost_entries': {
        const { dateRange, category, entityType, entityId, search = '', limit = 50, offset = 0 } = args as { dateRange?: string; category?: string; entityType?: string; entityId?: string; search?: string; limit?: number; offset?: number };
        const cutoff = dateRange ? Date.now() - Number(dateRange) * 24 * 60 * 60 * 1000 : null;
        const q = search.toLowerCase();
        const matching = costs.filter((cost) =>
          (!cutoff || new Date(cost.date).getTime() >= cutoff) &&
          (!category || cost.category === category) &&
          (!entityType || cost.entityType === entityType) &&
          (!entityId || cost.entityId === entityId) &&
          (!q || [cost.description, cost.subcategory, cost.category].some((value) => value.toLowerCase().includes(q))),
        ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const page = matching.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(Math.max(1, limit), 100));
        const totalAmount = matching.reduce((sum, cost) => sum + cost.amount, 0);
        navigate(`/costs?${new URLSearchParams({ ...(dateRange ? { range: dateRange } : {}), ...(category ? { category } : {}), ...(entityType ? { entityType } : {}), ...(search ? { q: search } : {}) }).toString()}`);
        return text(webmcpResponse('cost_entry_list', { total: matching.length, offset, totalAmount, currency: 'USD', entries: page }, { navigation: { route: '/costs' }, nextActions: ['analyze_infrastructure_costs', 'view_dataset_details', 'view_pipeline_details'] }));
      }

      case 'get_development_workspace_status': {
        navigate('/develop');
        const { duckdbWorkspace } = await import('../../lib/duckdb-workspace');
        const session = await duckdbWorkspace.prepare(datasets);
        const tables = await duckdbWorkspace.listTables(datasets);
        return text(webmcpResponse('development_workspace_status', {
          ready: true,
          session,
          handlerMounted: hasDevelopmentActionHandler(),
          catalogTables: tables.filter((table) => table.schema === 'happy_coffee'),
          workspaceTables: tables.filter((table) => table.schema === 'workspace'),
        }, { navigation: { route: '/develop' }, nextActions: ['inspect_development_workspace', 'describe_development_table', 'create_development_sql_cell'] }));
      }

      case 'describe_development_table': {
        const { schema, name } = args as { schema: string; name: string };
        navigate('/develop');
        try {
          const { duckdbWorkspace } = await import('../../lib/duckdb-workspace');
          const columns = await duckdbWorkspace.describeTable(schema, name, datasets);
          return text(webmcpResponse('development_table_schema', { schema, name, columns }, { navigation: { route: '/develop' }, nextActions: ['preview_development_table', 'create_development_sql_cell'] }));
        } catch (error) {
          return text(webmcpResponse('development_table_schema', { schema, name, columns: [], error: error instanceof Error ? error.message : 'Unable to describe table.' }, { navigation: { route: '/develop' } }));
        }
      }

      case 'preview_development_table': {
        const { schema, name, limit, offset } = args as { schema: string; name: string; limit?: number; offset?: number };
        navigate('/develop');
        try {
          const { duckdbWorkspace } = await import('../../lib/duckdb-workspace');
          const result = await duckdbWorkspace.previewTable(schema, name, datasets, limit, offset);
          return text(webmcpResponse('development_table_preview', { schema, name, ...result }, { navigation: { route: '/develop' }, nextActions: ['create_development_sql_cell', 'run_duckdb_sql'] }));
        } catch (error) {
          return text(webmcpResponse('development_table_preview', { schema, name, rows: [], error: error instanceof Error ? error.message : 'Unable to preview table.' }, { navigation: { route: '/develop' } }));
        }
      }

      case 'set_development_view': {
        navigate('/develop');
        const result = await requestDevelopmentAction({
          type: 'set-view', bottomTab: args['bottomTab'] as 'results' | 'publishing' | undefined,
          explorerCollapsed: args['explorerCollapsed'] as boolean | undefined,
          bottomPanelOpen: args['bottomPanelOpen'] as boolean | undefined,
          bottomPanelHeight: args['bottomPanelHeight'] as number | undefined,
        });
        return text(webmcpResponse('development_view', { applied: result.ok, message: result.message }, { navigation: { route: '/develop', tab: args['bottomTab'] as string | undefined } }));
      }

      // ----------------------------------------------------------------
      case 'open_development_workspace': {
        navigate('/develop');
        try {
          const { duckdbWorkspace } = await import('../../lib/duckdb-workspace');
          const tables = await duckdbWorkspace.listTables(datasets);
          return text(
            `Opened the Happy Coffee development workspace. DuckDB is ready with ${tables.length} browser-local tables.\n` +
            `Catalog tables are in happy_coffee; temporary agent-created tables are in workspace and expire after 90 minutes.\n\n` +
            `Available tables:\n${tables.map((table) => `- ${table.schema}.${table.name}`).join('\n')}`,
          );
        } catch (error) {
          return text(`Opened the development workspace, but DuckDB could not start: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }

      // ----------------------------------------------------------------
      case 'run_duckdb_sql': {
        const sql = args['sql'] as string;
        navigate('/develop');
        const created = await requestDevelopmentAction({ type: 'create-cell', sql, kind: 'query', activate: true });
        if (!created.ok) return text(`Could not create the visible SQL cell: ${created.message}`);
        const { cellId } = created.data as { cellId: string };
        const execution = await requestDevelopmentAction({ type: 'run-cell', cellId });
        if (!execution.ok) return text(`SQL execution failed: ${execution.message}`);
        const result = (execution.data as { result: { rowCount: number; elapsedMs: number; truncated: boolean; rows: unknown[] } }).result;
        return text(
          `Ran SQL in the Happy Coffee browser workspace and added it as a visible notebook cell.\n` +
          `Rows: ${result.rowCount}; elapsed: ${result.elapsedMs} ms${result.truncated ? '; first 250 rows returned' : ''}.\n\n` +
          `${JSON.stringify(result.rows, null, 2)}`,
        );
      }

      // ----------------------------------------------------------------
      case 'create_workspace_table': {
        const { name, selectSql } = args as { name: string; selectSql: string };
        navigate('/develop');
        try {
          const { duckdbWorkspace } = await import('../../lib/duckdb-workspace');
          const table = await duckdbWorkspace.createTable(name, selectSql, datasets, 'agent');
          const tables = await duckdbWorkspace.listTables(datasets);
          return text(
            `Created temporary table ${table}. It is visible in the development workspace and will be deleted when the 90-minute browser session expires.\n\n` +
            `Workspace tables:\n${tables.filter((item) => item.schema === 'workspace').map((item) => `- workspace.${item.name}`).join('\n') || '- none'}`,
          );
        } catch (error) {
          return text(`Could not create the workspace table: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }

      // ----------------------------------------------------------------
      case 'inspect_development_tables': {
        navigate('/develop');
        try {
          const { duckdbWorkspace } = await import('../../lib/duckdb-workspace');
          const tables = await duckdbWorkspace.listTables(datasets);
          return text(
            `Development workspace tables:\n${tables.map((table) => `- ${table.schema}.${table.name} (${table.type})`).join('\n')}`,
          );
        } catch (error) {
          return text(`Could not inspect the development workspace: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }

      // ----------------------------------------------------------------
      case 'create_development_sql_cell': {
        const { sql, notebookId, kind = 'query', name = '', description = '', severity = 'Warning' } = args as {
          sql: string;
          notebookId?: string;
          kind?: 'query' | 'quality';
          name?: string;
          description?: string;
          severity?: 'Info' | 'Warning' | 'Error' | 'Critical';
        };
        if (!sql?.trim()) return text('SQL is required to create a notebook cell.');
        navigate('/develop');
        const result = await requestDevelopmentAction({ type: 'create-cell', notebookId, sql, kind, name, description, severity, activate: true });
        if (!result.ok) return text(`Could not create the notebook cell: ${result.message}`);
        return text(`Added ${kind === 'quality' ? 'a quality-check' : 'a query'} cell to the visible development notebook. ${JSON.stringify(result.data)}`);
      }

      // ----------------------------------------------------------------
      case 'open_table_publishing': {
        navigate('/develop');
        const result = await requestDevelopmentAction({ type: 'set-view', bottomTab: 'publishing' });
        return text(result.ok
          ? 'Opened Table Publishing in the development workspace. Select the query cell, add metadata and schedule, then let the user click Publish table.'
          : `Could not open Table Publishing: ${result.message}`);
      }

      // ----------------------------------------------------------------
      case 'inspect_development_workspace': {
        navigate('/develop');
        const result = await requestDevelopmentAction({ type: 'inspect' });
        return text(result.ok ? JSON.stringify(result.data, null, 2) : `Could not inspect the development workspace: ${result.message}`);
      }

      // ----------------------------------------------------------------
      case 'create_development_notebook': {
        navigate('/develop');
        const result = await requestDevelopmentAction({ type: 'create-notebook', name: args['name'] as string | undefined });
        return text(result.ok ? `${result.message}\n${JSON.stringify(result.data)}` : result.message);
      }

      // ----------------------------------------------------------------
      case 'select_development_notebook': {
        navigate('/develop');
        const result = await requestDevelopmentAction({ type: 'select-notebook', notebookId: args['notebookId'] as string });
        return text(result.message);
      }

      // ----------------------------------------------------------------
      case 'close_development_notebook': {
        navigate('/develop');
        const result = await requestDevelopmentAction({ type: 'close-notebook', notebookId: args['notebookId'] as string });
        return text(result.message);
      }

      // ----------------------------------------------------------------
      case 'update_development_sql_cell': {
        navigate('/develop');
        const result = await requestDevelopmentAction({
          type: 'update-cell', cellId: args['cellId'] as string, sql: args['sql'] as string | undefined,
          kind: args['kind'] as 'query' | 'quality' | undefined, name: args['name'] as string | undefined,
          description: args['description'] as string | undefined, severity: args['severity'] as 'Info' | 'Warning' | 'Error' | 'Critical' | undefined,
        });
        return text(result.message);
      }

      // ----------------------------------------------------------------
      case 'delete_development_sql_cell': {
        navigate('/develop');
        const result = await requestDevelopmentAction({ type: 'delete-cell', cellId: args['cellId'] as string });
        return text(result.message);
      }

      // ----------------------------------------------------------------
      case 'run_development_sql_cell': {
        navigate('/develop');
        const result = await requestDevelopmentAction({ type: 'run-cell', cellId: args['cellId'] as string });
        return text(result.ok ? `${result.message}\n${JSON.stringify(result.data, null, 2)}` : result.message);
      }

      // ----------------------------------------------------------------
      case 'prepare_table_publication': {
        navigate('/develop');
        const result = await requestDevelopmentAction({
          type: 'prepare-publication', sourceCellId: args['sourceCellId'] as string | undefined,
          name: args['name'] as string | undefined, displayName: args['displayName'] as string | undefined,
          description: args['description'] as string | undefined, owner: args['owner'] as string | undefined,
          tags: args['tags'] as string | undefined, criticality: args['criticality'] as 'Critical' | 'High' | 'Medium' | 'Low' | undefined,
          frequency: args['frequency'] as string | undefined, cron: args['cron'] as string | undefined,
          transformations: args['transformations'] as string | undefined, qualityCellIds: args['qualityCellIds'] as string[] | undefined,
          fieldDescriptions: args['fieldDescriptions'] as Record<string, string> | undefined,
        });
        return text(result.message);
      }

      // ----------------------------------------------------------------
      case 'reset_development_workspace': {
        navigate('/develop');
        const result = await requestDevelopmentAction({ type: 'reset-workspace' });
        return text(result.message);
      }

      // ----------------------------------------------------------------
      case 'view_home_dashboard': {
        const tab = (args['tab'] as string | undefined) ?? 'all';
        navigate(`/?tab=${tab}`);
        return text(`Navigated to Home Dashboard with tab=${tab}. Dashboard context: ${JSON.stringify({
          datasets: datasets.length,
          dataSources: dataSources.length,
          pipelines: pipelines.length,
          connectedSources: dataSources.filter((source) => source.connectionStatus === 'Connected').length,
          recentQualityChecks: [...qualityChecks].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 8).map((check) => ({ id: check.id, datasetId: check.datasetId, result: check.result, severity: check.severity, message: check.message })),
        })}`);
      }

      // ----------------------------------------------------------------
      case 'search_global_catalog': {
        const query = args['query'] as string;
        const tab = (args['type'] as string | undefined) ?? 'all';
        navigate(`/search?q=${encodeURIComponent(query)}&tab=${tab}`);

        const q = query.toLowerCase();
        const matchingDatasets = datasets
          .filter(
            (d) =>
              d.displayName.toLowerCase().includes(q) ||
              d.name.toLowerCase().includes(q),
          )
          .map((d) => ({ id: d.id, name: d.displayName, type: 'dataset' }));
        const matchingPipelines = pipelines
          .filter(
            (p) =>
              p.displayName.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q),
          )
          .map((p) => ({ id: p.id, name: p.displayName, type: 'pipeline' }));
        const matchingSources = dataSources
          .filter((source) => [source.name, source.system, source.owner].some((value) => value.toLowerCase().includes(q)))
          .map((source) => ({ id: source.id, name: source.name, type: 'source' }));

        const isEmpty = matchingDatasets.length === 0 && matchingPipelines.length === 0 && matchingSources.length === 0;
        let msg =
          `Searching for "${query}" with tab=${tab}.\n\n` +
          `Results:\nDatasets: ${JSON.stringify(matchingDatasets)}\n` +
          `Sources: ${JSON.stringify(matchingSources)}\n` +
          `Pipelines: ${JSON.stringify(matchingPipelines)}`;
        if (isEmpty) {
          msg +=
            '\n\nNo records found. Try a shorter name, a source system, or a related pipeline term.';
        }
        return text(msg);
      }

      // ----------------------------------------------------------------
      case 'filter_datasets': {
        const a = args as {
          query?: string;
          types?: string[];
          tags?: string[];
          sortKey?: string;
          page?: number;
        };
        const params = new URLSearchParams();
        let filtered = datasets;

        if (a.query) {
          params.set('q', a.query);
          const q = a.query.toLowerCase();
          filtered = filtered.filter(
            (d) =>
              d.displayName.toLowerCase().includes(q) ||
              d.name.toLowerCase().includes(q),
          );
        }
        if (a.types && a.types.length > 0) {
          a.types.forEach((t) => params.append('type', t));
          filtered = filtered.filter((d) => a.types!.includes(d.type));
        }
        if (a.tags?.length) {
          a.tags.forEach((t) => params.append('tag', t));
          filtered = filtered.filter((dataset) => a.tags!.some((tag) => dataset.tags.includes(tag)));
        }
        if (a.sortKey) params.set('sort', a.sortKey);
        if (a.page) params.set('page', String(a.page));
        navigate(`/datasets?${params.toString()}`);

        const summary = filtered.map((d) => ({
          id: d.id,
          name: d.displayName,
          type: d.type,
          owner: d.owner,
        }));
        let msg =
          `Navigated to datasets with filters.\n` +
          `Found ${summary.length} datasets. Results (up to 5): ${JSON.stringify(summary.slice(0, 5))}`;
        if (summary.length === 0) {
          msg +=
            '\n\nNo records found. Try a different dataset type or use search_global_catalog to include sources and pipelines.';
        }
        return text(msg);
      }

      // ----------------------------------------------------------------
      case 'view_dataset_details': {
        const { id, tab, dateRange } = args as {
          id: string;
          tab: string;
          dateRange?: string;
        };
        const d = datasets.find((x) => x.id === id);
        if (!d) return text(`Dataset ${id} not found.`);

        const params = new URLSearchParams({ tab });
        if (tab === 'costs') params.set('dateRange', dateRange ?? '90');
        navigate(`/datasets/${id}?${params.toString()}`);

        let info = '';
        if (tab === 'overview') {
          info = JSON.stringify(
            {
              metadata: {
                database: d.schema.database,
                schema: d.schema.schema,
                name: d.name,
                description: d.description,
                type: d.type,
                owner: d.owner,
                criticality: d.criticality,
                freshness: d.freshness,
                source: d.source,
                tags: d.tags,
              },
              metrics: { columnsCount: d.columns, rowsCount: d.rows, sizeBytes: d.sizeBytes },
              schema: d.fields,
            },
            null,
            2,
          );
        } else if (tab === 'data') {
          info = JSON.stringify(d.sampleData, null, 2);
        } else if (tab === 'quality') {
          info = JSON.stringify(d.qualityDashboard, null, 2);
        } else if (tab === 'costs') {
          const days = parseInt(dateRange ?? '90', 10);
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          const datasetCosts = costs
            .filter(
              (c) =>
                c.entityId === d.id &&
                c.entityType === 'Dataset' &&
                new Date(c.date).getTime() >= cutoff,
            )
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          const summary = {
            storageSummary: datasetCosts
              .filter((c) => c.category === 'Storage')
              .reduce((acc, c) => acc + c.amount, 0),
            computeSummary: datasetCosts
              .filter((c) => c.category === 'Compute')
              .reduce((acc, c) => acc + c.amount, 0),
            totalCost: datasetCosts.reduce((acc, c) => acc + c.amount, 0),
          };
          info = JSON.stringify(
            {
              dateRangeDays: days,
              summary,
              history: datasetCosts.map((c) => ({
                date: c.date,
                category: c.category,
                subcategory: c.subcategory,
                amount: c.amount,
                description: c.description,
              })),
            },
            null,
            2,
          );
        } else if (tab === 'pipelines') {
          const related = pipelineRuns
            .filter((r) => r.inputDatasets.includes(d.id) || r.outputDatasets.includes(d.id))
            .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
          info = JSON.stringify(
            related.map((r) => ({
              runId: r.id,
              pipelineId: r.pipelineId,
              pipelineName: r.pipelineName,
              status: r.status,
              startTime: r.startTime,
              duration: r.duration,
            })),
            null,
            2,
          );
        } else if (tab === 'lineage') {
          const nodes = lineage.filter((node) => node.datasetIds.includes(d.id)).map((node) => ({
            id: node.id, name: node.name, type: node.type, location: node.location, parentId: node.parentId ?? null,
            datasets: node.datasetIds.map((datasetId) => ({ id: datasetId, name: datasets.find((dataset) => dataset.id === datasetId)?.displayName ?? datasetId })),
          }));
          const nodeIds = new Set(nodes.map((node) => node.id));
          info = JSON.stringify({ nodes, edges: nodes.filter((node) => node.parentId && nodeIds.has(node.parentId)).map((node) => ({ source: node.parentId, target: node.id })) }, null, 2);
        }

        let msg = `Navigated to Dataset ${id} tab=${tab}.\nPage Content Context:\n${info}`;
        if (!info || info === '[]') msg += '\n\nNo records found in this tab.';
        return text(msg);
      }

      // ----------------------------------------------------------------
      case 'filter_pipelines': {
        const a = args as {
          query?: string;
          types?: string[];
          statuses?: string[];
          engines?: string[];
          scheduleFilter?: string[];
          sortKey?: string;
          page?: number;
        };
        const params = new URLSearchParams();
        let filtered = pipelines;

        if (a.query) {
          params.set('q', a.query);
          const q = a.query.toLowerCase();
          filtered = filtered.filter(
            (p) =>
              p.displayName.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q),
          );
        }
        if (a.types && a.types.length > 0) {
          a.types.forEach((t) => params.append('type', t));
          filtered = filtered.filter((p) => a.types!.includes(p.type));
        }
        if (a.statuses && a.statuses.length > 0) {
          a.statuses.forEach((s) => params.append('status', s));
          filtered = filtered.filter((p) => a.statuses!.includes(p.lastRunStatus));
        }
        if (a.engines && a.engines.length > 0) {
          a.engines.forEach((e) => params.append('engine', e));
          filtered = filtered.filter((p) => a.engines!.includes(p.engine));
        }
        if (a.scheduleFilter) a.scheduleFilter.forEach((s) => params.append('schedule', s));
        if (a.sortKey) params.set('sort', a.sortKey);
        if (a.page) params.set('page', String(a.page));
        navigate(`/pipelines?${params.toString()}`);

        const summary = filtered.map((p) => ({
          id: p.id,
          name: p.displayName,
          type: p.type,
          status: p.lastRunStatus,
          engine: p.engine,
        }));
        let msg =
          `Navigated to Pipelines list with filtered view.\n` +
          `Found ${summary.length} pipelines. Results (up to 5): ${JSON.stringify(summary.slice(0, 5))}`;
        if (summary.length === 0) {
          msg +=
            '\n\nNo records found. Try a different status, type, engine, or a related dataset search.';
        }
        return text(msg);
      }

      // ----------------------------------------------------------------
      case 'view_pipeline_details': {
        const { id, tab, dateRange } = args as {
          id: string;
          tab: string;
          dateRange?: string;
        };
        const p = pipelines.find((x) => x.id === id);
        if (!p) return text(`Pipeline ${id} not found.`);

        const params = new URLSearchParams({ tab });
        if (tab === 'costs') params.set('dateRange', dateRange ?? '90');
        navigate(`/pipelines/${id}?${params.toString()}`);

        let info = '';
        if (tab === 'overview') {
          info = JSON.stringify(
            {
              name: p.name,
              displayName: p.displayName,
              description: p.description,
              type: p.type,
              owner: p.owner,
              schedule: p.schedule,
              clusterDetails: { engine: p.engine, cluster: p.cluster },
              relationships: { inputs: p.inputDatasets, outputs: p.outputDatasets },
              performance: {
                lastRunStatus: p.lastRunStatus,
                avgDuration: p.avgDuration,
                totalRuns: p.totalRuns,
              },
              tags: p.tags,
            },
            null,
            2,
          );
        } else if (tab === 'runs') {
          const runs = pipelineRuns
            .filter((r) => r.pipelineId === id)
            .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
          info = JSON.stringify(
            runs.map((r) => ({
              id: r.id,
              runNumber: r.runNumber,
              status: r.status,
              startTime: r.startTime,
              duration: r.duration,
              recordsProcessed: r.recordsProcessed,
              recordsFailed: r.recordsFailed,
            })),
            null,
            2,
          );
        } else if (tab === 'lineage') {
          info = JSON.stringify(
            {
              inputDatasets: datasets.filter((dataset) => p.inputDatasets.includes(dataset.id)).map((dataset) => ({ id: dataset.id, name: dataset.displayName, type: dataset.type })),
              outputDatasets: datasets.filter((dataset) => p.outputDatasets.includes(dataset.id)).map((dataset) => ({ id: dataset.id, name: dataset.displayName, type: dataset.type })),
            },
            null,
            2,
          );
        } else if (tab === 'costs') {
          const days = parseInt(dateRange ?? '90', 10);
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          const pipelineCosts = costs
            .filter(
              (c) =>
                c.entityId === p.id &&
                c.entityType === 'Pipeline' &&
                new Date(c.date).getTime() >= cutoff,
            )
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          const summary = {
            storageSummary: pipelineCosts
              .filter((c) => c.category === 'Storage')
              .reduce((acc, c) => acc + c.amount, 0),
            computeSummary: pipelineCosts
              .filter((c) => c.category === 'Compute')
              .reduce((acc, c) => acc + c.amount, 0),
            totalCost: pipelineCosts.reduce((acc, c) => acc + c.amount, 0),
          };
          const outputDs = datasets
            .filter((d) => p.outputDatasets.includes(d.id))
            .map((d) => ({ id: d.id, name: d.displayName, type: d.type }));
          info = JSON.stringify(
            {
              dateRangeDays: days,
              summary,
              producedDatasets: outputDs,
              history: pipelineCosts.map((c) => ({
                date: c.date,
                category: c.category,
                subcategory: c.subcategory,
                amount: c.amount,
                description: c.description,
              })),
            },
            null,
            2,
          );
        }

        return text(`Navigated to Pipeline ${id} tab=${tab}.\nPage Content Context:\n${info}`);
      }

      // ----------------------------------------------------------------
      case 'view_pipeline_run_logs': {
        const { pipelineId, runId } = args as { pipelineId: string; runId: string };
        navigate(`/pipelines/${pipelineId}?tab=runs&run=${runId}`);
        const runs = pipelineRuns.filter(
          (r) => r.pipelineId === pipelineId && r.id === runId,
        );
        return text(
          `Navigated to logs for run ${runId}.\n` +
            `Logs context:\n${JSON.stringify(
              runs.map((r) => r.logs),
              null,
              2,
            )}`,
        );
      }

      // ----------------------------------------------------------------
      case 'trigger_pipeline_execution': {
        const { pipelineId, environment } = args as {
          pipelineId: string;
          environment: string;
        };
        const pipeline = pipelines.find((p) => p.id === pipelineId);
        if (!pipeline) return text(`Pipeline ${pipelineId} not found.`);

        const runId = startMockPipelineRun(pipelineId, environment);
        navigate(`/pipelines/${pipelineId}?tab=runs`);
        return text(webmcpResponse('pipeline_run_started', {
          pipeline: { id: pipeline.id, name: pipeline.displayName }, runId, environment, status: 'Running',
        }, {
          navigation: { route: `/pipelines/${pipelineId}`, selectedId: runId, tab: 'runs' },
          notices: ['This is a browser-local mocked pipeline execution. It transitions to Success automatically after about 8 seconds.'],
          nextActions: ['inspect_pipeline_run', 'list_pipeline_runs'],
        }));
      }

      // ----------------------------------------------------------------
      case 'analyze_infrastructure_costs': {
        const a = args as {
          dateRange?: string;
          category?: string;
          entityType?: string;
          search?: string;
        };
        const params = new URLSearchParams();
        let filtered = costs;

        if (a.dateRange) {
          params.set('range', a.dateRange);
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - parseInt(a.dateRange, 10));
          filtered = filtered.filter((c) => new Date(c.date) >= cutoffDate);
        }
        if (a.category) {
          params.set('category', a.category);
          filtered = filtered.filter(
            (c) => c.category.toLowerCase() === a.category!.toLowerCase(),
          );
        }
        if (a.entityType) {
          params.set('entityType', a.entityType);
          filtered = filtered.filter(
            (c) => c.entityType.toLowerCase() === a.entityType!.toLowerCase(),
          );
        }
        if (a.search) {
          params.set('q', a.search);
          const q = a.search.toLowerCase();
          filtered = filtered.filter(
            (c) =>
              c.description.toLowerCase().includes(q) ||
              c.subcategory.toLowerCase().includes(q) ||
              c.category.toLowerCase().includes(q),
          );
        }
        navigate(`/costs?${params.toString()}`);

        const aggregated = filtered.reduce<Record<string, number>>((acc, curr) => {
          acc[curr.subcategory] = (acc[curr.subcategory] ?? 0) + curr.amount;
          return acc;
        }, {});
        const totalCost = filtered.reduce((sum, c) => sum + c.amount, 0);
        const summary = {
          totalCost: totalCost.toFixed(2),
          currency: 'USD',
          breakdownBySubcategory: Object.entries(aggregated)
            .map(([subcategory, amount]) => ({ subcategory, amount: amount.toFixed(2) }))
            .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)),
        };

        let msg =
          `Filtered costs with params: ${params.toString()}.\n\n` +
          `Cost Data Context:\n${JSON.stringify(summary, null, 2)}`;
        if (filtered.length === 0) {
          msg +=
            '\n\nNo records found. Try different filters. ' +
            'Valid categories: Storage, Compute, Query, Transfer, Licensing, Infrastructure.';
        }
        return text(msg);
      }

      // ----------------------------------------------------------------
      default:
        return text(`Unknown tool: ${name}`);
    }
  };

  return { executeTool };
}
