import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(screen.getByText('Data Developer Portal')).toBeInTheDocument();
  });

  it('can collapse and expand the navigation', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeInTheDocument();
  });
});
