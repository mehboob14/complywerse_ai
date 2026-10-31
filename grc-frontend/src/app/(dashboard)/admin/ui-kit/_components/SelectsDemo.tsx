'use client';

// MultiSelect and Combobox in every variant: a short list (no search), a long one (search, descriptions), chips, a filter-bar pill, a clearable single choice,
// an error, disabled, inside a box that clips (the popover is drawn on the window), and inside a dialog (Escape closes the list first, then the dialog).
import { useState } from 'react';
import { AnimatedModal, Button, Combobox, FormField, MultiSelect, type ListOption } from '@/components/ui';
import { Grid, MONO, Row, Specimen } from './Guide';

const STATUSES: ListOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_review', label: 'In review' },
  { value: 'pending_approval', label: 'In approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'expired', label: 'Expired', disabled: true },
  { value: 'archived', label: 'Archived' },
];

const FRAMEWORKS: ListOption[] = [
  ['iso27001', 'ISO/IEC 27001:2022', 'Information security management'],
  ['iso27002', 'ISO/IEC 27002:2022', 'Information security controls'],
  ['iso22301', 'ISO 22301:2019', 'Business continuity management'],
  ['soc2', 'SOC 2', 'Trust services criteria'],
  ['pci', 'PCI DSS v4.0', 'Payment card data security'],
  ['nca', 'NCA ECC-2:2024', 'Essential cybersecurity controls'],
  ['pdpl', 'PDPL', 'Personal data protection law'],
  ['sama', 'SAMA CSF', 'Cyber security framework'],
  ['nist', 'NIST CSF 2.0', 'Cybersecurity framework'],
  ['cis', 'CIS Controls v8', 'Critical security controls'],
  ['uaeia', 'UAE IA Standard v2.1', 'Information assurance'],
  ['gdpr', 'GDPR', 'General data protection regulation'],
  ['hipaa', 'HIPAA', 'Health information privacy'],
  ['cobit', 'COBIT 2019', 'IT governance'],
].map(([value, label, description]) => ({ value, label, description }));

const PEOPLE: ListOption[] = [
  ['dana', 'Dana Okafor', 'dana.okafor@example.test'],
  ['sam', 'Sam Rivera', 'sam.rivera@example.test'],
  ['lena', 'Lena Petrova', 'lena.petrova@example.test'],
  ['omar', 'Omar Haddad', 'omar.haddad@example.test'],
  ['priya', 'Priya Nair', 'priya.nair@example.test'],
  ['mateo', 'Mateo Silva', 'mateo.silva@example.test'],
  ['aiko', 'Aiko Tanaka', 'aiko.tanaka@example.test'],
  ['noor', 'Noor Al Mansoori', 'noor.almansoori@example.test'],
  ['ben', 'Ben Whitaker', 'ben.whitaker@example.test'],
  ['chiara', 'Chiara Bianchi', 'chiara.bianchi@example.test'],
].map(([value, label, description]) => ({ value, label, description }));

const TYPES: ListOption[] = ['Policy', 'Standard', 'Procedure', 'Guideline', 'Charter'].map((label) => ({ value: label.toLowerCase(), label }));

const said = (value: string[] | string | null): string => (Array.isArray(value) ? (value.length ? value.join(', ') : 'nothing') : value ?? 'nothing');

function Caption({ children }: { children: string }) {
  return <p className="mt-[6px] text-ds-label text-ds-fg-muted" aria-live="polite">Chosen: <code className={MONO}>{children}</code></p>;
}

