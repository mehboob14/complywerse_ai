'use client';

// Dialogs, drawers, the discard bar, the confirm question, toasts and the reported mutation: every way the platform asks, answers or reports.
// Each button that opens a dialog or a drawer carries data-guide-opener, which is how the accessibility probe finds it (it opens each one, checks
// focus, Tab, Escape and focus return); the toast buttons carry data-guide-toast. Everything here is simulated: no request leaves the page.
import { useEffect, useRef, useState } from 'react';
import { AnimatedModal, Button, DiscardBar, FormField, RightSlidePanel, Select, Textarea, TextInput, useConfirm, useNotify, useReportedMutation } from '@/components/ui';
import { GuideSection, MONO, Row, Spec, Specimen } from './Guide';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** An error shaped like the one the API client throws, so the helpers clean it the way they do in the app. */
function serverError(status: number, detail: string): Error {
  return Object.assign(new Error(detail), { isAxiosError: true, response: { status, data: { detail } } });
}

type Width = 'md' | 'lg' | 'xl' | '2xl' | '3xl';

function Footer({ onClose, label = 'Save' }: { onClose: () => void; label?: string }) {
  return (
    <div className="flex justify-end gap-2">
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={onClose}>{label}</Button>
    </div>
  );
}

function ModalDemo() {
  const [open, setOpen] = useState<null | 'plain' | 'dirty' | 'sized'>(null);
  const [note, setNote] = useState('');
  const [size, setSize] = useState<Width>('md');
  const close = () => { setOpen(null); setNote(''); };
  return (
    <>
      <Row>
        <Button data-guide-opener="AnimatedModal" data-guide-variant="plain" onClick={() => setOpen('plain')}>Open dialog</Button>
        <Button data-guide-opener="AnimatedModal" data-guide-variant="dirty" data-guide-field="#guide-modal-note" onClick={() => setOpen('dirty')}>Open dialog with typing</Button>
        <label className="flex items-center gap-2 text-ds-label text-ds-fg-muted">
          Width
          <Select aria-label="Dialog width" value={size} onChange={(e) => setSize(e.target.value as Width)} className="w-[110px]">
            {(['md', 'lg', 'xl', '2xl', '3xl'] as const).map((w) => <option key={w} value={w}>{w}</option>)}
          </Select>
        </label>
        <Button onClick={() => setOpen('sized')}>Open at that width</Button>
      </Row>
      <AnimatedModal isOpen={open === 'plain'} onClose={close} title="Rename the document" subtitle="The new name shows in the library and in notifications." size="md" footer={<Footer onClose={close} />}>
        <div className="p-[16px]"><FormField label="Title"><TextInput defaultValue="Information security policy" /></FormField></div>
      </AnimatedModal>
      <AnimatedModal isOpen={open === 'dirty'} onClose={close} title="Add a note" subtitle="Escape, the X and a press outside ask before they throw the note away." size="md" dirty={note.trim() !== ''} footer={<Footer onClose={close} />}>
        <div className="p-[16px]"><FormField id="guide-modal-note" label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type, then press Escape" /></FormField></div>
      </AnimatedModal>
      <AnimatedModal isOpen={open === 'sized'} onClose={close} title={`A ${size} dialog`} size={size} footer={<Footer onClose={close} label="Done" />}>
        <div className="p-[16px]"><p className="text-ds-body text-ds-fg-body">The body scrolls when it is taller than the window; the title row and the footer stay.</p></div>
      </AnimatedModal>
    </>
  );
}

function DrawerDemo() {
  const [open, setOpen] = useState<null | 'plain' | 'dirty' | 'inert'>(null);
  const [note, setNote] = useState('');
  const close = () => { setOpen(null); setNote(''); };
  const body = (id: string) => <div className="space-y-[12px]"><FormField id={id} label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type, then press Escape" /></FormField></div>;
  return (
    <>
      <Row>
        <Button data-guide-opener="RightSlidePanel" data-guide-variant="plain" onClick={() => setOpen('plain')}>Open drawer</Button>
        <Button data-guide-opener="RightSlidePanel" data-guide-variant="dirty" data-guide-field="#guide-drawer-note" onClick={() => setOpen('dirty')}>Open drawer with typing</Button>
        <Button onClick={() => setOpen('inert')}>Open drawer (backdrop inert)</Button>
      </Row>
      <RightSlidePanel isOpen={open === 'plain'} onClose={close} title="Document details" subtitle="A record's detail beside the list" footer={<Footer onClose={close} label="Done" />}>
        <p className="text-ds-body text-ds-fg-body">Nothing to lose here, so Escape, the X and a press on the backdrop simply close it.</p>
      </RightSlidePanel>
      <RightSlidePanel isOpen={open === 'dirty'} onClose={close} title="Add a note" subtitle="Typing makes it dirty: closing asks first" dirty={note.trim() !== ''} footer={<Footer onClose={close} />}>
        {body('guide-drawer-note')}
      </RightSlidePanel>
      <RightSlidePanel isOpen={open === 'inert'} onClose={close} title="Backdrop inert" subtitle="closeOnBackdrop is false" closeOnBackdrop={false} dirty={note.trim() !== ''} footer={<Footer onClose={close} />}>
        {body('guide-drawer-inert-note')}
      </RightSlidePanel>
    </>
  );
}

