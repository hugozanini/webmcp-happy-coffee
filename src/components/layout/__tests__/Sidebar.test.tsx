import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { useCatalogStore } from '../../../store/catalog-store';

function renderSidebar(path = '/') {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>
  );
  return result;
}

describe('Sidebar', () => {
  beforeEach(() => {
    useCatalogStore.getState().initialize();
  });

  it('renders all nav links', () => {
    renderSidebar();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Datasets')).toBeInTheDocument();
    expect(screen.getByText('Pipelines')).toBeInTheDocument();
    expect(screen.getByText('Costs')).toBeInTheDocument();
  });

  it('shows dataset and pipeline counts', () => {
    renderSidebar();
    const state = useCatalogStore.getState();
    expect(screen.getByText(String(state.datasets.length))).toBeInTheDocument();
    expect(screen.getByText(String(state.pipelines.length))).toBeInTheDocument();
  });

  it('renders the Happy Coffee branding', () => {
    renderSidebar();
    expect(screen.getByText('Happy Coffee')).toBeInTheDocument();
    expect(screen.getByText('Data Catalog')).toBeInTheDocument();
  });
});
