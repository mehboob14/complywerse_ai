'use client';

// EmptyState, ErrorState, Skeleton and NoAccessState in every variant (the States matrix that puts them side by side is StatesMatrix.tsx).
import { useState } from 'react';
import { Mail, Plus } from 'lucide-react';
import { Button, EmptyState, ErrorState, NoAccessState, Skeleton, SkeletonLines, SkeletonRows } from '@/components/ui';
import { Grid, GuideSection, Spec, Specimen } from './Guide';

function Counter({ label, count }: { label: string; count: number }) {
  return <p className="mt-2 text-center text-ds-label text-ds-fg-muted" aria-live="polite">{label}: {count}</p>;
}

function EmptyDemo() {
  const [cleared, setCleared] = useState(0);
  return (
    <Grid cols={2}>
      <Specimen label="firstUse: how to start, with the one action that fills the page">
        <EmptyState kind="firstUse" title="No documents yet" description="Documents you add or upload appear here." action={<Button variant="primary" leftIcon={<Plus />}>Add a document</Button>} />
      </Specimen>
      <Specimen label="noMatches: the filters leave none, so offer to clear them">
        <EmptyState kind="noMatches" title="No documents match" description="Try another search, or clear the filters." onClearFilters={() => setCleared((n) => n + 1)} />
        <Counter label="Clear filters pressed" count={cleared} />
      </Specimen>
      <Specimen label="With up to three tips">
        <EmptyState kind="firstUse" title="No committees yet" description="A committee groups the people who decide together." tips={['Add the members first', 'Then set when it meets', 'Meetings and actions follow']} action={<Button variant="primary">Add a committee</Button>} />
      </Specimen>
      <Specimen label="bare, inside a card that already has a frame; own icon">
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
          <EmptyState bare kind="firstUse" icon={Mail} title="No messages" description="Nothing has been sent to this supplier." />
        </div>
      </Specimen>
    </Grid>
  );
}

function ErrorDemo() {
  const [tries, setTries] = useState(0);
  return (
    <Grid>
      <Specimen label="Framed, with the server's words and Retry">
        <ErrorState title="Couldn't load the documents" message="The server didn't answer in time. Check your connection and try again." onRetry={() => setTries((n) => n + 1)} />
        <Counter label="Retry pressed" count={tries} />
      </Specimen>
      <Specimen label="Framed, no Retry: trying again would not help"><ErrorState title="Couldn't save the change" message="You don't have permission to edit this document." /></Specimen>
      <Specimen label="Compact: a row for the inside of a card">
        <div className="rounded-ds-card border border-ds-border bg-ds-surface"><ErrorState compact title="Couldn't load the activity" message="Try again in a moment." onRetry={() => setTries((n) => n + 1)} /></div>
      </Specimen>
      <Specimen label="Compact in a narrow card (200 px): Retry drops below the words, which stay readable">
        <div className="w-[200px] max-w-full rounded-ds-card border border-ds-border bg-ds-surface"><ErrorState compact title="Couldn't load the activity" message="Try again in a moment." onRetry={() => setTries((n) => n + 1)} /></div>
      </Specimen>
    </Grid>
  );
}

function SkeletonDemo() {
  return (
    <Grid>
      <Specimen label="Skeleton: single blocks, sized with arbitrary values">
        <div className="space-y-2"><Skeleton className="h-[16px] w-[160px]" /><Skeleton className="h-[32px] w-full" /><Skeleton className="h-[64px] w-[64px]" /></div>
      </Specimen>
      <Specimen label="SkeletonLines: three, the last shorter">
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonLines /></div>
      </Specimen>
      <Specimen label="SkeletonLines: one line">
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonLines lines={1} label="Loading the title" /></div>
      </Specimen>
      <Specimen label="SkeletonRows: 4 rows of 4 cells, in widths that differ">
        <div className="rounded-ds-card border border-ds-border bg-ds-surface"><SkeletonRows rows={4} columns={4} /></div>
      </Specimen>
    </Grid>
  );
}

export function StatesSection() {
  return (
    <GuideSection id="states" title="States" lead="Every view has five moments besides having data: loading, empty, failed, not allowed and view-only. Each has one component and one rule.">
      <Spec name="EmptyState"><EmptyDemo /></Spec>
      <Spec name="ErrorState"><ErrorDemo /></Spec>
      <Spec name="Skeleton"><SkeletonDemo /></Spec>
      <Spec name="NoAccessState">
        <Grid>
          <Specimen label="Default words"><NoAccessState /></Specimen>
          <Specimen label="With a reason"><NoAccessState reason="This page is for administrators." /></Specimen>
          <Specimen label="With a reason and a way back"><NoAccessState title="You can't open this committee" reason="Ask an administrator to add you to it." action={<Button href="/governance/committees">Back to committees</Button>} /></Specimen>
        </Grid>
      </Spec>
    </GuideSection>
  );
}
