'use client';

// The pieces of a settings page: SectionCard, SaveBar (every state it can be in, and a form that really saves, in a box it sticks inside),
// SegmentedControl and ReadOnlyNote. Everything is simulated: no request leaves the page.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button, Checkbox, FormField, InfoTip, ReadOnlyNote, SaveBar, SectionCard, SegmentedControl, TextInput, type SegmentedOption } from '@/components/ui';
import { Grid, GuideSection, Row, Spec, Specimen } from './Guide';

const nothing = () => undefined;
const BODY = 'text-ds-body text-ds-fg-body';

function ViewOnly() {
  return <ReadOnlyNote>View only <InfoTip text="Only an administrator can change these settings." label="Why these settings are view only" /></ReadOnlyNote>;
}

function CardsDemo() {
  return (
    <Grid cols={2}>
      <Specimen label="Everything: title, (i), facts, actions, content. The card is a region named by its title; #guide-card-full points at it">
        <SectionCard
          id="guide-card-full"
          title="Departments"
          info="The groups that own documents. A department is never deleted: it is deactivated."
          meta="6 departments · 1 inactive"
          actions={<Button variant="primary" size="sm" leftIcon={<Plus />}>Add department</Button>}
        >
          <p className={BODY}>The content: fields, a table, anything at all.</p>
        </SectionCard>
      </Specimen>
      <Specimen label="Just a title and its content">
        <SectionCard id="guide-card-min" title="Escalation"><p className={BODY}>When a request is late, the person asked is told on the day it becomes overdue.</p></SectionCard>
      </Specimen>
      <Specimen label="A long title and two actions wrap under each other on a narrow screen">
        <SectionCard
          id="guide-card-long"
          title="Reminders sent to the people asked to review, approve or acknowledge a document"
          actions={<><Button size="sm">Preview</Button><Button variant="primary" size="sm">Add reminder</Button></>}
        >
          <p className={BODY}>The title breaks at a word; the actions keep their size.</p>
        </SectionCard>
      </Specimen>
      <Specimen label="Read only: a ReadOnlyNote where the actions were">
        <SectionCard id="guide-card-readonly" title="Approvals" actions={<ViewOnly />}><p className={BODY}>The fields below are read-only and there is no save bar.</p></SectionCard>
      </Specimen>
    </Grid>
  );
}

// ── SaveBar ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BASE = { canEdit: true, dirty: false, invalid: false, saving: false, justSaved: false, error: null as string | null };

