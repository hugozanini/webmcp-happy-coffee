import { useMemo } from 'react';
import { Activity, Database, PlugZap, Server } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../layout/PageHeader';
import { SearchInput } from '../ui/SearchInput';
import { useCatalogData } from '../../hooks/useCatalogData';
import clsx from 'clsx';

const statusStyle = {
  Connected: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Degraded: 'bg-amber-50 text-amber-700 border-amber-200',
  Disconnected: 'bg-red-50 text-red-700 border-red-200',
};

export function Sources() {
  const { dataSources, datasets } = useCatalogData();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const selectedId = params.get('source');
  const selected = dataSources.find((source) => source.id === selectedId);
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return dataSources.filter((source) => !q || [source.name, source.system, source.owner, source.type].some((value) => value.toLowerCase().includes(q)));
  }, [dataSources, query]);

  return <div>
    <PageHeader title="Data Sources" subtitle={`${filtered.length} connected systems available to the portal`} />
    <div className="mb-5 max-w-xl"><SearchInput value={query} onChange={(value) => setParams(value ? { q: value } : {})} placeholder="Search sources, systems, or owners..." /></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((source) => <button key={source.id} type="button" onClick={() => setParams({ ...(query ? { q: query } : {}), source: source.id })} className={clsx('rounded-xl border bg-white p-4 text-left shadow-card transition hover:border-brand-300', selectedId === source.id ? 'border-brand-400 ring-1 ring-brand-100' : 'border-cream-200')}>
          <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><span className="rounded-lg bg-brand-50 p-2 text-brand-700"><Server className="h-4 w-4" /></span><div><h2 className="text-sm font-semibold text-cream-900">{source.name}</h2><p className="text-xs text-cream-500">{source.system}</p></div></div><span className={clsx('rounded-full border px-2 py-0.5 text-[10px] font-medium', statusStyle[source.connectionStatus])}>{source.connectionStatus}</span></div>
          <p className="mt-3 line-clamp-2 text-xs text-cream-600">{source.description}</p>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-cream-500"><span className="inline-flex items-center gap-1"><Database className="h-3 w-3" />{source.datasetsCount} datasets</span><span>{source.type}</span></div>
        </button>)}
      </div>
      <aside className="rounded-xl border border-cream-200 bg-white p-4 shadow-card">
        {selected ? <><div className="flex items-center gap-2"><PlugZap className="h-4 w-4 text-brand-700" /><h2 className="text-sm font-semibold text-cream-900">{selected.name}</h2></div><p className="mt-1 text-xs text-cream-500">{selected.system} · {selected.type}</p><p className="mt-4 text-sm leading-6 text-cream-700">{selected.description}</p><dl className="mt-5 space-y-3 text-xs"><div><dt className="text-cream-400">Owner</dt><dd className="mt-0.5 font-medium text-cream-800">{selected.owner}</dd></div><div><dt className="text-cream-400">Last sync</dt><dd className="mt-0.5 font-medium text-cream-800">{new Date(selected.lastSync).toLocaleString()}</dd></div><div><dt className="text-cream-400">Connected datasets</dt><dd className="mt-1 space-y-1">{datasets.filter((dataset) => dataset.source === selected.system).slice(0, 8).map((dataset) => <p key={dataset.id} className="rounded bg-cream-50 px-2 py-1 font-mono text-[11px] text-cream-700">{dataset.displayName}</p>)}{!datasets.some((dataset) => dataset.source === selected.system) && <span className="text-cream-500">No datasets linked in generated metadata.</span>}</dd></div></dl></> : <div className="flex min-h-48 flex-col items-center justify-center text-center text-cream-400"><Activity className="h-5 w-5" /><p className="mt-2 text-xs">Select a source to inspect its connection and datasets.</p></div>}
      </aside>
    </div>
  </div>;
}
