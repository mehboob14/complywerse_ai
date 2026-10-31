'use client';

// Buttons (Button, IconButton) and form controls (FormField, TextInput, Textarea, Select, Checkbox), each in every variant and state.
import { useState } from 'react';
import { clsx } from 'clsx';
import { Bell, ChevronRight, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Button, Checkbox, FormField, IconButton, Select, Textarea, TextInput } from '@/components/ui';
import { Grid, GuideSection, MONO, Row, Spec, Specimen } from './Guide';

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger', 'dangerOutline', 'link'] as const;

export function ButtonsSection() {
  return (
    <GuideSection id="buttons" title="Buttons" lead="One button for the whole platform, on the design tokens: deep teal with white words, 32 px high (44 px on touch).">
      <Spec name="Button">
        <Specimen label="Six variants, each in its states: default, with an icon, small, disabled, loading and as a link">
          <div className="space-y-[12px]">
            {VARIANTS.map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-[8px]">
                <code className={clsx(MONO, 'w-[110px] shrink-0 text-ds-fg-muted')}>{v}</code>
                <Button variant={v}>Button</Button>
                <Button variant={v} leftIcon={<Plus />}>Left icon</Button>
                <Button variant={v} rightIcon={<ChevronRight />}>Right icon</Button>
                <Button variant={v} size="sm">Small</Button>
                <Button variant={v} disabled>Disabled</Button>
                <Button variant={v} loading>Loading</Button>
                <Button variant={v} href="#buttons">As a link</Button>
              </div>
            ))}
          </div>
        </Specimen>
        <Row gap={16} align="start">
          <Specimen label="A loading button with an icon: the spinner takes its place" className="w-[220px]"><Button variant="primary" leftIcon={<Plus />} loading>Saving</Button></Specimen>
          <Specimen label="A disabled link has no href" className="w-[220px]"><Button href="/dashboard" disabled>Not available</Button></Specimen>
          <Specimen label="fullWidth, for a phone form" className="w-[220px]"><Button variant="primary" fullWidth>Continue</Button></Specimen>
          <Specimen label="A long label is cut inside its button" className="w-[220px]"><Button fullWidth>Archive every document that has not been reviewed this year</Button></Specimen>
        </Row>
      </Spec>

      <Spec name="IconButton">
        <Specimen label="ghost (default) and secondary, enabled and disabled; each is named by its label, which is also its tooltip">
          <Row>
            <IconButton label="Close"><X /></IconButton>
            <IconButton label="Edit row"><Pencil /></IconButton>
            <IconButton label="Delete row"><Trash2 /></IconButton>
            <IconButton label="Notifications" variant="secondary"><Bell /></IconButton>
            <IconButton label="Add" variant="secondary"><Plus /></IconButton>
            <IconButton label="Delete row (not allowed)" disabled><Trash2 /></IconButton>
            <IconButton label="Add (not allowed)" variant="secondary" disabled><Plus /></IconButton>
          </Row>
        </Specimen>
      </Spec>
    </GuideSection>
  );
}

function ControlledTitle() {
  const [title, setTitle] = useState('');
  return (
    <FormField label="Title" required hint="Shown in the library and in notifications." error={title.trim() === '' ? 'Enter a title.' : undefined}>
      <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Type, then clear it" />
    </FormField>
  );
}

