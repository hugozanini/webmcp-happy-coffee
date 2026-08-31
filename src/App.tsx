import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { ContentShell } from './components/layout/ContentShell';
import { Home } from './components/catalog/Home';
import { Datasets } from './components/catalog/Datasets';
import { DatasetDetail } from './components/catalog/DatasetDetail';
import { Pipelines } from './components/catalog/Pipelines';
import { PipelineDetail } from './components/catalog/PipelineDetail';
import { Costs } from './components/catalog/Costs';
import { SearchResults } from './components/catalog/SearchResults';
import { Sources } from './components/catalog/Sources';
import { Quality } from './components/catalog/Quality';
import { WebMCPIntegration } from './components/mcp/WebMCPIntegration';

const DevelopmentWorkspace = lazy(() =>
  import('./components/develop/DevelopmentWorkspace').then(({ DevelopmentWorkspace: Workspace }) => ({ default: Workspace })),
);

function App() {
  return (
    <BrowserRouter>
      <WebMCPIntegration />
      <div className="flex h-screen overflow-hidden bg-cream-50">
        <Sidebar />
        <ContentShell>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<SearchResults />} />
            <Route path="/datasets" element={<Datasets />} />
            <Route path="/datasets/:id" element={<DatasetDetail />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/quality" element={<Quality />} />
            <Route path="/pipelines" element={<Pipelines />} />
            <Route path="/pipelines/:id" element={<PipelineDetail />} />
            <Route path="/costs" element={<Costs />} />
            <Route path="/develop" element={<Suspense fallback={<div className="p-6 text-sm text-cream-500">Loading development workspace…</div>}><DevelopmentWorkspace /></Suspense>} />
          </Routes>
        </ContentShell>
      </div>
    </BrowserRouter>
  );
}

export default App;
