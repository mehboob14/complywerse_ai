'use client';

// Whether the off-canvas menu (the drawer) is open. The menu button in the top bar and the one on the rail open it and the drawer in
// Sidebar.tsx shows it. They are siblings in the dashboard layout, so the one flag lives in a provider around them.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** The drawer's id: the buttons that open it name it in aria-controls. */
export const MAIN_MENU_ID = 'main-menu';

interface ShellMenu {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const Ctx = createContext<ShellMenu>({ open: false, setOpen: () => {} });

export function ShellMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useShellMenu = () => useContext(Ctx);
