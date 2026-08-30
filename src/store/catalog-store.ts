import { create } from 'zustand';
import type { CatalogData, EphemeralPublicationBundle, PipelineRun, Pipeline } from '../data/types';
import { generateCatalogData } from '../data/generators';
import { generateRunLogs } from '../data/generators/pipeline-runs';

interface CatalogStore extends CatalogData {
  initialized: boolean;
  initialize: () => void;
  regenerate: () => void;
  addPipelineRun: (run: PipelineRun) => void;
  updatePipelineRun: (runId: string, patch: Partial<PipelineRun>) => void;
  updatePipeline: (pipelineId: string, patch: Partial<Pipeline>) => void;
  publishEphemeralBundle: (bundle: EphemeralPublicationBundle) => void;
  removeEphemeralBundle: (bundleId: string) => void;
  clearEphemeralBundles: () => void;
  startMockPipelineRun: (pipelineId: string, environment: string) => string;
}

export const useCatalogStore = create<CatalogStore>((set, get) => ({
  datasets: [],
  dataSources: [],
  lineage: [],
  pipelines: [],
  pipelineRuns: [],
  qualityChecks: [],
  costs: [],
  initialized: false,

  initialize: () => {
    const data = generateCatalogData();
    set({ ...data, initialized: true });
  },

  regenerate: () => {
    const data = generateCatalogData();
    set(data);
  },

  addPipelineRun: (run) =>
    set((state) => ({
      pipelineRuns: [run, ...state.pipelineRuns],
    })),

  updatePipelineRun: (runId, patch) =>
    set((state) => ({
      pipelineRuns: state.pipelineRuns.map((r) =>
        r.id === runId ? { ...r, ...patch } : r,
      ),
    })),

  updatePipeline: (pipelineId, patch) =>
    set((state) => ({
      pipelines: state.pipelines.map((p) =>
        p.id === pipelineId ? { ...p, ...patch } : p,
      ),
    })),

  publishEphemeralBundle: (bundle) => {
    set((state) => ({
      datasets: [bundle.dataset, ...state.datasets],
      pipelines: [bundle.pipeline, ...state.pipelines],
      pipelineRuns: [...bundle.pipelineRuns, ...state.pipelineRuns],
      qualityChecks: [...bundle.qualityChecks, ...state.qualityChecks],
      lineage: [...bundle.lineage, ...state.lineage],
      costs: [...bundle.costs, ...state.costs],
    }));

    const expiryDelay = Math.max(0, bundle.expiresAt.getTime() - Date.now());
    if (typeof window !== 'undefined') {
      window.setTimeout(() => get().removeEphemeralBundle(bundle.id), expiryDelay);
    }
  },

  removeEphemeralBundle: (bundleId) => {
    const marker = `ephemeral-bundle:${bundleId}`;
    set((state) => {
      const datasetIds = state.datasets.filter((dataset) => dataset.tags.includes(marker)).map((dataset) => dataset.id);
      const pipelineIds = state.pipelines.filter((pipeline) => pipeline.tags.includes(marker)).map((pipeline) => pipeline.id);
      return {
        datasets: state.datasets.filter((dataset) => !datasetIds.includes(dataset.id)),
        pipelines: state.pipelines.filter((pipeline) => !pipelineIds.includes(pipeline.id)),
        pipelineRuns: state.pipelineRuns.filter((run) => !pipelineIds.includes(run.pipelineId)),
        qualityChecks: state.qualityChecks.filter((check) => !datasetIds.includes(check.datasetId)),
        lineage: state.lineage.filter((node) => !node.datasetIds.some((id) => datasetIds.includes(id))),
        costs: state.costs.filter((cost) => !datasetIds.includes(cost.entityId) && !pipelineIds.includes(cost.entityId)),
      };
    });
  },

  clearEphemeralBundles: () => {
    const bundleIds = get().datasets
      .flatMap((dataset) => dataset.tags)
      .filter((tag) => tag.startsWith('ephemeral-bundle:'))
      .map((tag) => tag.replace('ephemeral-bundle:', ''));
    [...new Set(bundleIds)].forEach((bundleId) => get().removeEphemeralBundle(bundleId));
  },

  // Inserts a new PipelineRun with status "Running" and auto-transitions
  // it to "Success" after 8 seconds to simulate a real execution.
  startMockPipelineRun: (pipelineId: string, environment: string): string => {
    const { pipelines, addPipelineRun, updatePipelineRun, updatePipeline } = get();
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    if (!pipeline) return '';

    const runId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const runNumber = `RUN-MOCK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const startTime = new Date();

    const newRun: PipelineRun = {
      id: runId,
      runNumber,
      pipelineId,
      pipelineName: pipeline.name,
      type: pipeline.type,
      status: 'Running',
      startTime,
      endTime: startTime,
      duration: 0,
      recordsProcessed: 0,
      recordsFailed: 0,
      triggerType: 'Manual',
      inputDatasets: pipeline.inputDatasets,
      outputDatasets: pipeline.outputDatasets,
      parameters: {
        engine: pipeline.engine,
        cluster: environment === 'staging' ? 'staging-01' : 'prod-01',
        environment,
      },
      logs: [],
    };

    addPipelineRun(newRun);

    // Auto-complete after 8 s
    setTimeout(() => {
      const endTime = new Date();
      const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
      updatePipelineRun(runId, {
        status: 'Success',
        endTime,
        duration,
        recordsProcessed: Math.floor(Math.random() * 10_000) + 1_000,
        logs: generateRunLogs('Success', pipeline.displayName, duration),
      });
      updatePipeline(pipelineId, {
        lastRunStatus: 'Success',
        lastRunTime: endTime,
      });
    }, 8_000);

    return runId;
  },
}));
