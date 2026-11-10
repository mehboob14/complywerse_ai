'use client';

// Settings > Reviews and reminders: when suppliers' dates, questionnaires and contracts are reminded, who hears when they are overdue, how often stakeholders check in, which new alerts are emailed
// and the weekly digest of suppliers waiting on onboarding review. How often each tier is REASSESSED is the Policy page's (Bands and cadence).
import Link from 'next/link';
import { Checkbox, Select, SectionCard, TextInput } from '@/components/ui/ds';
import { Help, Row, TargetsPicker } from '../_ui';
import { days, type ReminderPolicy } from '../settingsModel';
import { DefaultsButton, NEEDS_RIGHT, type SettingsCtx } from './shared';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const DAYS = '!w-[140px]';
const RULE = 'mt-[8px] border-t border-ds-border pt-[8px]';

export default function RemindersSection({ ctx }: { ctx: SettingsCtx }) {
  const { draft, canEdit, directory, set } = ctx;
  const r = draft.reminder_policy;
  const off = !canEdit || !r.enabled;
  const setR = (patch: Partial<ReminderPolicy>) => set('reminder_policy', { ...r, ...patch });
  const num = (id: string, value: number, min: number, onChange: (n: number) => void) => (
    <TextInput id={id} type="number" min={min} unit="days" className={DAYS} disabled={off} value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))} />
  );
  return (
    <SectionCard id="reminders" title="Reminders and escalation" meta={r.enabled ? `On · ${r.remind_before_days} days before · then every ${r.repeat_every_days} days` : 'Off: no reminders are sent'} actions={<DefaultsButton ctx={ctx} keys={['reminder_policy']} />}>
      <Checkbox label="Send reminders" checked={r.enabled} disabled={!canEdit} onChange={(e) => setR({ enabled: e.target.checked })} />
      <div className="mt-[8px]">
        <Help>
          Covers reassessments, questionnaires waiting on a supplier, remediation, risk acceptances, contracts and stakeholders’ yearly check-ins: one notice when the window opens, then one per repeat period once
          overdue. An expired risk acceptance is marked expired and stops mitigating its finding. How often each tier is reassessed is on the <Link href="/vendor-risk/policy#bands" className="font-[500] text-ds-primary-text underline">Policy</Link> page.
        </Help>
      </div>
      <Row label="Remind this many days before a date" htmlFor="r-before">{num('r-before', r.remind_before_days, 0, (n) => setR({ remind_before_days: n }))}</Row>
      <Row label="Once overdue, remind every" htmlFor="r-repeat">{num('r-repeat', r.repeat_every_days, 1, (n) => setR({ repeat_every_days: n }))}</Row>
      <Row label="Escalate when this many days overdue" htmlFor="r-escalate">{num('r-escalate', r.escalate_after_days, 0, (n) => setR({ escalate_after_days: n }))}</Row>
      <div className="py-[6px]">
        <p className="text-ds-body text-ds-fg">Escalate to</p>
        <p className="mb-[6px] text-ds-label text-ds-fg-muted">The owner is always told; these roles and people are added once the escalation point passes.</p>
        <TargetsPicker value={r.escalate_to} onChange={(v) => setR({ escalate_to: v })} directory={directory} disabled={off} />
      </div>

      <div className={RULE}>
        <Row label="Stakeholders check in on each supplier every" htmlFor="r-checkin" help={days(r.checkin_every_days ?? 365)}>{num('r-checkin', r.checkin_every_days ?? 365, 30, (n) => setR({ checkin_every_days: n }))}</Row>
        <Row label="Start contract reminders this many days before the last day to give notice" htmlFor="r-contract">{num('r-contract', r.contract_before_days ?? 30, 0, (n) => setR({ contract_before_days: n }))}</Row>
        <div className="py-[6px]">
          <p className="text-ds-body text-ds-fg">Also tell about contracts</p>
          <p className="mb-[6px] text-ds-label text-ds-fg-muted">
            The supplier’s owner always hears when a contract needs a decision. A contract past its notice date is repeated on the same rhythm until its renewal is recorded or it is closed out.
          </p>
          <TargetsPicker value={r.contract_notify || []} onChange={(v) => setR({ contract_notify: v })} directory={directory} disabled={off} />
        </div>
      </div>

      <div className={RULE}>
        <Row label="Email a new alert from this severity up" htmlFor="r-alert" help="Verified alerts only, once each. The supplier's owner is told, and whoever is added below.">
          <Select id="r-alert" disabled={off} value={r.alert_min_severity || 'high'} onChange={(e) => setR({ alert_min_severity: e.target.value })} className="!w-[140px]">
            {SEVERITIES.map((sv) => <option key={sv} value={sv}>{sv.charAt(0).toUpperCase() + sv.slice(1)}</option>)}
          </Select>
        </Row>
        <TargetsPicker value={r.alert_notify || []} onChange={(v) => setR({ alert_notify: v })} directory={directory} disabled={off} placeholder="Also tell about new alerts…" />
      </div>

      <div className={RULE}>
        <p className="text-ds-body text-ds-fg">Weekly digest of suppliers waiting on onboarding review</p>
        <p className="mb-[6px] text-ds-label text-ds-fg-muted">Where each supplier is and how long it has waited, once a week. None is sent when nobody is named or nobody is waiting.</p>
        <TargetsPicker value={r.digest_to || []} onChange={(v) => setR({ digest_to: v })} directory={directory} disabled={off} placeholder="Send the digest to…" />
        <Row label="Sent on" htmlFor="r-digest-day">
          <Select id="r-digest-day" disabled={off || !(r.digest_to || []).length} value={String(r.digest_weekday ?? 0)} onChange={(e) => setR({ digest_weekday: Number(e.target.value) })} className="!w-[140px]">
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </Select>
        </Row>
      </div>
      {!canEdit && <p className="mt-[12px] text-ds-label text-ds-fg-muted">{NEEDS_RIGHT}</p>}
    </SectionCard>
  );
}
