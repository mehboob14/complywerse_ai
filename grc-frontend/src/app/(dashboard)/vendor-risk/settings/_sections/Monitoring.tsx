'use client';

// Settings > Monitoring: what is watched about each supplier (the news search, the scan from outside, public code), how often by tier, and how an outside-in scan is scored into a grade. The alert
// rules (what an alert sets off) are on the Policy page. The grades here are the Security ratings page's: higher is better.
import Link from 'next/link';
import { Checkbox, FormField, SectionCard, TextInput } from '@/components/ui/ds';
import { fieldClasses } from '@/components/ui/ds/fieldStyles';
import { Help, Row, TIERS, TIER_LABEL } from '../_ui';
import { days } from '../settingsModel';
import { DefaultsButton, NEEDS_RIGHT, type SettingsCtx } from './shared';

const BOX = 'rounded-ds-control border border-ds-border p-[12px]';
const CELL = 'block rounded-ds-control bg-ds-surface-subtle p-[8px] text-ds-label text-ds-fg-muted';
const NUM = `${fieldClasses(false)} h-ds-control px-[12px] text-right tabular-nums`;

export default function MonitoringSection({ ctx }: { ctx: SettingsCtx }) {
  const { draft, canEdit, set } = ctx;
  const m = draft.monitoring_policy;
  const sc = draft.scan_scoring;
  const cadenceRow = (field: 'check_every_days' | 'scan_every_days', tier: string, max: number) => (
    <label key={tier} className={CELL}>
      {TIER_LABEL[tier]}
      <span className="mt-[4px] flex items-center gap-[4px]">
        <input type="number" min={1} max={max} disabled={!canEdit} value={m[field][tier] ?? ''} aria-label={`${TIER_LABEL[tier]} supplier: days between ${field === 'check_every_days' ? 'checks' : 'scans'}`}
          onChange={(e) => set('monitoring_policy', { ...m, [field]: { ...m[field], [tier]: Number(e.target.value) } })} className={NUM} />
        <span>days</span>
      </span>
      <span className="mt-[2px] block text-ds-label text-ds-fg-muted">{days(m[field][tier])}</span>
    </label>
  );
  const numIn = (value: number, onChange: (n: number) => void, label: string) => (
    <input type="number" min={0} max={100} disabled={!canEdit} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className={NUM} />
  );
  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard id="monitoring" title="Monitoring feeds" meta={`News search ${m.adverse_media ? 'on' : 'off'} · Scanning from outside ${m.outside_in ? 'on' : 'off'}`} actions={<DefaultsButton ctx={ctx} keys={['monitoring_policy']} />}>
        <Help>Certificates and reports on file that lapse are always watched, on the cadence below. What a monitoring alert sets off is on the <Link href="/vendor-risk/policy#alert-rules" className="font-[500] text-ds-primary-text underline">Policy</Link> page.</Help>
        <div className="flex flex-col gap-[12px]">
          <div className={BOX}>
            <p className="text-ds-body font-[600] text-ds-fg">How often each supplier is checked</p>
            <p className="mb-[8px] text-ds-label text-ds-fg-muted">Lapsed certificates and, when it is on, the news search, by the supplier’s tier.</p>
            <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-4">{TIERS.map((k) => cadenceRow('check_every_days', k, 365))}</div>
          </div>
          <div className={BOX}>
            <p className="text-ds-body font-[600] text-ds-fg">How often each supplier is scanned from outside</p>
            <p className="mb-[8px] text-ds-label text-ds-fg-muted">The outside-in scan and any connected ratings service, by the supplier’s tier.</p>
            <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-4">{TIERS.map((k) => cadenceRow('scan_every_days', k, 730))}</div>
          </div>
          <div className={BOX}>
            <Checkbox label="Search the news for breaches and adverse media about each supplier" checked={m.adverse_media} disabled={!canEdit}
              onChange={(e) => set('monitoring_policy', { ...m, adverse_media: e.target.checked })} />
            <p className="ml-[26px] text-ds-label text-ds-fg-muted">
              Uses the GDELT Project’s free news search; each supplier’s name is sent to it. An alert counts as verified only when two publishers report it; until then it is shown but never emailed and never reopens
              an assessment.
            </p>
          </div>
          <div className={BOX}>
            <Checkbox label="Scan each supplier’s websites and domains from outside" checked={m.outside_in} disabled={!canEdit} onChange={(e) => set('monitoring_policy', { ...m, outside_in: e.target.checked })} />
            <p className="ml-[26px] text-ds-label text-ds-fg-muted">
              Looks at what any visitor sees: certificates, HTTPS and protective headers, and email spoofing protection, plus exposed services and known vulnerabilities when a Shodan key is connected. Nothing is
              port-scanned. A supplier’s first scan sets its baseline; after that a new high or critical finding raises an alert.
            </p>
          </div>
          <div className={BOX}>
            <Checkbox label="Search public code for credentials published by mistake" checked={!!m.leak_search} disabled={!canEdit} onChange={(e) => set('monitoring_policy', { ...m, leak_search: e.target.checked })} />
            <p className="ml-[26px] text-ds-label text-ds-fg-muted">
              Each supplier’s domains, on its scan cadence, and ours below, once a day, are searched on GitHub beside words like password or secret. Needs GitHub code search connected under Administration, Connectors. A
              file found is an unverified alert to look at; it is linked, never copied.
            </p>
            <div className="ml-[26px] mt-[8px]">
              <FormField label="Our own domains" hint="Separate them with commas.">
                <TextInput disabled={!canEdit || !m.leak_search} value={(m.own_domains || []).join(', ')} placeholder="acme.com, acme-cloud.io"
                  onChange={(e) => set('monitoring_policy', { ...m, own_domains: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
              </FormField>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard id="scan-scoring" title="How an outside-in scan is scored" meta={`A from ${sc.grades.A}, B ${sc.grades.B}, C ${sc.grades.C}, D ${sc.grades.D} · a critical finding takes off ${sc.scan_points.critical}`} actions={<DefaultsButton ctx={ctx} keys={['scan_scoring']} />}>
        <Help>
          A supplier’s score starts at 100. Each weakness a scan finds takes off its severity’s points, once however many of the supplier’s hosts share it, and no one category can take off more than the cap. A waived
          finding does not count until its waiver ends. The grade follows from the score; a higher score is better.
        </Help>
        <div className="flex flex-col gap-[12px]">
          <div className={BOX}>
            <p className="mb-[8px] text-ds-body font-[600] text-ds-fg">Points a finding takes off, by severity</p>
            <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-4">
              {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
                <label key={sev} className={CELL}>
                  {TIER_LABEL[sev]}
                  <span className="mt-[4px] block">{numIn(sc.scan_points[sev], (n) => set('scan_scoring', { ...sc, scan_points: { ...sc.scan_points, [sev]: n } }), `Points for a ${sev} finding`)}</span>
                </label>
              ))}
            </div>
            <Row label="The most one category (for example email protection) can take off" htmlFor="scan-cap">
              <TextInput id="scan-cap" type="number" min={1} max={100} unit="points" className="!w-[150px]" disabled={!canEdit} value={sc.scan_category_cap} onChange={(e) => set('scan_scoring', { ...sc, scan_category_cap: Number(e.target.value) })} />
            </Row>
          </div>
          <div className={BOX}>
            <p className="mb-[8px] text-ds-body font-[600] text-ds-fg">Where each grade starts</p>
            <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-5">
              {(['A', 'B', 'C', 'D'] as const).map((g) => (
                <label key={g} className={CELL}>
                  Grade {g} from
                  <span className="mt-[4px] block">{numIn(sc.grades[g], (n) => set('scan_scoring', { ...sc, grades: { ...sc.grades, [g]: n } }), `Score where grade ${g} starts`)}</span>
                </label>
              ))}
              <p className="flex items-center rounded-ds-control bg-ds-surface-subtle p-[8px] text-ds-label text-ds-fg-muted">F below {sc.grades.D}</p>
            </div>
          </div>
        </div>
      </SectionCard>
      {!canEdit && <p className="text-ds-label text-ds-fg-muted">{NEEDS_RIGHT}</p>}
    </div>
  );
}