/** A drawer that opens a preview dialog over itself. The dialog is written BEFORE the drawer on purpose: the order the two Escape listeners are added in is
 *  the order of the tree, so this is the one where the drawer hears a press after the dialog has already taken it. One Escape must close one layer. */
function StackedDemo() {
  const [drawer, setDrawer] = useState(false);
  const [preview, setPreview] = useState(false);
  const [log, setLog] = useState('nothing yet');
  return (
    <div className="space-y-[8px]">
      <Row><Button data-guide-stacked onClick={() => setDrawer(true)}>Open a drawer with a preview</Button></Row>
      <p className="text-ds-label text-ds-fg-muted" aria-live="polite">Last closed: {log}. Open the drawer, then the preview, and press Escape once: only the preview closes; the second Escape closes the drawer.</p>
      <AnimatedModal isOpen={preview} onClose={() => { setPreview(false); setLog('the preview'); }} title="Preview" subtitle="Drawn over the drawer" size="md">
        <div className="p-[16px]"><p className="text-ds-body text-ds-fg-body">Escape closes this dialog and nothing under it.</p></div>
      </AnimatedModal>
      <RightSlidePanel isOpen={drawer} onClose={() => { setDrawer(false); setLog('the drawer'); }} title="Document details" subtitle="A drawer that opens a preview" footer={<Footer onClose={() => { setDrawer(false); setLog('the drawer'); }} label="Done" />}>
        <Button data-guide-stacked-preview onClick={() => setPreview(true)}>Preview the document</Button>
      </RightSlidePanel>
    </div>
  );
}

function DiscardBarDemo() {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-[8px]">
      <Button onClick={() => setShown(true)} disabled={shown}>Show the bar</Button>
      {shown && (
        <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
          <DiscardBar onKeep={() => setShown(false)} onDiscard={() => setShown(false)} />
        </div>
      )}
      <p className="text-ds-label text-ds-fg-muted">The bar takes focus on “Keep editing” when it appears, so a stray Enter cannot throw typed input away.</p>
    </div>
  );
}

function ConfirmDemo() {
  const { confirm, confirmDialog } = useConfirm();
  const [answer, setAnswer] = useState('none yet');
  const ask = async (danger: boolean) => {
    const yes = await confirm(danger
      ? { title: 'Archive 3 documents?', message: 'They leave the library and nobody can acknowledge them any more. You can restore them from the archive.', confirmLabel: 'Archive 3 documents', tone: 'danger' }
      : { title: 'Send the review request?', message: 'The reviewers are notified now.', confirmLabel: 'Send the request' });
    setAnswer(yes ? 'confirmed' : 'cancelled');
  };
  return (
    <div className="space-y-[8px]">
      <Row>
        <Button data-guide-opener="ConfirmDialog" data-guide-variant="default" onClick={() => ask(false)}>Ask (default)</Button>
        <Button variant="dangerOutline" data-guide-opener="ConfirmDialog" data-guide-variant="danger" onClick={() => ask(true)}>Ask (danger)</Button>
      </Row>
      <p className="text-ds-label text-ds-fg-muted" aria-live="polite">Answer: {answer}. The danger question puts focus on Cancel; Escape, a press outside and the page going away are all “cancelled”.</p>
      {confirmDialog}
    </div>
  );
}

function NotifyDemo() {
  const notify = useNotify();
  return (
    <Row>
      <Button data-guide-toast onClick={() => notify.success('Document archived')}>Success</Button>
      <Button data-guide-toast onClick={() => notify.warning('Two reviewers have not answered yet', { title: 'Reminder' })}>Warning</Button>
      <Button data-guide-toast onClick={() => notify.info('The library is read-only while the backup runs')}>Info</Button>
      <Button data-guide-toast onClick={() => notify.error(serverError(409, 'Someone else changed this document. Reload it and try again.'), { title: "Couldn't save the document" })}>Error (stays)</Button>
      <Button data-guide-toast onClick={() => notify.error(serverError(503, 'The server is busy.'), { title: "Couldn't send the request", retry: () => notify.success('Sent on the second try') })}>Error with Retry</Button>
    </Row>
  );
}

