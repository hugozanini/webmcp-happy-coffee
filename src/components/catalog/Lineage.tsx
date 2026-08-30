import { useState, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  Position,
  Handle,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { Database, ArrowRightLeft, Layers, Gem, Crown, BarChart3 } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { SearchInput } from '../ui/SearchInput';
import { useCatalogData } from '../../hooks/useCatalogData';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import clsx from 'clsx';

const typeConfig: Record<string, { color: string; bg: string; border: string; icon: typeof Database }> = {
  Source:    { color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200',    icon: Database },
  Ingestion: { color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200', icon: ArrowRightLeft },
  Bronze:   { color: 'text-amber-700',    bg: 'bg-amber-50',   border: 'border-amber-200',  icon: Layers },
  Silver:   { color: 'text-brand-700',    bg: 'bg-brand-50',   border: 'border-brand-200',  icon: Gem },
  Gold:     { color: 'text-yellow-700',   bg: 'bg-yellow-50',  border: 'border-yellow-200', icon: Crown },
  BI:       { color: 'text-blue-700',     bg: 'bg-blue-50',    border: 'border-blue-200',   icon: BarChart3 },
};

function LineageNode({ data }: { data: { label: string; type: string; location: string; metadata: Record<string, unknown> } }) {
  const config = typeConfig[data.type] || typeConfig.Source;
  const Icon = config.icon;

  return (
    <div className={clsx('rounded-lg border px-4 py-3 min-w-[180px] max-w-[220px]', config.bg, config.border)}>
      <Handle type="target" position={Position.Left} className="!bg-cream-400 !w-2 !h-2 !border-0" />
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={clsx('w-4 h-4 flex-shrink-0', config.color)} />
        <span className={clsx('text-[10px] font-semibold uppercase tracking-wider', config.color)}>
          {data.type}
        </span>
      </div>
      <p className="text-sm font-medium text-cream-900 leading-tight mb-0.5 truncate">{data.label}</p>
      <p className="text-[11px] text-cream-500 truncate">{data.location}</p>
      <Handle type="source" position={Position.Right} className="!bg-cream-400 !w-2 !h-2 !border-0" />
    </div>
  );
}

const nodeTypes: NodeTypes = { lineage: LineageNode };

function layoutGraph(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 120, nodesep: 60, marginx: 40, marginy: 40 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 200, height: 80 });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return { ...node, position: { x: pos.x - 100, y: pos.y - 40 } };
  });
}

export function Lineage() {
  const { lineage, datasets } = useCatalogData();
  useDocumentTitle('Lineage');
  const [search, setSearch] = useState('');
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);

  const datasetOptions = useMemo(() => {
    const dsIds = new Set<string>();
    lineage.forEach((n) => n.datasetIds.forEach((id) => dsIds.add(id)));
    return Array.from(dsIds).map((id) => {
      const ds = datasets.find((d) => d.id === id);
      return { id, label: ds?.displayName || ds?.name || id.substring(0, 8) };
    });
  }, [lineage, datasets]);

  const filteredDatasets = useMemo(() => {
    if (!search) return datasetOptions;
    const q = search.toLowerCase();
    return datasetOptions.filter((d) => d.label.toLowerCase().includes(q));
  }, [datasetOptions, search]);

  const { nodes, edges } = useMemo(() => {
    const targetIds = selectedDataset
      ? [selectedDataset]
      : filteredDatasets.slice(0, 5).map((d) => d.id);

    const relevantNodes = lineage.filter((n) =>
      n.datasetIds.some((id) => targetIds.includes(id))
    );

    const flowNodes: Node[] = relevantNodes.map((n) => ({
      id: n.id,
      type: 'lineage',
      position: { x: 0, y: 0 },
      data: { label: n.name, type: n.type, location: n.location, metadata: n.metadata },
    }));

    const flowEdges: Edge[] = relevantNodes
      .filter((n) => n.parentId)
      .map((n) => ({
        id: `${n.parentId}-${n.id}`,
        source: n.parentId!,
        target: n.id,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#a3a3a3' },
        style: { stroke: '#a3a3a3', strokeWidth: 2 },
      }));

    const laid = layoutGraph(flowNodes, flowEdges);
    return { nodes: laid, edges: flowEdges };
  }, [lineage, selectedDataset, filteredDatasets]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const data = node.data as { metadata: Record<string, unknown> };
    if (data.metadata && Object.keys(data.metadata).length > 0) {
      console.log('Node metadata:', data.metadata);
    }
  }, []);

  return (
    <div>
      <PageHeader
        title="Data Lineage"
        subtitle="Trace data flow from source systems to BI dashboards"
        actions={
          <div className="flex items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search datasets..."
              className="w-64"
            />
          </div>
        }
      />

      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 scrollbar-thin">
        <button
          onClick={() => setSelectedDataset(null)}
          className={clsx(
            'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
            !selectedDataset
              ? 'bg-brand-100 border-brand-300 text-brand-900'
              : 'bg-white border-cream-200 text-cream-600 hover:border-cream-300'
          )}
        >
          All (top 5)
        </button>
        {filteredDatasets.slice(0, 15).map((d) => (
          <button
            key={d.id}
            onClick={() => setSelectedDataset(d.id)}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
              selectedDataset === d.id
                ? 'bg-brand-100 border-brand-300 text-brand-900'
                : 'bg-white border-cream-200 text-cream-600 hover:border-cream-300'
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="h-[460px] sm:h-[600px] bg-white rounded-xl border border-cream-200 shadow-card overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          fitView
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e5e5e5" gap={20} size={1} />
          <Controls
            className="!bg-white !border-cream-200 !rounded-lg !shadow-card [&>button]:!bg-white [&>button]:!border-cream-200 [&>button]:!text-cream-600 [&>button:hover]:!bg-cream-50"
          />
          <MiniMap
            className="!bg-white !border-cream-200 !rounded-lg"
            nodeColor="#a3a3a3"
            maskColor="rgba(245,245,245,0.75)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
