import type { ReactNode } from "react";

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span>{children}</span>
      {action}
    </div>
  );
}