export function FormsSection() {
  return (
    <GuideSection id="forms" title="Form controls" lead="A FormField wires a label, the required mark, a hint and an error to the control inside it; the control takes its id and ARIA from there.">
      <Spec name="FormField">
        <Grid>
          <Specimen label="Default"><FormField label="Title"><TextInput placeholder="Information security policy" /></FormField></Specimen>
          <Specimen label="Required: the red * is read out as “required”"><FormField label="Title" required><TextInput placeholder="Information security policy" /></FormField></Specimen>
          <Specimen label="Optional"><FormField label="Reference" optional><TextInput placeholder="POL-014" /></FormField></Specimen>
          <Specimen label="With a hint: text that prevents a mistake"><FormField label="Owner email" hint="Use the address on the person’s account."><TextInput type="email" placeholder="name@company.test" /></FormField></Specimen>
          <Specimen label="With an error: red, read out as it appears"><FormField label="Title" required error="Enter a title."><TextInput defaultValue="" /></FormField></Specimen>
          <Specimen label="With info: the (i) beside the label"><FormField label="Review cycle" info="How often the document is read again. Hover, focus or tap the (i)."><Select defaultValue="12"><option value="6">Every 6 months</option><option value="12">Every 12 months</option></Select></FormField></Specimen>
          <Specimen label="Disabled"><FormField label="Status"><TextInput disabled defaultValue="Locked while in review" /></FormField></Specimen>
          <Specimen label="Read-only: full-contrast words on a grey box"><FormField label="Status"><TextInput readOnly defaultValue="Approved" /></FormField></Specimen>
          <Specimen label="Live: clear the box to see the error appear"><ControlledTitle /></Specimen>
        </Grid>
      </Spec>

      <Spec name="TextInput">
        <Grid>
          <Specimen label="Alone: named with aria-label"><TextInput aria-label="Search documents" placeholder="Search documents" /></Specimen>
          <Specimen label="Left adornment: decoration inside the box"><TextInput aria-label="Search" leftAdornment={<Search />} placeholder="Search" /></Specimen>
          <Specimen label="Right adornment"><TextInput aria-label="File name" rightAdornment={<span className="text-ds-label text-ds-fg-muted">.docx</span>} defaultValue="policy" /></Specimen>
          <Specimen label="Invalid on its own"><TextInput aria-label="Email" invalid defaultValue="not-an-email" /></Specimen>
          <Specimen label="Disabled"><TextInput aria-label="Locked" disabled defaultValue="Locked" /></Specimen>
          <Specimen label="Read-only"><TextInput aria-label="Reference" readOnly defaultValue="POL-014" /></Specimen>
        </Grid>
      </Spec>

      <Spec name="Textarea">
        <Grid>
          <Specimen label="Default"><FormField label="Description"><Textarea placeholder="What is this document for?" /></FormField></Specimen>
          <Specimen label="With a limit: the counter is a live region"><FormField label="Summary"><Textarea maxLength={200} defaultValue="Sets out how access to systems is requested, approved and reviewed." /></FormField></Specimen>
          <Specimen label="Error"><FormField label="Reason" required error="Say why the exception is needed."><Textarea /></FormField></Specimen>
          <Specimen label="Read-only"><FormField label="Decision"><Textarea readOnly defaultValue="Approved for twelve months, subject to review." /></FormField></Specimen>
          <Specimen label="Disabled"><FormField label="Notes"><Textarea disabled defaultValue="Notes are closed." /></FormField></Specimen>
        </Grid>
      </Spec>

      <Spec name="Select">
        <Grid>
          <Specimen label="With a placeholder (grey while it shows)"><FormField label="Department"><Select placeholder="Select a department"><option>Security</option><option>Finance</option><option>Operations</option></Select></FormField></Specimen>
          <Specimen label="With a value"><FormField label="Department"><Select defaultValue="Finance"><option>Security</option><option>Finance</option><option>Operations</option></Select></FormField></Specimen>
          <Specimen label="Error"><FormField label="Department" required error="Choose a department."><Select placeholder="Select a department"><option>Security</option><option>Finance</option></Select></FormField></Specimen>
          <Specimen label="Disabled"><FormField label="Department"><Select disabled defaultValue="Security"><option>Security</option></Select></FormField></Specimen>
        </Grid>
      </Spec>

      <Spec name="Checkbox">
        <Grid>
          <Specimen label="Unchecked, with its label"><Checkbox label="Notify the owner" /></Specimen>
          <Specimen label="Checked"><Checkbox label="Notify the owner" defaultChecked /></Specimen>
          <Specimen label="Indeterminate: some selected"><Checkbox label="Select all documents" indeterminate /></Specimen>
          <Specimen label="Disabled"><Checkbox label="Notify the owner" disabled defaultChecked /></Specimen>
          <Specimen label="Error"><FormField label="Terms" required error="Accept to continue."><Checkbox label="I have read the policy" /></FormField></Specimen>
          <Specimen label="A long label wraps beside the box"><Checkbox label="Send every reviewer a reminder two days before the review is due, and the owner a copy of each reminder" /></Specimen>
          <Specimen label="A bare box is named with aria-label"><Checkbox aria-label="Select this row" /></Specimen>
        </Grid>
      </Spec>
    </GuideSection>
  );
}
