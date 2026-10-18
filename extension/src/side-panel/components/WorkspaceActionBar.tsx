import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const WorkspaceFooterContext = createContext<HTMLElement | null>(null);
export function WorkspaceActionBar({ children }: { children: ReactNode }) {
  const target = useContext(WorkspaceFooterContext);
  return target ? createPortal(<div className="p-3 space-y-2" data-testid="workspace-actions">{children}</div>, target) : null;
}
