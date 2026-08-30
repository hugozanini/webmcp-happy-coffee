import { ReactNode } from 'react';

interface ContentShellProps {
  children: ReactNode;
}

export function ContentShell({ children }: ContentShellProps) {
  return (
    <main className="flex-1 min-w-0 h-screen overflow-y-auto scrollbar-thin p-4 sm:p-6">
      {children}
    </main>
  );
}
