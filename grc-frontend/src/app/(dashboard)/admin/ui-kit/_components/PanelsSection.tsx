'use client';

// SidePanel and Sheet: the panel that is a docked column on a wide window, an overlay on a laptop and a bottom sheet on a phone, and the modal sheet.
// Each button that opens a modal one carries data-guide-opener, which is how the accessibility probe finds it (it opens each one, checks focus, Tab,
// Escape and focus return). The docked column is not a dialog, so it has no opener: the probe's kit-2 extension checks it (no trap, no scroll lock,
// the content shrinks). Everything here is simulated: no request leaves the page.
import { useRef, useState } from 'react';
import { Button, Checkbox, FormField, Menu, Sheet, SidePanel, Textarea, useConfirm, type MenuItem } from '@/components/ui';
import { usePanelMode } from '@/components/ui/ds/usePanelMode';
import { GuideSection, MONO, Row, Spec, Specimen } from './Guide';

const LONG_TITLE = 'Information security management system: annual review of every policy, standard and procedure owned by the technology risk office of the retail banking group';
const LONG_WORD = 'A'.repeat(120);
const FRAME = 'overflow-x-auto rounded-ds-card border border-ds-border';

function Footer({ onClose, label = 'Save' }: { onClose: () => void; label?: string }) {
  return (
    <div className="flex justify-end gap-2">
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={onClose}>{label}</Button>
    </div>
  );
}

function Lines({ count }: { count: number }) {
  return (
    <ul className="space-y-[8px]">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="break-words rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">
          {i === 0 ? `Item 1 with an unbroken word: ${LONG_WORD}` : `Item ${i + 1}: the body scrolls inside the panel while the title and the footer stay.`}
        </li>
      ))}
    </ul>
  );
}

const workItems = (n: number) => Array.from({ length: n }, (_, i) => `Review request ${i + 1}`);

/** A docked column inside a box: the content on the left shrinks to make room, nothing is covered. The box scrolls sideways on a phone so the page does not. */
function DockedDemo() {
  const [open, setOpen] = useState(true);
  const toggle = useRef<HTMLButtonElement>(null);
  const items: MenuItem[] = [{ key: 'pin', label: 'Pin this panel', onSelect: () => undefined }, { key: 'clear', label: 'Clear recent', onSelect: () => undefined }];
  return (
    <div className="space-y-[8px]">
      <Row>
        <Button ref={toggle} data-guide-docked-toggle aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Hide the docked column' : 'Show the docked column'}</Button>
        <span className="text-ds-label text-ds-fg-muted">Escape inside the column closes it here (<code className={MONO}>escapeClosesDocked</code>); focus goes back to this button.</span>
      </Row>
      <div className={FRAME}>
        <div className="flex h-[320px] min-w-[640px] bg-ds-bg">
          <div data-guide-docked-content className="min-w-0 flex-1 space-y-[8px] overflow-y-auto p-[16px]">
            <p className="text-ds-body font-medium text-ds-fg">The page</p>
            <p className="text-ds-body text-ds-fg-body">The content area gives up the room the column needs and gets it back when the column closes. Nothing is covered, there is no scrim, Tab moves on through the page and the column, and the page keeps scrolling.</p>
            <Button>A button in the page</Button>
          </div>
          <SidePanel
            mode="docked"
            open={open}
            onClose={() => setOpen(false)}
            title="Work and context"
            width="sm"
            padded={false}
            escapeClosesDocked
            restoreFocus={toggle}
            actions={<Menu label="Panel actions" iconOnly items={items} />}
          >
            <ul className="divide-y divide-ds-border">
              {workItems(6).map((label) => (
                <li key={label}><button type="button" className="flex min-h-ds-control w-full items-center px-[16px] py-[8px] text-left text-ds-body text-ds-fg hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]">{label}</button></li>
              ))}
            </ul>
          </SidePanel>
        </div>
      </div>
    </div>
  );
}

