import { describe, it, expect } from 'vitest';
import { generateCatalogData } from '../index';

describe('generateCatalogData', () => {
  const data = generateCatalogData();

  it('returns all 7 collections', () => {
    expect(Array.isArray(data.datasets)).toBe(true);
    expect(Array.isArray(data.dataSources)).toBe(true);
    expect(Array.isArray(data.lineage)).toBe(true);
    expect(Array.isArray(data.pipelines)).toBe(true);
    expect(Array.isArray(data.pipelineRuns)).toBe(true);
    expect(Array.isArray(data.qualityChecks)).toBe(true);
    expect(Array.isArray(data.costs)).toBe(true);
  });

  it('generates expected counts', () => {
    expect(data.datasets).toHaveLength(50);
    expect(data.dataSources).toHaveLength(20);
    expect(data.pipelines).toHaveLength(22);
    expect(data.qualityChecks).toHaveLength(100);
    expect(data.pipelineRuns.length).toBeGreaterThan(0);
    expect(data.lineage.length).toBeGreaterThan(0);
    expect(data.costs.length).toBeGreaterThan(0);
  });

  it('every dataset has at least one pipeline covering it', () => {
    const coveredIds = new Set<string>();
    for (const p of data.pipelines) {
      for (const id of p.inputDatasets) coveredIds.add(id);
      for (const id of p.outputDatasets) coveredIds.add(id);
    }
    for (const ds of data.datasets) {
      expect(coveredIds.has(ds.id)).toBe(true);
    }
  });

  it('pipeline runs reference existing pipelines', () => {
    const pipelineIds = new Set(data.pipelines.map((p) => p.id));
    for (const run of data.pipelineRuns) {
      expect(pipelineIds.has(run.pipelineId)).toBe(true);
    }
  });

  it('quality checks reference existing datasets', () => {
    const datasetIds = new Set(data.datasets.map((d) => d.id));
    for (const check of data.qualityChecks) {
      expect(datasetIds.has(check.datasetId)).toBe(true);
    }
  });

  it('keeps source metadata and source-linked dataset counts consistent', () => {
    const sourceNames = new Set(data.dataSources.map((source) => source.name));
    for (const dataset of data.datasets) {
      expect(sourceNames.has(dataset.source)).toBe(true);
    }
    for (const source of data.dataSources) {
      expect(source.datasetsCount).toBe(data.datasets.filter((dataset) => dataset.source === source.name).length);
    }
  });

  it('keeps every lineage source node consistent with its datasets', () => {
    const sourceByDatasetId = new Map(data.datasets.map((dataset) => [dataset.id, dataset.source]));
    for (const node of data.lineage.filter((item) => item.type === 'Source')) {
      for (const datasetId of node.datasetIds) {
        expect(node.name).toBe(sourceByDatasetId.get(datasetId));
      }
    }
  });

  it('gives each dataset a passing and a non-passing quality-check example', () => {
    for (const dataset of data.datasets) {
      const checks = data.qualityChecks.filter((check) => check.datasetId === dataset.id);
      expect(checks.some((check) => check.result === 'Passed')).toBe(true);
      expect(checks.some((check) => check.result === 'Warning' || check.result === 'Failed')).toBe(true);
    }
  });

  it('links the inventory transformation pipeline to Coffee Inventory', () => {
    const coffeeInventory = data.datasets.find((dataset) => dataset.name === 'coffee_inventory');
    const inventoryPipeline = data.pipelines.find((pipeline) => pipeline.name === 'transform_inventory_silver');
    expect(coffeeInventory).toBeDefined();
    expect(inventoryPipeline?.inputDatasets).toContain(coffeeInventory?.id);
  });

  it('every dataset has lineage data', () => {
    const coveredByLineage = new Set<string>();
    for (const node of data.lineage) {
      for (const id of node.datasetIds) coveredByLineage.add(id);
    }
    for (const ds of data.datasets) {
      expect(coveredByLineage.has(ds.id)).toBe(true);
    }
  });
});
