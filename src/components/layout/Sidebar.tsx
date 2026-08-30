import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Database,
  Play,
  DollarSign,
  TrendingUp,
  TrendingDown,
  PanelLeftClose,
  PanelLeftOpen,
  Code2,
} from 'lucide-react';
import clsx from 'clsx';
import { useCatalogData } from '../../hooks/useCatalogData';
import { Logo } from '../ui/Logo';

const navItems = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/datasets', label: 'Datasets', icon: Database, countKey: 'datasets' as const },
  { path: '/pipelines', label: 'Pipelines', icon: Play, countKey: 'pipelines' as const },
  { path: '/costs', label: 'Costs', icon: DollarSign },
  { path: '/develop', label: 'Develop', icon: Code2 },
];

export function Sidebar() {
  const location = useLocation();
  const data = useCatalogData();
  const [collapsed, setCollapsed] = useState(false);

  const getCounts = (key?: string) => {
    if (!key) return null;
    const arr = data[key as keyof typeof data];
    if (Array.isArray(arr)) return arr.length;
    return null;
  };

  const costTrendUp = (() => {
    const costs = data.costs;
    if (!costs || costs.length < 2) return null;
    const now = Date.now();
    const cutoff15 = now - 15 * 24 * 60 * 60 * 1000;
    const cutoff30 = cutoff15 - 15 * 24 * 60 * 60 * 1000;
    const recent = costs.filter(c => { const t = new Date(c.date).getTime(); return t >= cutoff15 && t <= now; }).reduce((s, c) => s + c.amount, 0);
    const prev = costs.filter(c => { const t = new Date(c.date).getTime(); return t >= cutoff30 && t < cutoff15; }).reduce((s, c) => s + c.amount, 0);
    if (prev === 0 && recent === 0) return null;
    return recent >= prev;
  })();

  return (
    <aside
      className={clsx(
        'bg-brand-950 text-cream-300 flex flex-col flex-shrink-0 h-screen sticky top-0 transition-[width] duration-200 ease-out',
        collapsed ? 'w-16' : 'w-16 md:w-60',
      )}
    >
      <div className={clsx('py-5 border-b border-brand-800', collapsed ? 'px-3' : 'px-3 md:px-4')}>
        <Link
          to="/"
          title="Happy Coffee home"
          className={clsx('flex items-center text-white', collapsed ? 'justify-center' : 'justify-center md:justify-start md:gap-2.5')}
          style={{ '--logo-inner': '#0a0a0a' } as React.CSSProperties}
        >
          <Logo size={collapsed ? 34 : 40} />
          <div className={clsx('min-w-0', collapsed ? 'hidden' : 'hidden md:block')}>
            <h1 className="text-base font-semibold text-white leading-tight">Happy Coffee</h1>
            <p className="text-xs text-cream-500 leading-tight">Data Developer Portal</p>
          </div>
        </Link>
      </div>

      <nav className={clsx('flex-1 py-4 space-y-0.5 overflow-y-auto scrollbar-thin', collapsed ? 'px-2' : 'px-2 md:px-3')}>
        {navItems.map(({ path, label, icon: Icon, countKey }) => {
          const isActive = path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(path);
          const count = getCounts(countKey);

          return (
            <Link
              key={path}
              to={path}
              title={label}
              className={clsx(
                'flex items-center px-3 py-2 rounded-lg text-sm transition-colors',
                collapsed ? 'justify-center' : 'justify-center md:justify-start md:gap-2.5',
                isActive
                  ? 'bg-brand-800 text-white font-medium'
                  : 'text-cream-400 hover:bg-brand-900 hover:text-cream-200'
              )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
              <span className={clsx('flex-1', collapsed ? 'hidden' : 'hidden md:inline')}>{label}</span>
              <span className={clsx(collapsed ? 'hidden' : 'hidden md:inline-flex')}>
              {path === '/costs' && costTrendUp !== null ? (
                costTrendUp ? (
                  <TrendingUp className="w-3.5 h-3.5 text-red-400" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                )
              ) : count !== null ? (
                <span className={clsx(
                  'text-xs px-1.5 py-0.5 rounded-full',
                  isActive ? 'bg-brand-700 text-cream-300' : 'bg-brand-900 text-cream-500'
                )}>
                  {count}
                </span>
              ) : null}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className={clsx('hidden md:block border-t border-brand-800 p-2', collapsed ? 'px-2' : 'px-3')}>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className={clsx(
            'w-full flex items-center rounded-lg px-3 py-2 text-xs text-cream-500 hover:bg-brand-900 hover:text-cream-200 transition-colors',
            collapsed ? 'justify-center' : 'justify-start gap-2'
          )}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          <span className={clsx(collapsed && 'hidden')}>{collapsed ? 'Expand navigation' : 'Collapse sidebar'}</span>
        </button>
      </div>
    </aside>
  );
}