/** The panel with no mode forced: a column in the box from a 1440 px window, an overlay from 640 px, a bottom sheet below. */
function AutoDemo() {
  const [open, setOpen] = useState(false);
  const mode = usePanelMode(1440);
  return (
    <div className="space-y-[8px]">
      <Row>
        <Button data-guide-auto-toggle aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Close the panel' : 'Open the panel'}</Button>
        <span className="text-ds-label text-ds-fg-muted" aria-live="polite">This window gives a <code className={MONO} data-guide-auto-mode>{mode}</code> panel.</span>
      </Row>
      <div className={FRAME}>
        <div className="flex h-[240px] min-w-[640px] bg-ds-bg">
          <div className="min-w-0 flex-1 p-[16px]"><p className="text-ds-body text-ds-fg-body">When the window is 1440 px or wider the panel docks here; narrower, it opens over the whole page.</p></div>
          <SidePanel open={open} onClose={() => setOpen(false)} title="Work and context" width="sm" footer={<Footer onClose={() => setOpen(false)} label="Done" />}>
            <Lines count={3} />
          </SidePanel>
        </div>
      </div>
    </div>
  );
}

type Opened = null | 'overlay' | 'dirty' | 'sheet' | 'long' | 'stacked';

function ModesDemo() {
  const [open, setOpen] = useState<Opened>(null);
  const [note, setNote] = useState('');
  const [asked, setAsked] = useState('nothing yet');
  const { confirm, confirmDialog } = useConfirm();
  const close = () => { setOpen(null); setNote(''); };
  const ask = async () => {
    const yes = await confirm({ title: 'Archive this document?', message: 'Escape closes this question and leaves the panel behind it open: one Escape closes one layer.', confirmLabel: 'Archive', tone: 'danger' });
    setAsked(yes ? 'archived' : 'cancelled');
  };
  return (
    <div className="space-y-[8px]">
      <Row>
        <Button data-guide-opener="SidePanel" data-guide-variant="overlay" onClick={() => setOpen('overlay')}>Open as an overlay</Button>
        <Button data-guide-opener="SidePanel" data-guide-variant="overlay with typing" data-guide-field="#guide-panel-note" onClick={() => setOpen('dirty')}>Open an overlay with typing</Button>
        <Button data-guide-opener="SidePanel" data-guide-variant="sheet" onClick={() => setOpen('sheet')}>Open as a bottom sheet</Button>
        <Button data-guide-opener="SidePanel" data-guide-variant="long" onClick={() => setOpen('long')}>Open with a 150-character title</Button>
        <Button data-guide-stacked-panel onClick={() => setOpen('stacked')}>Open a panel that asks a question</Button>
      </Row>
      <p className="text-ds-label text-ds-fg-muted" aria-live="polite">The question was: {asked}.</p>
      <SidePanel mode="overlay" open={open === 'overlay'} onClose={close} title="Document details" subtitle="An overlay: a scrim, Tab wrapped inside, the page does not scroll" footer={<Footer onClose={close} label="Done" />}>
        <p className="text-ds-body text-ds-fg-body">Escape, the X and a press on the scrim close it. Focus goes back to the button that opened it.</p>
      </SidePanel>
      <SidePanel mode="overlay" open={open === 'dirty'} onClose={close} title="Add a note" subtitle="Typing makes it dirty: closing asks first" dirty={note.trim() !== ''} footer={<Footer onClose={close} />}>
        <FormField id="guide-panel-note" label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type, then press Escape" /></FormField>
      </SidePanel>
      <SidePanel mode="sheet" open={open === 'sheet'} onClose={close} title="Filters" footer={<Button variant="primary" fullWidth onClick={close}>Show 124 documents</Button>}>
        <div className="flex flex-col">
          <Checkbox label="In force" defaultChecked />
          <Checkbox label="Review overdue" />
          <Checkbox label="Waiting for me" />
          <Checkbox label="No owner" />
        </div>
      </SidePanel>
      <SidePanel mode="overlay" width="lg" open={open === 'long'} onClose={close} title={LONG_TITLE} subtitle={`A subtitle with an unbroken word: ${LONG_WORD}`} footer={<Footer onClose={close} label="Done" />}>
        <Lines count={24} />
      </SidePanel>
      <SidePanel mode="overlay" open={open === 'stacked'} onClose={close} title="A panel that asks" footer={<Footer onClose={close} label="Done" />}>
        <Button data-guide-stacked-ask onClick={ask}>Archive the document</Button>
      </SidePanel>
      {confirmDialog}
    </div>
  );
}

