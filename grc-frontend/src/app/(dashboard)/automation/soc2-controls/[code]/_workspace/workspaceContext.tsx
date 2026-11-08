'use client';

// What every tab of the workspace shares: the control, who is looking and what they may do, the sections that are open, and the sheets any part can ask for. One context instead of
// a dozen props through five tabs; nothing in it is stored anywhere but the page.
import { createContext, useContext } from 'react';
import type { ControlDetail } from './types';
import type { SectionKey, TabKey } from './workspaceModel';
import type { WsRights } from './workspaceRightsModel';

export interface WorkspaceValue {
  code: string;
  d: ControlDetail;
  isCustom: boolean;
  rights: WsRights;
  /** why a button is off for a right, or undefined when the person holds it */
  why: (key: keyof WsRights) => string | undefined;
  /** the signed-in person's id, null while unknown */
  me: number | null;
  /** the sections open in the tab, and the ask to open or shut one */
  open: ReadonlySet<SectionKey>;
  setOpen: (section: SectionKey, open: boolean) => void;
  /** go to a tab, opening one of its sections and scrolling to it */
  go: (tab: TabKey, section?: SectionKey) => void;
  /** the sheets */
  decide: () => void;
  rateMaturity: () => void;
  /** a test to continue or review, or 'new' */
  recordTest: (test: number | 'new') => void;
  editControl: () => void;
  /** refresh everything a write can change, here and in the lists that read the control */
  refresh: () => Promise<unknown>;
  /** press Run tests: each test runs, the report says how it went */
  runTests: () => void;
  running: boolean;
}

const Ctx = createContext<WorkspaceValue | null>(null);
export const WorkspaceProvider = Ctx.Provider;

export function useWorkspace(): WorkspaceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace outside the control workspace');
  return v;
}