/** The bar sticks to the bottom of the nearest scrolling box; a box of its own here keeps it from sticking to the whole page. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-bg p-[12px]">{children}</div>;
}

const STATES: Array<{ key: string; label: string; input: Partial<typeof BASE> }> = [
  { key: 'unsaved', label: 'dirty: "Unsaved changes", with Discard and Save', input: { dirty: true } },
  { key: 'invalid', label: 'dirty and invalid: "Fix the fields in red to save"; Save is not offered until then', input: { dirty: true, invalid: true } },
  { key: 'saving', label: 'saving: Save shows its spinner and keeps focus; Discard is off', input: { dirty: true, saving: true } },
  { key: 'refused', label: 'error: what the server refused with; it outranks every other line', input: { dirty: true, error: 'The reminder days must be between 1 and 30.' } },
  { key: 'saved', label: 'justSaved and nothing left unsaved: "Saved", no buttons; focus moves to the line', input: { justSaved: true } },
];

function LiveSave() {
  const [saved, setSaved] = useState('3');
  const [value, setValue] = useState('3');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const dirty = value !== saved;
  const days = Number(value);
  const invalid = value.trim() === '' || !Number.isFinite(days) || days < 1 || days > 30;
  const change = (next: string) => { setValue(next); setError(null); setJustSaved(false); };
  const save = () => {
    setSaving(true);
    setError(null);
    timers.current.push(setTimeout(() => {
      setSaving(false);
      if (failNext) { setFailNext(false); setError('The server refused the change: the reminder is locked while a review is open.'); return; }
      setSaved(value);
      setJustSaved(true);
      timers.current.push(setTimeout(() => setJustSaved(false), 3000));
    }, 700));
  };

  return (
    <div className="space-y-[8px]">
      <Row gap={16}>
        <Checkbox label="View only" checked={viewOnly} onChange={(e) => setViewOnly(e.target.checked)} />
        <Checkbox label="The next save is refused" checked={failNext} onChange={(e) => setFailNext(e.target.checked)} />
      </Row>
      <div className="max-h-[300px] overflow-auto rounded-ds-card border border-ds-border bg-ds-bg p-[12px]">
        <div className="space-y-[12px]">
          <SectionCard id="guide-live-save" title="Reminders" info="How many days after a request the person is reminded.">
            <FormField label="Remind after" hint="Between 1 and 30 days." error={dirty && invalid ? 'Enter a number from 1 to 30.' : undefined}>
              <TextInput type="number" unit="days" value={value} readOnly={viewOnly} onChange={(e) => change(e.target.value)} className="w-[160px]" />
            </FormField>
          </SectionCard>
          <SectionCard id="guide-live-more" title="More settings below">
            <p className={BODY}>Scroll this box: the save bar stays at the bottom of it while there is something to say. Change the number above and it appears.</p>
            <p className={`mt-2 ${BODY}`}>It disappears again when the form is clean, a few seconds after a save, and for a view-only person it is never drawn.</p>
            <p className={`mt-2 ${BODY}`}>Discard puts the saved value back; Save sends it and says what happened.</p>
          </SectionCard>
        </div>
        <SaveBar label="Save the reminder" canEdit={!viewOnly} dirty={dirty} invalid={invalid} saving={saving} justSaved={justSaved} error={error} onSave={save} onDiscard={() => change(saved)} />
      </div>
    </div>
  );
}

function SaveBarDemo() {
  return (
    <div className="space-y-[16px]">
      <Specimen label="A form that really saves (simulated, 0.7 s): change the number, make it invalid, save, let the server refuse, switch to view only">
        <LiveSave />
      </Specimen>
      <Grid cols={2}>
        {STATES.map((s) => (
          <Specimen key={s.key} label={s.label}>
            <Frame><SaveBar label={`Save bar: ${s.key}`} onSave={nothing} onDiscard={nothing} {...BASE} {...s.input} /></Frame>
          </Specimen>
        ))}
        <Specimen label="canEdit false (a view-only person), or nothing to say: nothing is drawn">
          <Frame><SaveBar label="Save bar: hidden" onSave={nothing} onDiscard={nothing} {...BASE} canEdit={false} dirty /><p className="text-ds-label text-ds-fg-muted">(nothing here)</p></Frame>
        </Specimen>
      </Grid>
    </div>
  );
}

// ── SegmentedControl ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CHANNELS: SegmentedOption[] = [
  { value: 'in_app', label: 'In-app' },
  { value: 'email', label: 'Email' },
  { value: 'both', label: 'Both' },
  { value: 'off', label: 'Off', quiet: true },
];

function Segments({ name, label, start, disabled = false }: { name: string; label: string; start: string; disabled?: boolean }) {
  const [value, setValue] = useState(start);
  return (
    <div className="space-y-[6px]">
      <SegmentedControl label={label} name={name} options={CHANNELS} value={value} onChange={setValue} disabled={disabled} />
      <p className="text-ds-label text-ds-fg-muted" aria-live="polite">Chosen: {value}</p>
    </div>
  );
}

function SegmentsDemo() {
  return (
    <Grid cols={2}>
      <Specimen label="Press a segment, or Tab in and use the arrow keys (one tab stop for the whole group)"><Segments name="guide-seg-a" label="Reminder: where it goes" start="email" /></Specimen>
      <Specimen label="quiet: the choice that means nothing reads grey when chosen"><Segments name="guide-seg-b" label="Overdue alert: where it goes" start="off" /></Specimen>
      <Specimen label="disabled: a view-only page still shows the chosen value, readable"><Segments name="guide-seg-c" label="Escalation: where it goes" start="both" disabled /></Specimen>
      <Specimen label="In a narrow box the segments wrap onto more lines"><div className="w-[200px] max-w-full"><Segments name="guide-seg-d" label="Digest: where it goes" start="in_app" /></div></Specimen>
    </Grid>
  );
}

function NoteDemo() {
  return (
    <Grid cols={2}>
      <Specimen label="The words alone"><ReadOnlyNote>View only</ReadOnlyNote></Specimen>
      <Specimen label="With an (i) that says who can change it"><ViewOnly /></Specimen>
      <Specimen label="Long words wrap beside the lock"><div className="w-[220px] max-w-full"><ReadOnlyNote>View only: these settings belong to the organisation and are changed by an administrator</ReadOnlyNote></div></Specimen>
    </Grid>
  );
}

export function SettingsSection() {
  return (
    <GuideSection id="settings" title="Settings pages" lead="What a settings page is built from: cards that are regions with their own anchor and actions, a save bar that says one thing at a time, a segmented choice and a read-only note.">
      <Spec name="SectionCard"><CardsDemo /></Spec>
      <Spec name="SaveBar"><SaveBarDemo /></Spec>
      <Spec name="SegmentedControl"><SegmentsDemo /></Spec>
      <Spec name="ReadOnlyNote"><NoteDemo /></Spec>
    </GuideSection>
  );
}
