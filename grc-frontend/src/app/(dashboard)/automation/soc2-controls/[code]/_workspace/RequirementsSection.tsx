'use client';

// Links > Requirements: what each framework requires of this control, framework by framework. A control can discharge obligations in 20 frameworks, so each group folds. The text is as the
// library holds it. A mapping made across a granularity difference (a parent or child code) is marked as inferred, because it is sound for finding the control and not yet defensible in an audit;
// a mapping authored by the organisation is marked as authored, not as SCF's. A control the organisation wrote can say which SCF controls it implements, and inherits their requirements.
import { useEffect, useState } from 'react';
import { AccordionRow, Button, ClampedText, EmptyState, Notice, StatusPill } from '@/components/ui/ds';
import { ScfControlPicker } from '@/components/soc2/ScfControlPicker';
import { frameworkColor } from '@/components/soc2/ui';
import { scfApi } from '@/lib/api';
import { useReportedMutation } from '@/components/ui/ds';
import { Small } from './parts';
import type { ReqGroup } from './types';
import { byCode } from './workspaceModel';
import { useWorkspace } from './workspaceContext';

function Group({ g }: { g: ReqGroup }) {
  const [more, setMore] = useState(false);
  const items = [...g.items].sort((a, b) => byCode(a.code, b.code));
  const shown = more ? items : items.slice(0, 10);
  const pct = g.confidence != null ? Math.round(g.confidence * 100) : null;
  return (
    <AccordionRow
      title={g.label}
      lead={<span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ backgroundColor: frameworkColor(g.framework) }} />}
      meta={[g.version, g.provenance === 'ai' ? `Authored mapping${pct != null ? ` · ${pct}%` : ''}` : 'SCF crosswalk', g.unresolved > 0 ? `${g.unresolved} without text` : null].filter(Boolean).join(' · ')}
      trailing={<span className="flex items-center gap-[6px]">{g.inferred_count > 0 && <StatusPill size="sm" tone="warning" label={g.inferred_count === g.count ? 'All inferred' : `${g.inferred_count} inferred`} />}<StatusPill size="sm" tone="neutral" label={String(g.count)} /></span>}
      defaultOpen={false}
      region={false}
    >
      <ul className="divide-y divide-ds-border border-t border-ds-border">
        {shown.map((it) => (
          <li key={it.code} className="grid grid-cols-1 gap-x-[16px] gap-y-[4px] px-[12px] py-[10px] sm:grid-cols-[120px_minmax(0,1fr)]">
            <div className="min-w-0">
              <span className="inline-flex rounded-ds-control bg-ds-primary-soft px-[6px] py-[1px] font-mono text-ds-label font-[600] text-ds-primary-text [overflow-wrap:anywhere]">{it.code}</span>
              {it.reference && it.reference !== it.code && <p className="mt-[2px] font-mono text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]" title="The framework’s own reference">{it.reference}</p>}
              {it.match_mode && it.match_mode !== 'exact' && <div className="mt-[4px]" title={it.match_mode === 'parent' ? 'Our code is broader than the source’s, so it inherits every mapping on the source’s sub-codes. It over-attributes.' : 'Our code is narrower than the source’s, so it inherits its parent’s controls. Some may address sibling sub-requirements.'}><StatusPill size="sm" tone="warning" label={it.match_mode === 'parent' ? 'Parent match' : 'Child match'} /></div>}
            </div>
            <div className="min-w-0">
              {it.title && <p className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{it.title}</p>}
              {it.text ? <ClampedText text={it.text} lines={3} className="mt-[2px]" /> : <Small className="mt-[2px] italic">{`No requirement text for this code in the ${g.label} library.`}</Small>}
              {it.domain && <Small className="mt-[2px]">{it.domain}</Small>}
            </div>
          </li>
        ))}
        {!more && items.length > 10 && <li className="px-[12px] py-[6px]"><Button variant="link" size="sm" className="-ml-[8px]" onClick={() => setMore(true)}>{`Show ${items.length - 10} more`}</Button></li>}
      </ul>
    </AccordionRow>
  );
}

function EditMappings() {
  const { code, d, rights, why, refresh } = useWorkspace();
  const initial = d.implements_scf_ids ?? [];
  const [ids, setIds] = useState<string[]>(initial);
  const key = initial.join(',');
  useEffect(() => { setIds(initial); }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const save = useReportedMutation({
    mutationFn: () => scfApi.updateCustomControlMappings(code, { implements_scf_ids: ids }),
    success: { title: 'Mappings saved', message: 'The requirements, maturity criteria and documents of those controls now apply here.' }, failure: "Couldn't save the mappings", onSuccess: () => { void refresh(); },
  });
  return (
    <section aria-label="The SCF controls this one implements" className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      <p className="text-ds-body font-[600] text-ds-fg">SCF controls this control implements</p>
      <Small className="mb-[8px]">This control then discharges those controls’ framework requirements, and inherits their maturity criteria and documents.</Small>
      <ScfControlPicker value={ids} onChange={setIds} />
      <div className="mt-[8px]"><Button variant="primary" loading={save.isPending} disabled={!rights.libraryEdit || ids.join(',') === key} title={why('libraryEdit')} onClick={() => save.mutate()}>Save the mappings</Button></div>
    </section>
  );
}

export function RequirementsSection() {
  const { d, isCustom } = useWorkspace();
  const groups = d.requirement_groups ?? [];
  const scope = d.scope_frameworks ?? [];
  const names = scope.map((f) => f.label).join(', ');
  return (
    <div className="flex flex-col gap-[12px]">
      {isCustom && <EditMappings />}
      {groups.length === 0 ? (
        <EmptyState kind="firstUse" bare title="No requirement maps to this control" description={isCustom ? 'Say which SCF controls it implements above, or map it to framework controls directly.' : scope.length ? `None of your in-scope frameworks (${names}) require this control.` : 'No framework requirement maps to this control.'} />
      ) : (
        <>
          <Small>{`${d.requirement_count} ${d.requirement_count === 1 ? 'requirement' : 'requirements'} across ${d.framework_count} ${scope.length ? 'in-scope ' : ''}${d.framework_count === 1 ? 'framework' : 'frameworks'}, crosswalked through SCF ${d.release}.`}</Small>
          {!scope.length && d.framework_count > 10 && <Notice tone="info">{`This control appears in ${d.framework_count} frameworks because many of them restate the same obligation. A high count is crosswalk breadth, not extra assurance. Choose your frameworks under Configure scope to see only the ones you are assessed against.`}</Notice>}
          <div className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">{groups.map((g) => <div key={g.framework}><Group g={g} /></div>)}</div>
        </>
      )}
    </div>
  );
}
