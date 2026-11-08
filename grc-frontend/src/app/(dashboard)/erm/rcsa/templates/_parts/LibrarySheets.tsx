'use client';

// The four small forms of the Templates library, each a kit Sheet: a new questionnaire, a clone, an upload of a questionnaire (a spreadsheet with one question a row), and an upload of an Excel
// register. Validation is said in words beside the field; a failed save is shown at the top of the sheet with what was typed kept and a Retry where retrying can help; Escape asks before it
// throws typed input away. A questionnaire that was made or cloned opens in its workspace, because that is what the person does next.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, FormError, FormField, Sheet, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { rcsaApi } from '@/lib/api';
import { cloneName } from '@/lib/rcsa/templatesModel';
import { KEYS } from '../../_parts/rcsaData';
import { FilePicker } from './FilePicker';

const footer = (cancel: () => void, submit: () => void, label: string, busy: boolean) => (
  <div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={cancel}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{label}</Button></div>
);

interface Made { id: number }

export function NewQuestionnaireSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Operational Risk');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const reset = () => { setName(''); setCategory('Operational Risk'); setDescription(''); setTouched(false); setProblem(null); };
  const close = () => { reset(); onClose(); };

  const create = useReportedMutation({
    mutationFn: async () => (await rcsaApi.createTemplate({ name: name.trim(), category: category.trim(), description: description.trim() || null, questions: [] })).data as Made,
    success: 'Questionnaire created. Add its questions now.',
    failure: "The questionnaire wasn't created",
    toast: 'success',
    retryable: false,
    invalidate: [KEYS.templates],
    onSuccess: (made) => { reset(); onClose(); router.push(`/erm/rcsa/templates/${made.id}`); },
    onError: (e) => setProblem(e),
  });
  const missing = { name: !name.trim(), category: !category.trim() };
  const submit = () => {
    setTouched(true);
    if (missing.name || missing.category) return;
    setProblem(null);
    create.mutate();
  };
  return (
    <Sheet open={open} onClose={close} title="New questionnaire" subtitle="You add the questions on the next screen." width="md" dirty={!!(name.trim() || description.trim()) && !create.isPending} footer={footer(close, submit, 'Create questionnaire', create.isPending)}>
      <div className="flex flex-col gap-[12px]">
        <FormError title="The questionnaire wasn't created" error={problem} onRetry={submit} />
        <FormField label="Name" required error={touched && missing.name ? 'Give the questionnaire a name.' : undefined}><TextInput value={name} maxLength={255} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Kind of risk" required error={touched && missing.category ? 'Say what kind of risk it covers, for example Operational Risk.' : undefined}><TextInput value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} /></FormField>
        <FormField label="Description" optional><Textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
      </div>
    </Sheet>
  );
}

