import type { ReactNode } from "react";

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ open, title, onClose, children }: DrawerProps) {
  if (!open) {
    return null;
  }
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" onClick={event => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">×</button>
        </header>
        {children}
      </aside>
    </div>
  );
}
