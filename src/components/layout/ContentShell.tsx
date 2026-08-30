import { ReactNode } from 'react';

interface ContentShellProps {
  children: ReactNode;
}

export function ContentShell({ children }: ContentShellProps) {
  return (
    <div className="flex-1 h-screen overflow-y-auto scrollbar-thin p-6">
      {children}
    </div>
  );
}