export function CloneSheet({ open, template, onClose }: { open: boolean; template: { id: number; name: string; description?: string | null } | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const [seen, setSeen] = useState<number | null>(null);
  // a different questionnaire was picked: start from its own name
  if (template && seen !== template.id) { setSeen(template.id); setName(cloneName(template.name)); setDescription(template.description ?? ''); setTouched(false); setProblem(null); }
  const close = () => { setSeen(null); onClose(); };

  const clone = useReportedMutation({
    mutationFn: async () => (await rcsaApi.cloneTemplate((template as { id: number }).id, { name: name.trim(), description: description.trim() || null })).data as Made,
    success: 'Copy created. You can change it now.',
    failure: "The copy wasn't made",
    toast: 'success',
    retryable: false,
    invalidate: [KEYS.templates],
    onSuccess: (made) => { setSeen(null); onClose(); router.push(`/erm/rcsa/templates/${made.id}`); },
    onError: (e) => setProblem(e),
  });
  const submit = () => {
    setTouched(true);
    if (!name.trim()) return;
    setProblem(null);
    clone.mutate();
  };
  return (
    <Sheet open={open && !!template} onClose={close} title="Clone questionnaire" subtitle="Makes your own copy with the same questions, which you can change." width="md" dirty={!!template && (name !== cloneName(template.name) || description !== (template.description ?? '')) && !clone.isPending} footer={footer(close, submit, 'Create copy', clone.isPending)}>
      <div className="flex flex-col gap-[12px]">
        <FormError title="The copy wasn't made" error={problem} onRetry={submit} />
        <FormField label="Name of the copy" required error={touched && !name.trim() ? 'Give the copy a name.' : undefined}><TextInput value={name} maxLength={255} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Description" optional><Textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
      </div>
    </Sheet>
  );
}

export function UploadQuestionnaireSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Operational Risk');
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const reset = () => { setName(''); setCategory('Operational Risk'); setFile(null); setTouched(false); setProblem(null); };
  const close = () => { reset(); onClose(); };

  const upload = useReportedMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file as File);
      return (await rcsaApi.uploadTemplate(form, { name: name.trim(), category: category.trim() })).data as Made;
    },
    success: 'Questionnaire uploaded. Check its questions.',
    failure: "The file wasn't read",
    toast: 'success',
    retryable: false,
    invalidate: [KEYS.templates],
    onSuccess: (made) => { reset(); onClose(); router.push(`/erm/rcsa/templates/${made.id}`); },
    onError: (e) => setProblem(e),
  });
  const missing = { name: !name.trim(), category: !category.trim(), file: !file };
  const submit = () => {
    setTouched(true);
    if (missing.name || missing.category || missing.file) return;
    setProblem(null);
    upload.mutate();
  };
  return (
    <Sheet open={open} onClose={close} title="Upload a questionnaire" subtitle="A spreadsheet with one question on each row." width="md" dirty={!!(name.trim() || file) && !upload.isPending} footer={footer(close, submit, 'Upload', upload.isPending)}>
      <div className="flex flex-col gap-[12px]">
        <FormError title="The file wasn't read" error={problem} onRetry={submit} />
        <FormField label="Name" required error={touched && missing.name ? 'Give the questionnaire a name.' : undefined}><TextInput value={name} maxLength={255} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Kind of risk" required error={touched && missing.category ? 'Say what kind of risk it covers, for example Operational Risk.' : undefined}><TextInput value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} /></FormField>
        <FormField
          label="File"
          required
          hint="Excel (.xlsx, .xls) or CSV. The first row names the columns: question, section, type, required, guidance."
          error={touched && missing.file ? 'Choose the file to upload.' : undefined}
        >
          <FilePicker file={file} onChange={setFile} accept=".xlsx,.xls,.csv" />
        </FormField>
      </div>
    </Sheet>
  );
}

export function UploadRegisterSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [seed, setSeed] = useState(true);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const reset = () => { setFile(null); setName(''); setArea(''); setSheetName(''); setSeed(true); setTouched(false); setProblem(null); };
  const close = () => { reset(); onClose(); };

  const upload = useReportedMutation({
    mutationFn: async () => (await rcsaApi.customTemplates.upload(file as File, {
      name: name.trim() || undefined, function_area: area.trim() || undefined, sheet_name: sheetName.trim() || undefined, seed_from_file: seed,
    })).data as Made,
    success: () => ({ title: 'Register uploaded', message: seed ? 'Its items were filled from the file.' : 'It starts empty; add items one by one.' }),
    failure: "The register wasn't uploaded",
    toast: 'success',
    retryable: false,
    invalidate: [KEYS.registers],
    onSuccess: (made) => { reset(); onClose(); router.push(`/erm/rcsa/custom-templates/${made.id}`); },
    onError: (e) => setProblem(e),
  });
  const submit = () => {
    setTouched(true);
    if (!file) return;
    setProblem(null);
    upload.mutate();
  };
  return (
    <Sheet open={open} onClose={close} title="Upload an Excel register" subtitle="Your own spreadsheet becomes a register you can search, filter and assign." width="md" dirty={!!(file || name.trim() || area.trim()) && !upload.isPending} footer={footer(close, submit, 'Upload register', upload.isPending)}>
      <div className="flex flex-col gap-[12px]">
        <FormError title="The register wasn't uploaded" error={problem} onRetry={submit} />
        <FormField label="Excel file" required hint="An .xlsx workbook up to 25 MB. Two-row merged headers are recognised." error={touched && !file ? 'Choose the workbook to upload.' : undefined}>
          <FilePicker file={file} onChange={setFile} accept=".xlsx,.xlsm" />
        </FormField>
        <FormField label="Name" optional hint="Left empty, the workbook's own title is used."><TextInput value={name} maxLength={255} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Function area" optional hint="For example Information Security, Branch Operations or Treasury."><TextInput value={area} maxLength={255} onChange={(e) => setArea(e.target.value)} /></FormField>
        <FormField label="Sheet" optional hint="The sheet to read. Left empty, the first sheet is used."><TextInput value={sheetName} maxLength={255} onChange={(e) => setSheetName(e.target.value)} /></FormField>
        <Checkbox label="Fill the items from the file" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
      </div>
    </Sheet>
  );
}
