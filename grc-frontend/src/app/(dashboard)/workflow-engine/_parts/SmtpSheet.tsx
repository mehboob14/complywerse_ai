'use client';

// Workflow Engine > Set up e-mail: the mail server the workflows send e-mail notifications through. A Sheet with a form that validates in plain words; the password is
// typed fresh every time, is never filled in and never read back. The save body is workflowModel.smtpBody (the same fields as before).
import { useEffect, useState } from 'react';
import { workflowEngineApi } from '@/lib/api';
import { Button, Checkbox, FormField, Sheet, TextInput, useReportedMutation } from '@/components/ui/ds';
import { hasSmtpErrors, SMTP_DEFAULTS, smtpBody, smtpErrors, type SmtpForm } from '../workflowModel';

export function SmtpSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<SmtpForm>(SMTP_DEFAULTS);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setForm(SMTP_DEFAULTS); setTouched(false); } }, [open]);
  const errors = smtpErrors(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(SMTP_DEFAULTS);
  const shown = touched ? errors : {};
  const set = (patch: Partial<SmtpForm>) => setForm({ ...form, ...patch });

  const save = useReportedMutation({
    mutationFn: () => workflowEngineApi.notifications.createEmailConfig(smtpBody(form)),
    success: { title: 'E-mail server saved', message: 'Workflows can send e-mail notifications now.' },
    failure: "The e-mail server wasn't saved",
    retryable: false,
    onSuccess: () => { onSaved(); onClose(); },
  });
  const submit = () => { setTouched(true); if (!hasSmtpErrors(errors)) save.mutate(); };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="md"
      title="Set up e-mail"
      subtitle="The mail server workflows send notifications through."
      dirty={dirty}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button>
        </div>
      )}
    >
      <form className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); submit(); }} autoComplete="off">
        <FormField label="Name" info="What this setup is called. The first one is the one workflows use.">
          <TextInput value={form.config_name} onChange={(e) => set({ config_name: e.target.value })} />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-[minmax(0,1fr)_120px]">
          <FormField label="Mail server" required error={shown.smtp_host}>
            <TextInput placeholder="smtp.example.com" value={form.smtp_host} onChange={(e) => set({ smtp_host: e.target.value })} />
          </FormField>
          <FormField label="Port" error={shown.smtp_port}>
            <TextInput type="number" inputMode="numeric" placeholder="587" value={form.smtp_port} onChange={(e) => set({ smtp_port: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Account" required error={shown.smtp_username}>
          <TextInput placeholder="you@example.com" autoComplete="off" value={form.smtp_username} onChange={(e) => set({ smtp_username: e.target.value })} />
        </FormField>
        <FormField label="Password" required hint="Typed here and sent once. It is never shown again." error={shown.smtp_password}>
          <TextInput type="password" autoComplete="new-password" placeholder="Password or app password" value={form.smtp_password} onChange={(e) => set({ smtp_password: e.target.value })} />
        </FormField>
        <FormField label="Send from" optional hint="Left empty, e-mail is sent from the account above." error={shown.from_email}>
          <TextInput type="email" placeholder="noreply@yourcompany.com" value={form.from_email} onChange={(e) => set({ from_email: e.target.value })} />
        </FormField>
        <FormField label="Sender name" optional>
          <TextInput value={form.from_name} onChange={(e) => set({ from_name: e.target.value })} />
        </FormField>
        <Checkbox label="Use a secure connection (recommended for port 587)" checked={form.use_tls} onChange={(e) => set({ use_tls: e.target.checked })} />
      </form>
    </Sheet>
  );
}
