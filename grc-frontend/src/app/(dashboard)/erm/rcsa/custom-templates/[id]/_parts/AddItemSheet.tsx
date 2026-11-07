'use client';

// "Add an item": a new row of the register, in a kit Sheet with the same grouped fields the item's Fields tab has. Saving creates it and opens it, so the owner and the evidence can be added next.
// A failed save is shown at the top with what was typed kept; Escape asks before it throws typed input away.
import { useState } from 'react';
import { Button, FormError, Sheet, useReportedMutation } from '@/components/ui/ds';
import { rcsaApi } from '@/lib/api';
import { fieldGroups, storedValue, inputKind, flatColumns, type ColumnSchema } from '@/lib/rcsa/registerModel';
import { ItemFields } from './ItemFields';
import { itemsChanged } from './registerData';

export function AddItemSheet({ open, templateId, schema, onClose, onCreated, nonce }: {
  open: boolean; templateId: number; schema: ColumnSchema; onClose: () => void; onCreated: (id: number) => void; nonce: number;
}) {
  return <Form key={nonce} open={open} templateId={templateId} schema={schema} onClose={onClose} onCreated={onCreated} />;
}

function Form({ open, templateId, schema, onClose, onCreated }: { open: boolean; templateId: number; schema: ColumnSchema; onClose: () => void; onCreated: (id: number) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<unknown>(null);
  const groups = fieldGroups(schema);
  const columns = flatColumns(schema);
  const filled = Object.keys(values).filter((k) => values[k].trim() !== '');
  const create = useReportedMutation({
    mutationFn: async () => {
      const data: Record<string, unknown> = {};
      filled.forEach((k) => { const col = columns.find((c) => c.key === k); data[k] = storedValue(col ? inputKind(col) : 'text', values[k]); });
      return (await rcsaApi.customTemplates.createRow(templateId, { data })).data as { id: number };
    },
    success: 'Item added',
    failure: "The item wasn't added",
    toast: 'success',
    retryable: false,
    invalidate: itemsChanged(templateId),
    onSuccess: (made) => { onClose(); onCreated(made.id); },
    onError: (e) => setProblem(e),
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add an item"
      subtitle="Fill in what you know. You can add the owner and the evidence next."
      width="lg"
      dirty={filled.length > 0 && !create.isPending}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={filled.length === 0} onClick={() => { setProblem(null); create.mutate(); }}>Add item</Button></div>}
    >
      <div className="flex flex-col gap-[12px]">
        <FormError title="The item wasn't added" error={problem} onRetry={() => { setProblem(null); create.mutate(); }} />
        <ItemFields groups={groups} value={(k) => values[k] ?? ''} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
      </div>
    </Sheet>
  );
}
