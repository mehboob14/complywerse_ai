'use client';

// The head of the journey page: the framework's name, where the journey stands, ONE set of numbers (Ready, Implemented, Need you, Target) and the
// page's actions. The numbers are lib/journeyModel.ts; a number that has no answer says so instead of showing 0.
import { useState } from 'react';
import { CalendarDays, Camera, FileDown } from 'lucide-react';
import { Button, StatTile, StatusPill, TextInput, FormField } from '@/components/ui/ds';
import { PageHeader } from '@/components/ui';
import { formatCount, formatDate, formatPercent, formatRelative } from '@/lib/format';
import { readinessBand, targetState, type JourneyNumbers } from '@/lib/journeyModel';
import { journeyStatus, readinessBandWords } from '@/lib/statuses/frameworkJourney';
import { useCaptureSnapshot, useGenerateReport, useUpdateTargetDate } from './useJourneyActions';

const stripCertificationPostfix = (value?: string): string => (value ? value.replace(/\s+certification\s*$/i, '').trim() : '');

interface Props {
  journeyId: number;
  journey: { name: string; status?: string; target_date?: string | null; started_at?: string | null };
  numbers: JourneyNumbers | null;
  /** how many things wait for the person; null while it is not known (loading, or a request failed) */
  waitingTotal: number | null;
  isCertification: boolean;
}

export default function JourneyHeader({ journeyId, journey, numbers, waitingTotal, isCertification }: Props) {
  const report = useGenerateReport(journeyId);
  const snapshot = useCaptureSnapshot(journeyId);
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState('');
  const save = useUpdateTargetDate(journeyId, () => setEditing(false));

  const target = targetState(journey.target_date, journey.status);
  const band = numbers ? readinessBand(numbers.readyPct) : null;
  const unavailable = { title: "The figures aren't available", message: 'The journey loaded but its figures did not. Reload the page to try again.' };

  return (
    <div className="space-y-[16px]">
      <PageHeader
        variant="page"
        title={stripCertificationPostfix(journey.name)}
        back={{ href: '/frameworks', label: 'Back to frameworks' }}
        chips={(
          <>
            <StatusPill tone={journeyStatus.tone(journey.status)} label={journeyStatus.label(journey.status)} />
            <StatusPill tone="neutral" label={isCertification ? 'Certification journey' : 'Compliance journey'} />
          </>
        )}
        actions={(
          <>
            <Button leftIcon={<FileDown aria-hidden />} loading={report.isPending} onClick={() => report.mutate()}>Generate report</Button>
            <Button leftIcon={<Camera aria-hidden />} loading={snapshot.isPending} onClick={() => snapshot.mutate()}>Capture snapshot</Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
        <StatTile
          label="Ready"
          value={numbers ? formatPercent(numbers.readyPct) : null}
          info="Share of the requirements in scope whose approved evidence reaches what the requirement asks for. A file nobody has approved does not count."
          note={numbers ? `${formatCount(numbers.approved)} of ${formatCount(numbers.applicable)} requirements` : undefined}
          progress={numbers ? numbers.readyPct : null}
          error={numbers ? null : unavailable}
        >
          {band && <StatusPill tone={readinessBandWords.tone(band)} label={readinessBandWords.label(band)} className="mt-[8px]" />}
        </StatTile>
        <StatTile
          label="Implemented"
          value={numbers ? formatPercent(numbers.implementedPct) : null}
          info="Share of the requirements in scope marked implemented or verified. A verified requirement is counted once."
          note={numbers ? `${formatCount(numbers.implemented)} of ${formatCount(numbers.applicable)} requirements` : undefined}
          progress={numbers ? numbers.implementedPct : null}
          error={numbers ? null : unavailable}
        />
        <StatTile
          label="Need you"
          value={waitingTotal === null ? null : formatCount(waitingTotal)}
          tone={waitingTotal ? 'warning' : 'default'}
          info={waitingTotal === null ? 'Your requirements, evidence to review and scope decisions are still loading, or could not be loaded.' : 'Your open requirements, plus the evidence and scope decisions waiting for a reviewer.'}
          note={waitingTotal === null ? undefined : waitingTotal === 0 ? 'Nothing is waiting for you' : 'Requirements, evidence, decisions'}
        />
        <StatTile
          label="Target date"
          value={target.day ? formatDate(target.day, { calendar: true }) : 'Not set'}
          tone={target.state === 'overdue' ? 'danger' : target.state === 'soon' ? 'warning' : 'default'}
          note={target.day ? (target.state === 'done' ? 'Journey completed' : formatRelative(target.day, new Date(), { calendar: true })) : 'No date has been chosen'}
        >
          {editing ? (
            <form
              className="mt-[8px] space-y-[8px]"
              onSubmit={(e) => { e.preventDefault(); if (day) save.mutate(day); }}
            >
              <FormField label="New target date">
                <TextInput type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </FormField>
              <div className="flex gap-[8px]">
                <Button type="submit" variant="primary" size="sm" loading={save.isPending} disabled={!day}>Save</Button>
                <Button type="button" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <Button
              size="sm"
              className="mt-[8px] self-start"
              leftIcon={<CalendarDays aria-hidden />}
              onClick={() => { setDay(target.day ?? ''); setEditing(true); }}
            >
              {target.day ? 'Change date' : 'Set a date'}
            </Button>
          )}
        </StatTile>
      </div>
    </div>
  );
}
