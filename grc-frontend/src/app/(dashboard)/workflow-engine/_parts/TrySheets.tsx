'use client';

// Workflow Engine > two small dialogs that used to be browser prompts: "Send a test e-mail" (to the address typed, through the first e-mail setup) and "Try a workflow"
// (start one run by hand with a chosen event and sample data). Each is a Sheet with fields that say what is wrong in plain words and a result that is a toast, never an alert.
import { useEffect, useState } from 'react';
import { workflowEngineApi } from '@/lib/api';
import { Button, FormField, Notice, Sheet, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { isEmail, parseSample, triggerWords, tryBody, TRY_DEFAULT_EVENT } from '../workflowModel';

export function TestEmailSheet({ open, onClose, serverCount, onSetup }: { open: boolean; onClose: () => void; serverCount: number; onSetup: () => void }) {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setEmail(''); setTouched(false); } }, [open]);
  const bad = touched && !isEmail(email) ? 'Enter an e-mail address, like name@yourcompany.com.' : undefined;

  const send = useReportedMutation({
    mutationFn: async () => {
      const configs = (await workflowEngineApi.notifications.listEmailConfigs()).data || [];
      await workflowEngineApi.notifications.testEmailConfig(Number(configs[0].id), email.trim());
    },
    success: () => `A test e-mail was sent to ${email.trim()}`,
    failure: "The test e-mail wasn't sent",
    onSuccess: onClose,
  });
  const submit = () => { setTouched(true); if (isEmail(email)) send.mutate(); };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="sm"
      title="Send a test e-mail"
      subtitle="Checks the e-mail setup workflows use."
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={send.isPending} disabled={serverCount === 0} onClick={submit}>Send</Button>
        </div>
      )}
    >
      {serverCount === 0 ? (
        <Notice tone="warning" title="No e-mail setup yet" action={<Button size="sm" onClick={() => { onClose(); onSetup(); }}>Set up e-mail</Button>}>
          Workflows cannot send e-mail until a mail server is set up.
        </Notice>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <FormField label="Send the test to" required error={bad}>
            <TextInput type="email" autoComplete="email" placeholder="name@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
        </form>
      )}
    </Sheet>
  );
}

export function TrySheet({ workflow, onClose }: { workflow: { id: number; name: string } | null; onClose: () => void }) {
  const [event, setEvent] = useState(TRY_DEFAULT_EVENT);
  const [sample, setSample] = useState('{}');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (workflow) { setEvent(TRY_DEFAULT_EVENT); setSample('{}'); setTouched(false); } }, [workflow]);
  const parsed = parseSample(sample);
  const bad = touched && !parsed.ok ? parsed.message : undefined;

  const run = useReportedMutation({
    mutationFn: () => workflowEngineApi.executions.trigger(tryBody((workflow as { id: number }).id, event, parsed.ok ? parsed.value : {})),
    success: { title: 'Test run started', message: 'Follow it in Analytics.' },
    failure: "The test run didn't start",
    onSuccess: onClose,
  });
  const submit = () => { setTouched(true); if (parsed.ok && workflow) run.mutate(); };

  return (
    <Sheet
      open={!!workflow}
      onClose={onClose}
      width="md"
      title={workflow ? `Try “${workflow.name}”` : 'Try a workflow'}
      subtitle="Starts one run now, as if the event had happened."
      dirty={touched}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} onClick={submit}>Start a test run</Button>
        </div>
      )}
    >
      <form className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormField label="Event to act out" info="The event the run starts from. The usual choice is a manual start." hint={`Reads as: ${triggerWords(event || TRY_DEFAULT_EVENT)}`}>
          <TextInput value={event} onChange={(e) => setEvent(e.target.value)} />
        </FormField>
        <FormField label="Sample data" info="Values the workflow can read while it runs, written like {&quot;severity&quot;: &quot;high&quot;}. Leave {} for none." error={bad}>
          <Textarea rows={6} spellCheck={false} value={sample} onChange={(e) => { setSample(e.target.value); setTouched(true); }} />
        </FormField>
      </form>
    </Sheet>
  );
}
