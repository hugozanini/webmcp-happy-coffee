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
import { WebMCPIntegration } from './components/mcp/WebMCPIntegration';

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
            <Route path="/pipelines" element={<Pipelines />} />
            <Route path="/pipelines/:id" element={<PipelineDetail />} />
            <Route path="/costs" element={<Costs />} />
          </Routes>
        </ContentShell>
      </div>
    </BrowserRouter>
  );
}

export default App;
