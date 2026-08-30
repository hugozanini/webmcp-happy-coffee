import { type LucideIcon } from 'lucide-react';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  detail?: string;
}

export function StatCard({ icon: Icon, label, value, detail }: StatCardProps) {
  return (
    <div className="bg-white border border-cream-200 rounded-xl p-4 shadow-card min-h-[128px]">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
          <Icon className="w-4.5 h-4.5 text-brand-700" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] leading-4 text-cream-500 font-semibold uppercase tracking-wide">{label}</p>
          <p className="text-xl font-semibold text-cream-950 leading-tight">{value}</p>
          {detail && <p className="text-xs text-cream-500 mt-1 leading-4">{detail}</p>}
        </div>
      </div>
    </div>
  );
}
