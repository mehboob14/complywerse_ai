'use client';

// The Setup tab: what is set once and used by every later import and every finding. Owners and units (the mappings) and Imports (the history) are read with the create right; Reminders and SLAs,
// Reports and exams, Dropdown lists and Issue # numbering are read with the view right and changed with the create right. The section is in the address (?setup=), so a link opens it.
import { Select, SegmentedControl, NoAccessState, useTabParam, FormField } from '@/components/ui/ds';
import { SETUP_LABELS, can, setupSections, type RegisterRights, type SetupSection } from '@/lib/auditRegister/rights';
import { SetupImports } from './SetupImports';
import { SetupMappings } from './SetupMappings';
import { SetupSettings, type SettingsSection } from './SetupSettings';

export function SetupTab({ rights }: { rights: RegisterRights }) {
  const sections = setupSections(rights);
  const [section, setSection] = useTabParam<SetupSection>('setup', sections, { fallback: sections[0] ?? 'reminders' });
  if (sections.length === 0) return <NoAccessState title="You don't have access to the setup" reason="Reading the register's settings needs the right to view issues." />;
  const options = sections.map((s) => ({ value: s, label: SETUP_LABELS[s] }));
  return (
    <div className="flex flex-col gap-[16px]">
      <SegmentedControl<SetupSection> label="Setup section" name="audit-register-setup" options={options} value={section} onChange={setSection} className="hidden md:inline-flex" />
      <FormField label="Section" className="md:hidden">
        <Select value={section} onChange={(e) => setSection(e.target.value as SetupSection)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </FormField>
      {section === 'owners' && <SetupMappings />}
      {section === 'imports' && <SetupImports onMap={() => setSection('owners')} />}
      {(section === 'reminders' || section === 'reports' || section === 'lists' || section === 'numbering') && (
        <SetupSettings section={section as SettingsSection} canEdit={can(rights, 'writeSettings')} />
      )}
    </div>
  );
}
