import { useEffect, useRef } from 'react';
import { useCatalogTools } from './useCatalogTools';

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
  execute: (args: Record<string, unknown>) => ReturnType<ReturnType<typeof useCatalogTools>['executeTool']>;
};

type ModelContext = {
  registerTool: (
    tool: Omit<ToolDefinition, 'execute'> & {
      annotations?: { readOnlyHint?: boolean };
      execute: (args: Record<string, unknown>) => Promise<string>;
    },
    options: { signal: AbortSignal },
  ) => Promise<void>;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

// Registers data-portal tools using the current WebMCP imperative API.
export function WebMCPIntegration() {
  const { executeTool } = useCatalogTools();
  const executeToolRef = useRef(executeTool);

  useEffect(() => {
    executeToolRef.current = executeTool;
  });

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext) {
      console.warn('WebMCP not available (document.modelContext is undefined).');
      return;
    }

    const registration = new AbortController();
    const tools: ToolDefinition[] = [
        {
          name: 'get_portal_snapshot',
          description: 'Get a versioned, screen-independent map of the Happy Coffee portal: routes, generated-data counts, safeguards, and recommended next actions. Call this first to understand the portal without scraping the UI.',
          inputSchema: { type: 'object', properties: {} },
          execute: (args: Record<string, unknown>) => executeToolRef.current('get_portal_snapshot', args),
        },
        {
          name: 'list_data_sources',
          description: 'List generated portal data sources with connection health and linked dataset IDs. Returns a versioned JSON contract; no visual inspection is required.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' }, statuses: { type: 'array', items: { type: 'string', enum: ['Connected', 'Degraded', 'Disconnected'] } } } },
          execute: (args: Record<string, unknown>) => executeToolRef.current('list_data_sources', args),
        },
        {
          name: 'inspect_data_source',
          description: 'Inspect one data source, its health metadata, and datasets linked to its system.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          execute: (args: Record<string, unknown>) => executeToolRef.current('inspect_data_source', args),
        },
        {
          name: 'list_quality_checks',
          description: 'List generated quality-check executions by dataset, text, severity, result, or check type. Returns a versioned JSON contract.',
          inputSchema: { type: 'object', properties: { datasetId: { type: 'string' }, query: { type: 'string' }, severities: { type: 'array', items: { type: 'string', enum: ['Info', 'Warning', 'Error', 'Critical'] } }, results: { type: 'array', items: { type: 'string', enum: ['Passed', 'Warning', 'Failed'] } }, checkTypes: { type: 'array', items: { type: 'string', enum: ['Freshness', 'Schema', 'Volume', 'Accuracy', 'Completeness'] } }, limit: { type: 'number' } } },
          execute: (args: Record<string, unknown>) => executeToolRef.current('list_quality_checks', args),
        },
        {
          name: 'inspect_quality_check',
          description: 'Inspect one quality-check execution, including its rule, message, metadata, and related dataset.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          execute: (args: Record<string, unknown>) => executeToolRef.current('inspect_quality_check', args),
        },
        {
          name: 'get_dataset_lineage',
          description: 'Return named lineage nodes and edges for a dataset without relying on the visual lineage graph.',
          inputSchema: { type: 'object', properties: { datasetId: { type: 'string' } }, required: ['datasetId'] },
          execute: (args: Record<string, unknown>) => executeToolRef.current('get_dataset_lineage', args),
        },
        {
          name: 'preview_dataset_data',
          description: 'Return a bounded, column-selectable preview of generated dataset sample data.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' }, columns: { type: 'array', items: { type: 'string' } } }, required: ['id'] },
          execute: (args: Record<string, unknown>) => executeToolRef.current('preview_dataset_data', args),
        },
        {
          name: 'open_development_workspace',
          description:
            'Open the Happy Coffee DuckDB development workspace and list the generated catalog tables available for SQL development. ' +
            'Use this first when a user wants to explore, analyze, or build data in the portal.',
          inputSchema: { type: 'object', properties: {} },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('open_development_workspace', args),
        },
        {
          name: 'run_duckdb_sql',
          readOnlyHint: false,
          description:
            'Run SQL with DuckDB in the user\'s browser-local Happy Coffee development workspace. ' +
            'Use happy_coffee.<table_name> for generated catalog data and workspace.<table_name> for temporary tables. ' +
            'Results appear in the workspace UI. DDL and DML are local to the browser and expire after 90 minutes.',
          inputSchema: {
            type: 'object',
            properties: { sql: { type: 'string', description: 'A complete DuckDB SQL statement.' } },
            required: ['sql'],
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('run_duckdb_sql', args),
        },
        {
          name: 'create_workspace_table',
          readOnlyHint: false,
          description:
            'Create or replace a named temporary table in the browser-local workspace schema from a SELECT or WITH query. ' +
            'Use this to develop derived data the user can inspect in the Happy Coffee workspace. Temporary tables expire after 90 minutes.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Simple table name using letters, numbers, and underscores.' },
              selectSql: { type: 'string', description: 'SELECT or WITH query defining the table.' },
            },
            required: ['name', 'selectSql'],
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('create_workspace_table', args),
        },
        {
          name: 'create_development_sql_cell',
          readOnlyHint: false,
          description:
            'Add a visible SQL cell to the Happy Coffee development notebook. Use kind="quality" for a quality-check query; ' +
            'quality checks should return the rows that violate a rule, and can use {{published_table}} when they will test a published table.',
          inputSchema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'The SQL statement to place in the notebook cell.' },
              notebookId: { type: 'string', description: 'Optional notebook ID from inspect_development_workspace. Defaults to the active notebook.' },
              kind: { type: 'string', enum: ['query', 'quality'], description: 'Whether this is a query or a quality-check cell.' },
              name: { type: 'string', description: 'Required for quality checks; a clear check name.' },
              description: { type: 'string', description: 'Optional explanation of what the quality check validates.' },
              severity: { type: 'string', enum: ['Info', 'Warning', 'Error', 'Critical'] },
            },
            required: ['sql'],
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('create_development_sql_cell', args),
        },
        {
          name: 'open_table_publishing',
          readOnlyHint: false,
          description:
            'Open the Table Publishing tab in the Happy Coffee development workspace. ' +
            'Use it after creating a query cell and any optional quality-check cells so the user can review metadata, schedule, and publish the mock data product.',
          inputSchema: { type: 'object', properties: {} },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('open_table_publishing', args),
        },
        {
          name: 'inspect_development_workspace',
          description: 'Inspect the live Develop workspace. Returns notebook IDs, cell IDs, SQL, quality-check configuration, results, tables, and the current publication draft. Call this before editing or preparing a publication.',
          inputSchema: { type: 'object', properties: {} },
          execute: (args: Record<string, unknown>) => executeToolRef.current('inspect_development_workspace', args),
        },
        {
          name: 'create_development_notebook',
          readOnlyHint: false,
          description: 'Create and select a new notebook in the live Develop workspace.',
          inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'A short notebook name.' } } },
          execute: (args: Record<string, unknown>) => executeToolRef.current('create_development_notebook', args),
        },
        {
          name: 'select_development_notebook',
          readOnlyHint: false,
          description: 'Select a development notebook by ID from inspect_development_workspace.',
          inputSchema: { type: 'object', properties: { notebookId: { type: 'string' } }, required: ['notebookId'] },
          execute: (args: Record<string, unknown>) => executeToolRef.current('select_development_notebook', args),
        },
        {
          name: 'close_development_notebook',
          readOnlyHint: false,
          description: 'Close a development notebook by ID. The only remaining notebook cannot be closed.',
          inputSchema: { type: 'object', properties: { notebookId: { type: 'string' } }, required: ['notebookId'] },
          execute: (args: Record<string, unknown>) => executeToolRef.current('close_development_notebook', args),
        },
        {
          name: 'update_development_sql_cell',
          readOnlyHint: false,
          description: 'Update a notebook cell SQL statement, convert it between query and quality-check modes, or configure its quality-check metadata. Use cell IDs from inspect_development_workspace.',
          inputSchema: { type: 'object', properties: { cellId: { type: 'string' }, sql: { type: 'string' }, kind: { type: 'string', enum: ['query', 'quality'] }, name: { type: 'string' }, description: { type: 'string' }, severity: { type: 'string', enum: ['Info', 'Warning', 'Error', 'Critical'] } }, required: ['cellId'] },
          execute: (args: Record<string, unknown>) => executeToolRef.current('update_development_sql_cell', args),
        },
        {
          name: 'delete_development_sql_cell',
          readOnlyHint: false,
          description: 'Delete a notebook cell by ID. Use this to remove superseded development or quality-check logic.',
          inputSchema: { type: 'object', properties: { cellId: { type: 'string' } }, required: ['cellId'] },
          execute: (args: Record<string, unknown>) => executeToolRef.current('delete_development_sql_cell', args),
        },
        {
          name: 'run_development_sql_cell',
          readOnlyHint: false,
          description: 'Run an existing notebook cell by ID. The result and any quality-check execution card are updated visibly in the Develop workspace.',
          inputSchema: { type: 'object', properties: { cellId: { type: 'string' } }, required: ['cellId'] },
          execute: (args: Record<string, unknown>) => executeToolRef.current('run_development_sql_cell', args),
        },
        {
          name: 'prepare_table_publication',
          readOnlyHint: false,
          description: 'Fill and open Table Publishing from existing query and quality-check cells. This tool intentionally cannot publish: the user must review the visible form and click Publish table themselves.',
          inputSchema: { type: 'object', properties: { sourceCellId: { type: 'string' }, name: { type: 'string' }, displayName: { type: 'string' }, description: { type: 'string' }, owner: { type: 'string' }, tags: { type: 'string' }, criticality: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] }, frequency: { type: 'string', enum: ['Manual', 'Hourly', 'Daily', 'Weekly', 'Custom'] }, cron: { type: 'string' }, transformations: { type: 'string' }, qualityCellIds: { type: 'array', items: { type: 'string' } }, fieldDescriptions: { type: 'object', additionalProperties: { type: 'string' } } } },
          execute: (args: Record<string, unknown>) => executeToolRef.current('prepare_table_publication', args),
        },
        {
          name: 'reset_development_workspace',
          readOnlyHint: false,
          description: 'Reset the browser-local DuckDB workspace, clearing temporary tables and every ephemeral published data-product bundle.',
          inputSchema: { type: 'object', properties: {} },
          execute: (args: Record<string, unknown>) => executeToolRef.current('reset_development_workspace', args),
        },
        {
          name: 'inspect_development_tables',
          description:
            'List the generated Happy Coffee catalog tables and temporary workspace tables available in the DuckDB development workspace.',
          inputSchema: { type: 'object', properties: {} },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('inspect_development_tables', args),
        },
        {
          name: 'view_home_dashboard',
          description:
            'Navigate to the home dashboard and view top assets. Optionally filter by asset type.',
          inputSchema: {
            type: 'object',
            properties: {
              tab: {
                type: 'string',
                enum: ['all', 'datasets', 'sources', 'pipelines'],
                description: 'The category to view on the dashboard.',
              },
            },
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('view_home_dashboard', args),
        },
        {
          name: 'search_global_catalog',
          description:
            'Search across all datasets, pipelines, and sources in the Happy Coffee Data Developer Portal. ' +
            'IMPORTANT: Extract only the core entity name. Do NOT include words like "dataset", "pipeline", or "table".',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  'Core search term. Use partial strings if exact searches fail. ' +
                  'Example: "Farm Origins" not "Farm Origins dataset".',
              },
              type: {
                type: 'string',
                enum: ['all', 'datasets', 'sources', 'pipelines'],
                description: 'Filter by asset type.',
              },
            },
            required: ['query'],
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('search_global_catalog', args),
        },
        {
          name: 'filter_datasets',
          description: 'Filter the datasets list by types, tags, or search string.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search term for dataset name. Strip extraneous words; use partial chunks.',
              },
              types: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['Table', 'View', 'Materialized View', 'External Table'],
                },
              },
              tags: { type: 'array', items: { type: 'string' } },
              sortKey: { type: 'string', enum: ['quality', 'updated', 'name', 'size'] },
              page: { type: 'number' },
            },
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('filter_datasets', args),
        },
        {
          name: 'view_dataset_details',
          description:
            'View details of a dataset by tab (overview, data, quality, lineage, pipelines, costs). ' +
            'Use "pipelines" to see executions; "costs" to see cost trends.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Dataset ID (e.g. ds-1).' },
              tab: {
                type: 'string',
                enum: ['overview', 'data', 'quality', 'lineage', 'pipelines', 'costs'],
              },
              dateRange: {
                type: 'string',
                enum: ['7', '30', '90'],
                description: 'For the costs tab: days of history.',
              },
            },
            required: ['id', 'tab'],
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('view_dataset_details', args),
        },
        {
          name: 'filter_pipelines',
          description: 'Filter the pipelines list by statuses, engines, or search.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search term for pipeline name. Use partial chunks if exact match fails.',
              },
              types: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['Ingestion', 'Transformation', 'Quality Check', 'Export', 'Aggregation'],
                },
              },
              statuses: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['Success', 'Failed', 'Running', 'Cancelled', 'Never'],
                },
              },
              engines: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: [
                    'Fivetran',
                    'Kafka Connect',
                    'Airflow',
                    'dbt',
                    'Spark',
                    'Great Expectations',
                  ],
                },
              },
              scheduleFilter: { type: 'array', items: { type: 'string' } },
              sortKey: { type: 'string', enum: ['name', 'lastRun', 'runs', 'duration'] },
              page: { type: 'number' },
            },
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('filter_pipelines', args),
        },
        {
          name: 'view_pipeline_details',
          description:
            'View details of a pipeline by tab (overview, runs, lineage, costs). ' +
            'Get the runId from "runs", then call view_pipeline_run_logs for logs.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              tab: { type: 'string', enum: ['overview', 'runs', 'lineage', 'costs'] },
              dateRange: {
                type: 'string',
                enum: ['7', '30', '90'],
                description: 'For the costs tab: days of history.',
              },
            },
            required: ['id', 'tab'],
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('view_pipeline_details', args),
        },
        {
          name: 'view_pipeline_run_logs',
          description:
            'View granular logs of a specific pipeline run. ' +
            'Get runId first from view_pipeline_details (tab=runs) before calling this.',
          inputSchema: {
            type: 'object',
            properties: {
              pipelineId: { type: 'string' },
              runId: { type: 'string' },
            },
            required: ['pipelineId', 'runId'],
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('view_pipeline_run_logs', args),
        },
        {
          name: 'trigger_pipeline_execution',
          readOnlyHint: false,
          description:
            'Trigger a new pipeline run on staging or production. ' +
            'Returns the runId. Wait ~10 seconds then call view_pipeline_details (tab=runs) to confirm status.',
          inputSchema: {
            type: 'object',
            properties: {
              pipelineId: { type: 'string' },
              environment: { type: 'string', enum: ['production', 'staging'] },
            },
            required: ['pipelineId', 'environment'],
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('trigger_pipeline_execution', args),
        },
        {
          name: 'analyze_infrastructure_costs',
          description:
            'View and analyze data platform infrastructure costs with date/category filters. ' +
            'Call autonomously to fetch and summarize costs without asking the user for permission.',
          inputSchema: {
            type: 'object',
            properties: {
              dateRange: { type: 'string', enum: ['7', '15', '30', '60', '90'] },
              category: {
                type: 'string',
                enum: [
                  'Storage',
                  'Compute',
                  'Query',
                  'Transfer',
                  'Licensing',
                  'Infrastructure',
                ],
              },
              entityType: { type: 'string' },
              search: {
                type: 'string',
                description: 'Search term for specific infrastructure components.',
              },
            },
          },
          execute: (args: Record<string, unknown>) =>
            executeToolRef.current('analyze_infrastructure_costs', args),
        },
    ];

    void Promise.all(
      tools.map(({ readOnlyHint = true, ...tool }) =>
        modelContext.registerTool(
          {
            ...tool,
            annotations: { readOnlyHint },
            execute: async (args) => {
              const result = await tool.execute(args);
              return result.content.map((item) => item.text).join('\n');
            },
          },
          { signal: registration.signal },
        ),
      ),
    ).catch((error: unknown) => {
      if (!registration.signal.aborted) {
        console.warn('Unable to register WebMCP tools.', error);
      }
    });

    return () => registration.abort();
  }, []);

  return null;
}
