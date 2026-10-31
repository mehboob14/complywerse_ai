'use client';

// StatusPill with every tone and every word of every registry in lib/status.ts; Avatar, PersonChip and PersonStack in their sizes and edge cases.
import * as statusModule from '@/lib/status';
import { TONE, statusPill, type Statuses, type Tone } from '@/lib/status';
import { contrast } from '@/lib/contrast';
import { Avatar, PersonChip, PersonStack, StatusPill } from '@/components/ui';
import { formatRatio } from './tokens';
import { Grid, GuideSection, MONO, Row, Spec, Specimen, SubHeading } from './Guide';

const isStatuses = (v: unknown): v is Statuses => typeof v === 'object' && v !== null && 'record' in v && 'words' in v && typeof (v as Statuses).tone === 'function';
/** Every registry the module exports, so a registry added to lib/status.ts shows here by itself. */
const REGISTRIES: Statuses[] = Object.keys(statusModule).map((k) => (statusModule as Record<string, unknown>)[k]).filter(isStatuses);

const TONE_MEANING: Record<Tone, string> = {
  success: 'In force or done',
  danger: 'Refused, overdue or lapsed',
  warning: 'Needs a look',
  progress: 'Moving, or ready for its next step',
  pending: 'Waiting for someone',
  neutral: 'At rest; also any word nobody registered',
};

export function StatusSection() {
  const tones = Object.keys(TONE) as Tone[];
  return (
    <GuideSection id="status" title="Status" lead="A status is a dot and a word on a soft tint; the colour only backs the word up. Tones and words come from the registries in lib/status.ts, one per record type.">
      <Spec name="StatusPill">
        <Specimen label="The six tones, medium and small, with the ratio of the word on its tint (4.5:1 needed)">
          <div className="space-y-[8px]">
            {tones.map((tone) => {
              const c = TONE[tone];
              const ratio = contrast(c.text, c.tint);
              return (
                <div key={tone} className="flex flex-wrap items-center gap-[12px]">
                  <code className={`${MONO} w-[80px] shrink-0 text-ds-fg-muted`}>{tone}</code>
                  <StatusPill tone={tone} label={tone[0].toUpperCase() + tone.slice(1)} />
                  <StatusPill tone={tone} label={tone[0].toUpperCase() + tone.slice(1)} size="sm" />
                  <span className="text-ds-label tabular-nums text-ds-fg-muted">{formatRatio(ratio)}</span>
                  <StatusPill tone={ratio >= 4.5 ? 'success' : 'danger'} label={ratio >= 4.5 ? 'Pass' : 'Fail'} size="sm" />
                  <span className="text-ds-label text-ds-fg-muted">{TONE_MEANING[tone]}</span>
                </div>
              );
            })}
          </div>
        </Specimen>
        <Row gap={16} align="start">
          <Specimen label="A word nobody registered reads neutral, with a readable label"><StatusPill {...statusPill(REGISTRIES[0], 'something_new')} /></Specimen>
          <Specimen label="A blank label is drawn as the dash, never a dot alone"><StatusPill tone="warning" label="" /></Specimen>
          <Specimen label="A long label is cut and keeps its text in a tooltip" className="w-[180px]"><StatusPill tone="pending" label="Waiting for the second approver in the chain" /></Specimen>
        </Row>
      </Spec>

      <div className="space-y-[12px]" data-guide-component="Status registries">
        <SubHeading>Registries</SubHeading>
        <Grid cols={2}>
          {REGISTRIES.map((reg) => (
            <div key={reg.record} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
              <p className="mb-[8px] text-ds-body font-medium text-ds-fg"><code className={MONO}>{reg.record}</code> <span className="font-normal text-ds-fg-muted">· {reg.words.length} words</span></p>
              <Row>
                {reg.words.map((word) => <StatusPill key={word} {...statusPill(reg, word)} />)}
              </Row>
            </div>
          ))}
        </Grid>
      </div>
    </GuideSection>
  );
}

const NAMES = [
  { label: 'Two words', name: 'Dana Okafor' },
  { label: 'Three words: first and last', name: 'Ali bin Zayed' },
  { label: 'One word', name: 'Madonna' },
  { label: 'Arabic', name: 'محمد أحمد' },
  { label: 'Emoji', name: '🙂 Smiley Face' },
  { label: 'Emoji with a skin tone and a joiner', name: '👩🏽‍💻 Dev Person' },
  { label: 'No name: a quiet “?”', name: '' },
];

const LONG_NAME = 'Maximilian Alexander Featherstonehaugh-Worthington III';

export function PeopleSection() {
  return (
    <GuideSection id="people" title="People" lead="A person has the same initials and colour on every page; a missing owner reads “Unassigned”, because it is information.">
      <Spec name="Avatar">
        <div className="space-y-[8px]">
          {NAMES.map((n) => (
            <div key={n.label} className="flex flex-wrap items-center gap-[12px]">
              <span className="w-[230px] shrink-0 text-ds-label text-ds-fg-muted">{n.label}</span>
              <Avatar name={n.name} size={20} />
              <Avatar name={n.name} size={24} />
              <Avatar name={n.name} size={32} />
              <span className="text-ds-label text-ds-fg-muted">20, 24 and 32 px</span>
            </div>
          ))}
        </div>
      </Spec>

      <Spec name="PersonChip">
        <Grid>
          <Specimen label="Name and avatar"><PersonChip name="Dana Okafor" /></Specimen>
          <Specimen label="Sizes 20 and 32"><Row><PersonChip name="Sam Rivera" size={20} /><PersonChip name="Sam Rivera" size={32} /></Row></Specimen>
          <Specimen label="Arabic"><PersonChip name="محمد أحمد" /></Specimen>
          <Specimen label="A long name is cut; the full name is in a tooltip" className="w-[190px]"><PersonChip name={LONG_NAME} /></Specimen>
          <Specimen label="No person: Unassigned"><PersonChip name={null} /></Specimen>
          <Specimen label="No person, own words"><PersonChip name="" emptyLabel="Nobody yet" /></Specimen>
        </Grid>
      </Spec>

      <Spec name="PersonStack">
        <Grid>
          <Specimen label="Nobody"><PersonStack people={[]} /></Specimen>
          <Specimen label="One"><PersonStack people={['Dana Okafor']} label="Owner" /></Specimen>
          <Specimen label="Three: all show"><PersonStack people={['Dana Okafor', 'Sam Rivera', 'Lena Petrova']} label="Reviewers" /></Specimen>
          <Specimen label="Five: +2 opens the rest (press it)"><PersonStack people={['Dana Okafor', 'Sam Rivera', 'Lena Petrova', 'Omar Haddad', 'Priya Nair']} label="Approvers" /></Specimen>
          <Specimen label="Twelve at 32 px: +9"><PersonStack size={32} label="Attendees" people={['Dana Okafor', 'Sam Rivera', 'Lena Petrova', 'Omar Haddad', 'Priya Nair', 'Mateo Silva', 'Aiko Tanaka', 'Noor Karim', 'Ines Duarte', 'Felix Weber', 'Zara Ahmed', 'Luca Romano']} /></Specimen>
          <Specimen label="Blank names are left out; max 2"><PersonStack max={2} people={['Dana Okafor', '', null, 'Sam Rivera', undefined, 'Lena Petrova']} /></Specimen>
        </Grid>
      </Spec>
    </GuideSection>
  );
}
