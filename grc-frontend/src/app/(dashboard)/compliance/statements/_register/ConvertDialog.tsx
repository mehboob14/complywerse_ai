'use client';

// "Convert to controls": the ticked statements of ONE document become internal controls (POST /governance/documents/{id}/statements/convert-to-controls, unchanged). Several documents
// are said in words in the dialog, with the button off (it used to be a browser alert). A failure stays on screen with Retry; a success says what was made and where to find it.
import { useState } from 'react';
import { Shield } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, Notice, Select, useReportedMutation } from '@/components/ui/ds';
import { complianceApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { STATEMENT_REFRESH } from './statementData';
import { documentName, type ConvertPlan, type StatementRow } from './statementModel';

const CATEGORIES: Array<[string, string]> = [
  ['security', 'Security'], ['privacy', 'Privacy'], ['operational', 'Operational'], ['compliance', 'Compliance'], ['governance', 'Governance'], ['risk_management', 'Risk Management'],
  ['hr', 'HR'], ['it', 'IT'], ['financial', 'Financial'], ['legal', 'Legal'], ['environmental', 'Environmental'], ['quality', 'Quality'],
];
const PRIORITIES: Array<[string, string]> = [['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];

export interface ConvertDialogProps {
  open: boolean;
  rows: readonly StatementRow[];
  plan: ConvertPlan;
  onClose: () => void;
  /** the controls were made: the page clears its ticks */
  onDone: () => void;
}

export function ConvertDialog({ open, rows, plan, onClose, onDone }: ConvertDialogProps) {
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const convert = useReportedMutation({
    mutationFn: (v: { documentId: number; ids: number[] }) => complianceApi.statements.convertToControls(v.documentId, { statement_ids: v.ids, category: category || undefined, priority: priority || undefined }),
    success: (res, v) => {
      const made = Array.isArray(res.data) ? res.data.length : v.ids.length;       // the server answers with the controls it made
      return { title: 'Controls created', message: `${formatCount(made)} internal ${made === 1 ? 'control was' : 'controls were'} made from the selected statements. Find ${made === 1 ? 'it' : 'them'} in Controls.` };
    },
    failure: "Couldn't create the controls",
    retryable: false,
    invalidate: STATEMENT_REFRESH.concat([['controls'], ['internal-controls']]).map((k) => [...k]),
    onSuccess: () => { setCategory(''); setPriority(''); onDone(); },
  });
  const doc = rows[0] ? documentName(rows[0]) : '';
  return (
    <AnimatedModal
      isOpen={open}
      onClose={onClose}
      dirty={!!category || !!priority}
      title="Convert to internal controls"
      subtitle={plan.ok ? `${formatCount(plan.count)} ${plan.count === 1 ? 'statement' : 'statements'} from ${doc}` : undefined}
      size="md"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" leftIcon={<Shield aria-hidden />} loading={convert.isPending} disabled={!plan.ok} onClick={() => { if (plan.documentId != null) convert.mutate({ documentId: plan.documentId, ids: rows.map((r) => r.id) }); }}>
            Convert to controls
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px]">
        {plan.ok ? (
          <p className="m-0 text-ds-body text-ds-fg-body">Each selected statement becomes an internal control you can test and keep evidence for. The statements stay as they are.</p>
        ) : (
          <Notice tone="warning" title="Choose statements from one document">{plan.why ?? 'Select at least one statement.'}</Notice>
        )}
        <FormField label="Category" optional>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="No category" disabled={!plan.ok}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
        <FormField label="Priority" optional>
          <Select value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="No priority" disabled={!plan.ok}>
            {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
      </div>
    </AnimatedModal>
  );
}
