'use client';

// "Related records" of the Create issue drawer: one disclosure per kind of record (vulnerabilities, risks, tasks, projects, assets, controls, documents, statements, evidence, vendors), each
// holding a searchable multi-select that reads its list the first time the disclosure is opened and says so when the list could not be read (with Retry). The number chosen is on the
// disclosure's header, closed or open. What is chosen goes to the server as `linked_*_ids`, written with the issue (and never twice with the record it was raised from).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Disclosure, ErrorState, MultiSelect } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { LINK_FAMILIES, type LinkKey, type LinkPicks } from './embedModel';
import { LINK_LOADERS } from './linkLoaders';

function Family({ familyKey, label, value, onChange }: { familyKey: LinkKey; label: string; value: string[]; onChange: (next: string[]) => void }) {
  const [touched, setTouched] = useState(false);                          // read the list once the disclosure has been opened, not before
  const list = useQuery({ queryKey: ['issue-embed-pick', familyKey], queryFn: LINK_LOADERS[familyKey], enabled: touched, staleTime: 60_000, retry: 1 });
  return (
    <Disclosure label={label} count={value.length} countLabel="chosen" level={4} onOpenChange={(open) => { if (open) setTouched(true); }}>
      <div className="px-[8px] pb-[8px] pt-[4px]">
        {list.isError ? (
          <ErrorState compact title={`Couldn't load the ${label.toLowerCase()}`} message={errorMessage(list.error)} onRetry={() => { void list.refetch(); }} />
        ) : (
          <MultiSelect
            label={label}
            options={list.data ?? []}
            value={value}
            onChange={onChange}
            placeholder={list.isLoading ? 'Loading…' : `Link ${label.toLowerCase()}`}
            disabled={list.isLoading}
            emptyText={list.data && list.data.length === 0 ? `No ${label.toLowerCase()} to link` : undefined}
          />
        )}
      </div>
    </Disclosure>
  );
}

export function LinkPickers({ value, onChange }: { value: LinkPicks; onChange: (key: LinkKey, next: string[]) => void }) {
  return (
    <div className="rounded-ds-card border border-ds-border">
      {LINK_FAMILIES.map((f) => (
        <Family key={f.key} familyKey={f.key} label={f.label} value={value[f.key]} onChange={(next) => onChange(f.key, next)} />
      ))}
    </div>
  );
}