type Mode = 'ok' | 'headline' | 'busy' | 'silent' | 'flaky' | 'refused';

function MutationDemo() {
  const attempts = useRef(0);
  const [last, setLast] = useState('nothing yet');
  const run = useReportedMutation<string, Mode>({
    mutationFn: async (mode) => {
      await sleep(600);
      if (mode === 'ok' || mode === 'headline') return 'saved';
      if (mode === 'busy') throw serverError(503, 'The register is read-only while the nightly backup runs.');
      if (mode === 'silent') throw serverError(500, '');                                  // the server said nothing usable: `fallback` speaks
      if (mode === 'refused') throw serverError(403, 'You do not have permission to archive documents.');
      attempts.current += 1;
      if (attempts.current % 2 === 1) throw serverError(503, 'The server is busy. Try again.');
      return 'saved';
    },
    success: (_data, mode) => (mode === 'headline' ? { title: 'Settings saved', message: 'New requests use them from now on.' } : 'Document archived'),
    failure: "Couldn't archive the document",
    fallback: 'The document could not be archived.',
    onSuccess: () => setLast('the server answered ok'),
    onError: () => setLast('the server refused or failed'),
  });
  useEffect(() => { if (run.isPending) setLast('waiting for the server…'); }, [run.isPending]);
  return (
    <div className="space-y-[8px]">
      <Row>
        <Button variant="primary" loading={run.isPending} onClick={() => run.mutate('ok')}>Succeeds</Button>
        <Button loading={run.isPending} onClick={() => run.mutate('headline')}>Succeeds with a headline and a second line</Button>
        <Button loading={run.isPending} onClick={() => run.mutate('busy')}>Fails (503: Retry offered)</Button>
        <Button loading={run.isPending} onClick={() => run.mutate('silent')}>Fails and the server says nothing (fallback)</Button>
        <Button loading={run.isPending} onClick={() => { attempts.current = 0; run.mutate('flaky'); }}>Fails once, works on Retry</Button>
        <Button loading={run.isPending} onClick={() => run.mutate('refused')}>Refused (403: no Retry)</Button>
      </Row>
      <p className="text-ds-label text-ds-fg-muted" aria-live="polite">Now: {last}. The confirmation appears only after “ok”; a failure stays until dismissed, with what the server said and, when trying again can help, a Retry that repeats the same call.</p>
    </div>
  );
}

export function OverlaysSection() {
  return (
    <GuideSection id="overlays" title="Overlays and feedback" lead="How the platform asks (dialogs, drawers, the confirm question), tells (toasts) and reports (a mutation that confirms only after the server does). Focus moves in, Tab wraps, Escape closes and focus goes back; typed input is never thrown away without asking.">
      <Spec name="AnimatedModal"><Specimen label="A plain dialog, one that holds typing (dirty), and the width choices"><ModalDemo /></Specimen></Spec>
      <Spec name="RightSlidePanel">
        <Specimen label="A plain drawer, one that holds typing (dirty), and one whose backdrop does nothing; on a phone it fills the screen"><DrawerDemo /></Specimen>
        <Specimen label="Stacked: a drawer that opens a dialog. One Escape closes one layer (the top one), typed input or not"><StackedDemo /></Specimen>
      </Spec>
      <Spec name="DiscardBar"><Specimen label="The bar both overlays show when dirty"><DiscardBarDemo /></Specimen></Spec>
      <Spec name="ConfirmDialog"><Specimen label="useConfirm: a default and a danger question"><ConfirmDemo /></Specimen></Spec>
      <Spec name="useNotify"><Specimen label="Every kind of toast. A success goes by itself after 3 seconds; the others wait, and all of them wait while you read them (pointer over, or focus inside)"><NotifyDemo /></Specimen></Spec>
      <Spec name="useReportedMutation">
        <Specimen label="Simulated success, failure and retry (no request is sent)"><MutationDemo /></Specimen>
        <p className="text-ds-label text-ds-fg-muted">Toasts appear at the top right: <code className={MONO}>role=&quot;alert&quot;</code> for an error, <code className={MONO}>role=&quot;status&quot;</code> for the rest.</p>
      </Spec>
    </GuideSection>
  );
}
