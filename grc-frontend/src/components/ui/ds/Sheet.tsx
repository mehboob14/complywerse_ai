'use client';

// Sheet: the modal sheet. A wide sheet that slides in from the right on a desktop (management of a committee, a filter rail) and a bottom sheet on a
// phone (the filter sheet with its "Show 124 documents" footer, a view picker). It is a SidePanel that never docks, so it shares everything with it:
// the scrim, the focus trap, the locked page scroll, Escape closing one layer, `dirty` asking before typed input is thrown away, and focus going back.
// `side="auto"` (the default) is the right-hand sheet from 640 px and the bottom sheet under it; "right" and "bottom" force one.
//
//   <Sheet open={open} onClose={close} title="Filters" footer={<Button variant="primary" fullWidth onClick={close}>Show 124 documents</Button>}>…</Sheet>
import type { ReactNode, RefObject } from 'react';
import { SidePanel } from './SidePanel';
import type { FocusTarget, PanelWidth } from './sidePanelModel';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** auto: a sheet from the right at 640 px and up, a bottom sheet under that (default). right and bottom force one. */
  side?: 'auto' | 'right' | 'bottom';
  /** sm 360 px, md 480 px, lg 640 px: the width of the right-hand sheet. */
  width?: PanelWidth;
  padded?: boolean;
  dirty?: boolean;
  discardLabel?: string;
  keepLabel?: string;
  closeOnBackdrop?: boolean;
  initialFocus?: string | RefObject<HTMLElement>;
  restoreFocus?: FocusTarget;
  closeLabel?: string;
}

export function Sheet({ side = 'auto', ...rest }: SheetProps) {
  return <SidePanel {...rest} dockFrom={Infinity} mode={side === 'right' ? 'overlay' : side === 'bottom' ? 'sheet' : undefined} />;
}
