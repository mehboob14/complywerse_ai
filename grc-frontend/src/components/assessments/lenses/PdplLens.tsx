'use client';

/**
 * The Saudi PDPL toolkit: the requirements lens with the PDPL profile and its own drawer (guidance, the 0 to 5 score, the gap and remediation, evidence and templates), a new control
 * with its PDPL reference, and removing a whole domain. The action plan of the gaps is the second lens tab (PdplPlanLens).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button, FormField, Select, SidePanel, Textarea, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import type { LensProps } from '../workspace/lens';
import { workspaceApi } from '../workspace/workspaceApi';
import { PdplPanel } from './PdplPanel';
import { PDPL } from './profiles';
import { RequirementsLens } from './RequirementsLens';
import { useLensData } from './useLensData';

/** The domains of the toolkit; a control can also go in one the workbook added. */
export const PDPL_DOMAINS = [
  'Governance & Accountability', 'Lawful Basis & Consent', 'Collection & Purpose Limitation', 'Transparency & Notice', 'Data Subject Rights', 'Disclosure Controls', 'Retention & Destruction',
  'Security', 'Breach Management', 'Cross-Border Transfers', 'Processor / Vendor Mgmt', 'Special Categories', 'Marketing',
];

function AddControl({ assessmentId, domains, onClose, onAdded }: { assessmentId: number; domains: readonly string[]; onClose: () => void; onAdded: () => void }) {
  const [f, setF] = useState({ id: '', ref: '', domain: PDPL_DOMAINS[0], requirement: '' });
  const dirty = f.id !== '' || f.ref !== '' || f.requirement !== '';
  const create = useReportedMutation({
    mutationFn: () => workspaceApi.addItem(assessmentId, {
      item_number: f.id.trim() || undefined, area_domain: f.domain, control_description: f.requirement.trim(), compliance_status: 'in_progress', ...(f.ref.trim() ? { remarks: `PDPL Ref: ${f.ref.trim()}` } : {}),
    } as Parameters<typeof workspaceApi.addItem>[1]),
    success: 'Control added',
    failure: "Couldn't add the control",
    retryable: false,
    onSuccess: () => { onAdded(); onClose(); },
  });
  const all = Array.from(new Set([...PDPL_DOMAINS, ...domains]));
  return (
    <SidePanel open onClose={onClose} title="Add a control" width="md" dockFrom={Infinity} dirty={dirty}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!f.requirement.trim()} onClick={() => create.mutate()}>Add control</Button></div>}>
      <div className="flex flex-col gap-[16px]">
        <FormField label="Requirement" required><Textarea rows={4} value={f.requirement} placeholder="Describe the control requirement" onChange={(e) => setF({ ...f, requirement: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Control ID" optional><TextInput value={f.id} maxLength={50} placeholder="G-08" onChange={(e) => setF({ ...f, id: e.target.value })} /></FormField>
          <FormField label="PDPL reference" optional><TextInput value={f.ref} maxLength={100} placeholder="Art. 30" onChange={(e) => setF({ ...f, ref: e.target.value })} /></FormField>
        </div>
        <FormField label="Domain"><Select value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })}>{all.map((d) => <option key={d} value={d}>{d}</option>)}</Select></FormField>
      </div>
    </SidePanel>
  );
}

export default function PdplLens(props: LensProps) {
  const { assessmentId, readOnly, onChanged } = props;
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { items } = useLensData(assessmentId);
  const [adding, setAdding] = useState(false);
  const removeDomain = useReportedMutation({
    mutationFn: async (ids: number[]) => { for (const id of ids) await workspaceApi.deleteItem(id); },
    success: 'Domain removed',
    failure: "Couldn't remove every control of the domain",
    retryable: false,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['assessment-workspace', assessmentId] }); onChanged(); },
  });
  return (
    <>
      <RequirementsLens
        profile={PDPL} {...props}
        toolbar={!readOnly ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add control</Button> : undefined}
        groupActions={!readOnly ? (g) => (
          <Button size="sm" leftIcon={<Trash2 aria-hidden />} loading={removeDomain.isPending && removeDomain.variables?.[0] === g.items[0]?.id}
            onClick={async () => {
              const yes = await confirm({ title: `Remove “${g.name}”?`, message: `All ${g.items.length} ${g.items.length === 1 ? 'control' : 'controls'} of this domain, their answers and their links to evidence are removed. This cannot be undone.`, confirmLabel: 'Remove domain', tone: 'danger' });
              if (yes) removeDomain.mutate(g.items.map((i) => i.id));
            }}>Remove this domain</Button>
        ) : undefined}
        panel={({ item, prev, next, onOpen, onClose, assessmentName }) => (
          <PdplPanel assessmentId={assessmentId} assessmentName={assessmentName} item={item} prev={prev} next={next} onOpen={onOpen} onClose={onClose} readOnly={readOnly} onChanged={onChanged} />
        )}
      />
      {adding && <AddControl assessmentId={assessmentId} domains={Array.from(new Set(items.map((i) => i.domain)))} onClose={() => setAdding(false)} onAdded={() => { void qc.invalidateQueries({ queryKey: ['assessment-workspace', assessmentId] }); onChanged(); }} />}
      {confirmDialog}
    </>
  );
}
