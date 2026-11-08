'use client';

/**
 * The two forms of the Audit packages tab, as sheets of the kit (focus in and back, Escape, "Discard changes?" when something is typed): New package (name, description, framework,
 * period) and Add evidence (the approved files, found by the server for the words typed, ticked, added in one go). Both keep what was typed when the server refuses, and say why.
 */
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button, Checkbox, Combobox, EmptyState, ErrorState, FormField, Sheet, SkeletonRows, TextInput, Textarea } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { typeLabel } from '../_workspace/evidenceModel';
import { NAME_MAX, EMPTY_FORM, problems, type CreateForm } from './packagesModel';
import { useApprovedFiles, useFrameworks, usePackage } from './packagesActions';

const MUTED = 'text-ds-fg-muted';

export function CreatePackageSheet({ open, onClose, onCreate, busy }: { open: boolean; onClose: () => void; onCreate: (form: CreateForm) => void; busy: boolean }) {
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [tried, setTried] = useState(false);
  const frameworks = useFrameworks(open);
  const bad = problems(form);
  const set = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM);
  const close = () => { setForm(EMPTY_FORM); setTried(false); onClose(); };
  return (
    <Sheet
      open={open}
      onClose={close}
      dirty={dirty}
      title="New audit package"
      subtitle="A package starts as a draft. Add files, then finalize and export it."
      width="md"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" form="audit-package-form" variant="primary" loading={busy}>Create package</Button>
        </div>
      )}
    >
      <form
        id="audit-package-form"
        className="flex flex-col gap-[16px]"
        onSubmit={(e) => { e.preventDefault(); setTried(true); if (Object.keys(bad).length === 0) { onCreate(form); } }}
      >
        <FormField label="Name" required error={tried ? bad.name : undefined}>
          <TextInput value={form.name} maxLength={NAME_MAX} onChange={(e) => set({ name: e.target.value })} placeholder="For example: FY26 audit evidence" />
        </FormField>
        <FormField label="Description" optional>
          <Textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What this package is for" />
        </FormField>
        <FormField label="Framework" optional hint={frameworks.isError ? 'The frameworks could not be loaded. You can still create the package.' : undefined}>
          <Combobox
            label="Framework" placeholder="No framework" searchPlaceholder="Search frameworks" clearable value={form.framework_id || null} onChange={(v) => set({ framework_id: v ?? '' })}
            options={(frameworks.data ?? []).map((f) => ({ value: String(f.id), label: f.name }))}
          />
        </FormField>
        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <FormField label="Audit period starts" optional><TextInput type="date" value={form.audit_period_start} onChange={(e) => set({ audit_period_start: e.target.value })} /></FormField>
          <FormField label="Audit period ends" optional error={tried ? bad.period : undefined}><TextInput type="date" value={form.audit_period_end} onChange={(e) => set({ audit_period_end: e.target.value })} /></FormField>
        </div>
      </form>
    </Sheet>
  );
}

export function AddEvidenceSheet({ open, onClose, packageId, onAdd, busy, packageName }: {
  open: boolean;
  onClose: () => void;
  /** the package the files go into (the files already in it are not offered again) */
  packageId: number;
  onAdd: (ids: number[]) => void;
  busy: boolean;
  packageName: string;
}) {
  const [search, setSearch] = useState('');
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const q = useApprovedFiles(search.trim(), open);
  const detail = usePackage(open ? packageId : null);
  const have = new Set((detail.data?.evidence_items ?? []).map((i) => i.evidence_id));
  const files = (q.data?.items ?? []).filter((e) => !have.has(e.id));
  const toggle = (id: number) => setTicked((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const close = () => { setTicked(new Set()); setSearch(''); onClose(); };
  return (
    <Sheet
      open={open}
      onClose={close}
      dirty={ticked.size > 0}
      title="Add evidence"
      subtitle={`Approved files for “${packageName}”`}
      width="md"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={ticked.size === 0} loading={busy} onClick={() => onAdd(Array.from(ticked))}>
            {ticked.size === 0 ? 'Add files' : `Add ${formatCount(ticked.size)} ${ticked.size === 1 ? 'file' : 'files'}`}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px]">
        <TextInput type="search" aria-label="Search approved files" placeholder="Search by name, file or source" maxLength={100} leftAdornment={<Search aria-hidden />} value={search} onChange={(e) => setSearch(e.target.value)} />
        {q.isLoading ? <SkeletonRows rows={6} columns={2} label="Loading the approved files" /> : q.isError && !q.data ? (
          <ErrorState compact title="Couldn't load the files" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
        ) : files.length === 0 ? (
          <EmptyState bare kind="noMatches" title={search ? 'No approved file matches' : 'No approved file to add'} description={search ? 'Try other words.' : 'Every approved file is already in this package, or none is approved yet.'} />
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
              {files.map((e) => (
                <li key={e.id}>
                  <label className="flex min-h-ds-control cursor-pointer items-start gap-[10px] rounded-ds-control px-[8px] py-[6px] hover:bg-ds-surface-hover">
                    <Checkbox aria-label={e.name} checked={ticked.has(e.id)} onChange={() => toggle(e.id)} />
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{e.name}</span>
                      <span className={`block truncate text-ds-label ${MUTED}`}>{[typeLabel(e.evidence_type), e.file_name].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {(q.data?.total ?? 0) > (q.data?.items.length ?? 0) && (
              <p role="status" className={`text-ds-label ${MUTED}`}>{`Showing ${formatCount(q.data?.items.length)} of ${formatCount(q.data?.total)} approved files. Search to find the others.`}</p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