export function MultiSelectDemo() {
  const [status, setStatus] = useState<string[]>(['draft']);
  const [frameworks, setFrameworks] = useState<string[]>([]);
  const [chips, setChips] = useState<string[]>(['iso27001', 'soc2', 'pci']);
  const [types, setTypes] = useState<string[]>([]);
  const [clipped, setClipped] = useState<string[]>([]);
  return (
    <div className="space-y-[16px]">
      <Grid>
        <Specimen label="A short list (7 options, no search), in a FormField: the label points at the button; Select all and Clear are in the footer; Expired is disabled">
          <FormField label="Status"><MultiSelect label="Status" options={STATUSES} value={status} onChange={setStatus} placeholder="All statuses" /></FormField>
          <Caption>{said(status)}</Caption>
        </Specimen>
        <Specimen label="A long list (14 options): a search box with the library's fold (try “iso”, “data”, “nist cis”), descriptions under the labels">
          <FormField label="Frameworks" hint="Search looks at the name and the description."><MultiSelect label="Frameworks" options={FRAMEWORKS} value={frameworks} onChange={setFrameworks} placeholder="Choose frameworks" /></FormField>
          <Caption>{said(frameworks)}</Caption>
        </Specimen>
        <Specimen label="display=&quot;chips&quot;: the first two as chips and “+N”">
          <FormField label="Frameworks"><MultiSelect label="Frameworks (chips)" display="chips" options={FRAMEWORKS} value={chips} onChange={setChips} placeholder="Choose frameworks" /></FormField>
          <Caption>{said(chips)}</Caption>
        </Specimen>
        <Specimen label="showLabel: for a filter bar with no FormField label (“Type: Policy”, then “Type: 2 selected”)">
          <MultiSelect showLabel label="Type" options={TYPES} value={types} onChange={setTypes} placeholder="All" className="w-[220px]" />
          <Caption>{said(types)}</Caption>
        </Specimen>
        <Specimen label="A chosen value whose option has not loaded is shown as it is (a filter in force is never “nothing chosen”)">
          <MultiSelect label="Owner" options={[]} value={['17', '18']} onChange={() => undefined} placeholder="All owners" emptyText="The owners have not loaded" />
        </Specimen>
        <Specimen label="Invalid and disabled">
          <div className="space-y-[12px]">
            <FormField label="Departments" required error="Choose at least one department."><MultiSelect label="Departments" options={TYPES} value={[]} onChange={() => undefined} placeholder="Choose departments" /></FormField>
            <MultiSelect disabled label="Locked" options={TYPES} value={['policy']} onChange={() => undefined} />
          </div>
        </Specimen>
      </Grid>
      <Specimen label="Inside a box that clips (overflow hidden, 96 px tall): the popover is drawn on the window, so it is not cut off">
        <div className="h-[96px] overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
          <MultiSelect showLabel label="Status" options={STATUSES} value={clipped} onChange={setClipped} placeholder="All" className="w-[260px]" />
        </div>
      </Specimen>
    </div>
  );
}

export function ComboboxDemo() {
  const [owner, setOwner] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>('finance');
  const [dialog, setDialog] = useState(false);
  const [inDialog, setInDialog] = useState<string | null>(null);
  const [inDialogMany, setInDialogMany] = useState<string[]>([]);
  return (
    <div className="space-y-[16px]">
      <Grid>
        <Specimen label="A long list of people (10, so a search box), a description under each name; choosing closes the list and returns focus to the button">
          <FormField label="Owner" required><Combobox label="Owner" options={PEOPLE} value={owner} onChange={setOwner} placeholder="Choose an owner" /></FormField>
          <Caption>{said(owner)}</Caption>
        </Specimen>
        <Specimen label="clearable: choosing the chosen option again clears it (an optional field)">
          <FormField label="Department" optional><Combobox label="Department" clearable options={[{ value: 'finance', label: 'Finance' }, { value: 'security', label: 'Security' }, { value: 'operations', label: 'Operations' }]} value={department} onChange={setDepartment} placeholder="None" /></FormField>
          <Caption>{said(department)}</Caption>
        </Specimen>
        <Specimen label="Invalid, with the field's error read out">
          <FormField label="Sponsor" required error="Choose a sponsor."><Combobox label="Sponsor" options={PEOPLE} value={null} onChange={() => undefined} placeholder="Choose a sponsor" /></FormField>
        </Specimen>
        <Specimen label="Disabled">
          <Combobox disabled label="Locked owner" options={PEOPLE} value="dana" onChange={() => undefined} />
        </Specimen>
      </Grid>
      <Specimen label="In a dialog: the first Escape closes the open list, the second closes the dialog (and focus goes back to the button that opened it)">
        <Row><Button onClick={() => setDialog(true)}>Open a dialog with selects</Button></Row>
        <AnimatedModal isOpen={dialog} onClose={() => setDialog(false)} title="Assign the document" subtitle="The lists are drawn on the window, above the dialog." size="md">
          <div className="space-y-[12px] p-[16px]">
            <FormField label="Owner"><Combobox label="Owner" options={PEOPLE} value={inDialog} onChange={setInDialog} placeholder="Choose an owner" /></FormField>
            <FormField label="Reviewers"><MultiSelect label="Reviewers" options={PEOPLE} value={inDialogMany} onChange={setInDialogMany} placeholder="Choose reviewers" /></FormField>
          </div>
        </AnimatedModal>
      </Specimen>
    </div>
  );
}