type SheetOpen = null | 'auto' | 'bottom' | 'right' | 'filters';

function SheetDemo() {
  const [open, setOpen] = useState<SheetOpen>(null);
  const [note, setNote] = useState('');
  const close = () => { setOpen(null); setNote(''); };
  return (
    <div className="space-y-[8px]">
      <Row>
        <Button data-guide-opener="Sheet" data-guide-variant="auto" onClick={() => setOpen('auto')}>Open (right sheet, bottom sheet on a phone)</Button>
        <Button data-guide-opener="Sheet" data-guide-variant="bottom" onClick={() => setOpen('bottom')}>Open a bottom sheet</Button>
        <Button data-guide-opener="Sheet" data-guide-variant="right, typing" data-guide-field="#guide-sheet-note" onClick={() => setOpen('right')}>Open a wide sheet with typing</Button>
        <Button data-guide-opener="Sheet" data-guide-variant="filters" onClick={() => setOpen('filters')}>Open the filter sheet</Button>
      </Row>
      <Sheet open={open === 'auto'} onClose={close} title="Committee settings" subtitle="Right-hand from 640 px, a bottom sheet under that" footer={<Footer onClose={close} label="Done" />}>
        <Lines count={4} />
      </Sheet>
      <Sheet side="bottom" open={open === 'bottom'} onClose={close} title="Views" footer={<Button fullWidth onClick={close}>Close</Button>}>
        <ul className="space-y-[4px]">
          {['All documents', 'Mine', 'Waiting for me', 'Review overdue', 'No owner'].map((v) => (
            <li key={v}><button type="button" onClick={close} className="flex min-h-ds-control w-full items-center rounded-ds-control px-[8px] text-left text-ds-body text-ds-fg hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">{v}</button></li>
          ))}
        </ul>
      </Sheet>
      <Sheet side="right" width="lg" open={open === 'right'} onClose={close} title="Manage the committee" dirty={note.trim() !== ''} footer={<Footer onClose={close} />}>
        <FormField id="guide-sheet-note" label="Charter note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type, then press Escape" /></FormField>
      </Sheet>
      <Sheet open={open === 'filters'} onClose={close} title="Filters" subtitle="124 documents match" footer={<Button variant="primary" fullWidth onClick={close}>Show 124 documents</Button>}>
        <div className="flex flex-col">
          {['In force', 'Review overdue', 'Waiting for me', 'No owner', 'Expired', 'Draft', 'Archived'].map((v) => <Checkbox key={v} label={v} />)}
        </div>
      </Sheet>
    </div>
  );
}

export function PanelsSection() {
  return (
    <GuideSection id="panels" title="Panels and sheets" lead="One panel for a record, a queue or a set of tools: a column beside the page on a wide window, an overlay with a scrim on a laptop, a bottom sheet on a phone. Focus moves in, Tab wraps, Escape closes one layer and focus goes back, except in the docked column, which is part of the page.">
      <Spec name="SidePanel">
        <Specimen label="Docked, in a box: the content gives up the room and gets it back. Not a dialog: no scrim, no trap, no scroll lock"><DockedDemo /></Specimen>
        <Specimen label="No mode forced: docked in the box from a 1440 px window, an overlay from 640 px, a bottom sheet below"><AutoDemo /></Specimen>
        <Specimen label="Forced modes, typing (dirty), a 150-character title with a 120-character word and a long body, and a panel that opens a question over itself"><ModesDemo /></Specimen>
      </Spec>
      <Spec name="Sheet"><Specimen label="The modal sheet: right-hand or bottom, with the footer that stays in view"><SheetDemo /></Specimen></Spec>
    </GuideSection>
  );
}
