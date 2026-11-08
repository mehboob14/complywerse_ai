'use client';

// Create a tenant-authored custom control. Fields start blank: no SCF prose or AI drafting. It is created as a draft and opens on its own page. The server lets only people who may create controls
// (controls:control_library:create) do it, so anyone else reads a line that says so instead of a form that would fail when sent.
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { Button, Notice, useReportedMutation } from '@/components/ui/ds';
import { CustomControlForm, toWriteBody, type CustomControlFormValues } from '@/components/soc2/CustomControlForm';
import { scfApi } from '@/lib/api';
import { useRights } from '../_explorer/controlsRights';
import { titleFor } from '@/lib/navRegistry';

export default function NewCustomControlPage() {
  const router = useRouter();
  const { can, loading: isLoading } = useRights();
  const canCreate = can('createControl');

  const create = useReportedMutation({
    mutationFn: async (v: CustomControlFormValues) => (await scfApi.createCustomControl({ ...toWriteBody(v), name: v.name.trim() })).data,
    success: { title: 'Custom control created', message: 'It is a draft. Submit it for approval when it is ready.' },
    failure: "Couldn't create the control",
    retryable: false,
    invalidate: [['automation-common'], ['common-overview']],
    onSuccess: (data) => { router.push(`/automation/soc2-controls/${encodeURIComponent(data?.code || '')}`); },
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-[16px]">
      <PageHeader
        variant="page"
        back={{ href: '/automation/soc2-controls', label: 'Back to controls' }}
        title={titleFor('/automation/soc2-controls/new') ?? 'New custom control'}
        info="Author your own control: how it is classified, who owns it, how it is implemented and tested, and everything it is linked to. It is created as a draft; submit it for approval when it is ready."
      />
      {isLoading ? null : !canCreate ? (
        <Notice tone="info" title="You can’t create controls" action={<Button href="/automation/soc2-controls">Back to controls</Button>}>Creating a control needs the right to create controls. Ask an administrator if you need it.</Notice>
      ) : (
        <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
          <CustomControlForm submitLabel="Create control" pending={create.isPending} onCancel={() => router.push('/automation/soc2-controls')} onSubmit={(v) => create.mutate(v)} />
        </div>
      )}
    </div>
  );
}
