'use client';

// EmptyState, ErrorState, Skeleton, NoAccessState and Notice in every variant (the States matrix that puts the states side by side is StatesMatrix.tsx).
import { useState } from 'react';
import { Lock, Mail, Plus } from 'lucide-react';
import { Button, EmptyState, ErrorState, NoAccessState, Notice, Skeleton, SkeletonLines, SkeletonRows } from '@/components/ui';
import { Grid, GuideSection, Spec, Specimen } from './Guide';
import { FormErrorDemo } from './SearchDemo';

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
      <Specimen label="info: the explanation sits in an (i) beside the title, for a page that prints labels and not sentences">
        <EmptyState kind="firstUse" title="No departments yet" info="A department groups the people who own documents together. It is deactivated, never deleted." action={<Button variant="primary" leftIcon={<Plus />}>Add a department</Button>} />
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

function NoticeDemo() {
  const [opened, setOpened] = useState(0);
  return (
    <Grid cols={2}>
      <Specimen label="info (the default): a fact about what is below; a polite role=status">
        <Notice title="Updated 5 minutes ago">The register refreshes by itself every ten minutes.</Notice>
      </Specimen>
      <Specimen label="warning: the list is cut; an assertive role=alert">
        <Notice tone="warning" title="Showing 100 of 174 exceptions">Search, sort and the export use these 100 only. Pick a status or priority to narrow the list.</Notice>
      </Specimen>
      <Specimen label="danger, with an action">
        <Notice tone="danger" title="Two reviewers have left the company" action={<Button size="sm" onClick={() => setOpened((n) => n + 1)}>Reassign</Button>}>Their reviews cannot be completed until someone else takes them.</Notice>
        <Counter label="Reassign pressed" count={opened} />
      </Specimen>
      <Specimen label="No title: the line alone">
        <Notice>Only active departments are listed.</Notice>
      </Specimen>
      <Specimen label="A warning on the page from the start: role=&quot;status&quot;, and an icon of its own">
        <Notice tone="warning" role="status" icon={Lock} title="Saving is switched off">An administrator turned it off for this organisation, so the form is view only.</Notice>
      </Specimen>
      <Specimen label="Narrow (240 px): the action drops under the words, which stay readable">
        <div className="w-[240px] max-w-full">
          <Notice tone="warning" title="Showing 100 of 174" action={<Button size="sm">Open them all</Button>}>Search and sort use these 100 only.</Notice>
        </div>
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
      <Spec name="Notice"><NoticeDemo /></Spec>
      <Spec name="FormError"><FormErrorDemo /></Spec>
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
