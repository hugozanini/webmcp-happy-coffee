import { type LucideIcon } from 'lucide-react';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  detail?: string;
}

export function StatCard({ icon: Icon, label, value, detail }: StatCardProps) {
  return (
    <div className="bg-white border border-cream-200 rounded-xl p-3.5 shadow-card">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-brand-700" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] leading-3 text-cream-500 font-semibold uppercase tracking-wide">{label}</p>
          <p className="text-lg font-semibold text-cream-950 leading-tight">{value}</p>
          {detail && <p className="text-[11px] text-cream-500 leading-3">{detail}</p>}
        </div>
      </div>
    </div>
  );
}
