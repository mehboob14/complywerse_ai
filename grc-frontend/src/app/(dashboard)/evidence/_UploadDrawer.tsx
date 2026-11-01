'use client';

/**
 * Upload evidence: attach a file and capture its details in one step. A right-hand panel of the kit (focus in and back, Escape, and "Discard changes?" when something
 * is typed or chosen). The file is chosen with a real file input behind a visible button, so the keyboard reaches it (it was a clickable box that no key could
 * press); a dropped file is checked the same way. The form sends exactly what it always sent (uploadModel.ts, tested); a failed upload is said here in the server's
 * words with the form kept, and Retry when repeating can help.
 */
import { useCallback, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileCheck, Loader2, Upload } from 'lucide-react';
import { assetsApi, evidenceAIApi } from '@/lib/api';
import type { ITAsset } from '@/types';
import { RightSlidePanel } from '@/components/ui';
import { Button, Combobox, FormField, MultiSelect, Notice, Select, TabPanel, Tabs, TextInput, Textarea } from '@/components/ui/ds';
import { buttonClasses } from '@/components/ui/ds/buttonStyles';
import {
  CustomFieldsTab, builtinLabel, listOptions, liveFields, showBuiltin, useModuleSettings, valuesToSave, type CustomValues,
} from '@/components/settings/CustomFields';
import { ACCEPT, DEFAULT_VALIDITY, NAME_MAX, TYPES_SAID, VALIDITY_PRESETS, fileProblem, fileSize, nameFromFile, uploadFields } from './uploadModel';
import { typeLabel } from './_workspace/evidenceModel';

export interface EvidenceType { value: string; label: string }
const MUTED = 'text-ds-fg-muted';
type AiState = 'idle' | 'loading' | 'done' | 'failed';

export function UploadDrawer({ onClose, onUpload, isLoading, error, onRetry, evidenceTypes }: {
  onClose: () => void;
  onUpload: (formData: FormData, linkedAssetIds: number[]) => void;
  isLoading: boolean;
  /** the server's words when the last attempt failed (the form is kept) */
  error?: string | null;
  /** shown with the failure when trying again can help */
  onRetry?: () => void;
  evidenceTypes: EvidenceType[];
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceType, setEvidenceType] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [validityPreset, setValidityPreset] = useState<string>(DEFAULT_VALIDITY);
  const [validityCustomDays, setValidityCustomDays] = useState('');
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [linkedAssetIds, setLinkedAssetIds] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [ai, setAi] = useState<AiState>('idle');
  const [tab, setTab] = useState<'details' | 'custom'>('details');
  const [customValues, setCustomValues] = useState<CustomValues>({});
  const input = useRef<HTMLInputElement>(null);
  const { data: fieldSettings } = useModuleSettings('evidence');

  // Owner picker source: tenant users. Asset list for the source-system / linked-assets picker.
  const { data: tenantUsers = [] } = useQuery({ queryKey: ['tenant-users-evidence'], queryFn: async () => (await assetsApi.getTenantUsers()).data, staleTime: 5 * 60 * 1000 });
  const { data: assets = [] } = useQuery({ queryKey: ['assets-evidence-link'], queryFn: async () => ((await assetsApi.getAll()).data || []) as ITAsset[], staleTime: 5 * 60 * 1000 });
  const ownerOptions = useMemo(() => tenantUsers.map((u) => ({ value: String(u.id), label: u.display_name, description: u.email })), [tenantUsers]);
  const assetOptions = useMemo(() => assets.map((a) => ({ value: String(a.id), label: a.name, description: a.asset_type ? String(a.asset_type) : undefined })), [assets]);
  const typeOptions = listOptions(fieldSettings, 'evidence_type', evidenceType, evidenceTypes);
  const customCount = liveFields(fieldSettings).length;

  const runQuickAssessment = useCallback(async (fileName: string, fileType: string, evidenceName: string, desc: string, evType: string) => {
    setAi('loading');
    try {
      const response = await evidenceAIApi.quickAssess({
        evidence_name: evidenceName || nameFromFile(fileName), file_name: fileName, file_type: fileType, description: desc || undefined, evidence_type: evType || undefined,
      });
      if (response.initial_assessment.suggested_type && !evType) {
        setEvidenceType(response.initial_assessment.suggested_type);
        setAi('done');
      } else setAi('idle');
    } catch {
      setAi('failed');
    }
  }, []);

  /** Takes a file from the chooser or the drop zone: an executable is refused; the name starts as the file's; the AI suggests a type. */
  const takeFile = (picked: File): boolean => {
    const problem = fileProblem(picked.name);
    if (problem) { setFileError(problem); return false; }
    setFileError(null);
    setFile(picked);
    const derived = nameFromFile(picked.name);
    if (!name) setName(derived.slice(0, NAME_MAX));
    void runQuickAssessment(picked.name, picked.type, name || derived, description, evidenceType);
    return true;
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) takeFile(dropped);
  };

  const dirty = !!file || name !== '' || description !== '' || evidenceType !== '' || collectionDate !== '' || ownerId !== null || linkedAssetIds.length > 0
    || validityPreset !== DEFAULT_VALIDITY || Object.keys(customValues).length > 0;
  const nameMissing = name.trim() === '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || nameMissing) { setTried(true); return; }
    const formData = new FormData();
    uploadFields({
      name, description, evidenceType, collectionDate, validityPreset, validityCustomDays, ownerId, linkedAssetIds, assets: assets.map((a) => ({ id: a.id, name: a.name })),
      custom: valuesToSave(fieldSettings, customValues, null),
    }).forEach(([key, value]) => formData.append(key, value));
    formData.append('file', file);
    onUpload(formData, linkedAssetIds);
  };

  const details = (
    <div data-tab="details" className="flex flex-col gap-[16px]">
      <div
        role="group" aria-label="File"
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }} onDrop={onDrop}
        className={`flex flex-col items-center gap-[8px] rounded-ds-card border border-dashed p-[16px] text-center ${isDragging ? 'border-ds-primary bg-ds-primary-soft' : file ? 'border-ds-success bg-ds-success-soft' : 'border-ds-border-strong bg-ds-surface'}`}
      >
        {file ? <FileCheck aria-hidden className="h-[32px] w-[32px] text-ds-success" strokeWidth={1.75} /> : <Upload aria-hidden className={`h-[32px] w-[32px] ${MUTED}`} strokeWidth={1.75} />}
        {file ? (
          <>
            <p className="max-w-full break-words text-ds-body font-[600] text-ds-fg">{file.name}</p>
            <p className={`text-ds-label ${MUTED}`}>{fileSize(file.size)}</p>
          </>
        ) : (
          <p className="text-ds-body text-ds-fg-body">Drag a file here, or</p>
        )}
        <label className="relative inline-flex">
          <input ref={input} type="file" accept={ACCEPT} className="peer sr-only" onChange={(e) => { const picked = e.target.files?.[0]; if (picked && !takeFile(picked)) e.target.value = ''; }} />
          <span className={`${buttonClasses({ variant: 'secondary' })} cursor-pointer peer-focus-visible:shadow-ds-ring`}>{file ? 'Choose another file' : 'Choose a file'}</span>
        </label>
        {!file && <p className={`text-ds-label ${MUTED}`}>{TYPES_SAID}</p>}
        {fileError && <p role="alert" className="break-words text-ds-body text-ds-danger">{fileError}</p>}
        {tried && !file && !fileError && <p role="alert" className="text-ds-body text-ds-danger">Choose the file to upload.</p>}
      </div>

      <FormField label={builtinLabel(fieldSettings, 'name', 'Name')} required error={tried && nameMissing ? 'Enter a name.' : undefined}>
        <TextInput value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Evidence name" required />
      </FormField>

      {showBuiltin(fieldSettings, 'description') && (
        <FormField label={builtinLabel(fieldSettings, 'description', 'Description')} optional>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe this evidence" />
        </FormField>
      )}

      <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
        {showBuiltin(fieldSettings, 'evidence_type') && (
          <FormField
            label={builtinLabel(fieldSettings, 'evidence_type', 'Evidence type')} optional
            hint={ai === 'loading' ? 'The AI is suggesting a type…' : ai === 'failed' ? 'No AI suggestion. Choose the type yourself.' : ai === 'done' ? `Suggested by AI: ${typeLabel(evidenceType)}.` : undefined}
          >
            <Select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} placeholder="Select a type">
              {typeOptions.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </Select>
          </FormField>
        )}
        {showBuiltin(fieldSettings, 'owner') && (
          <FormField label={builtinLabel(fieldSettings, 'owner', 'Owner')} optional>
            <Combobox label="Owner" placeholder="Select an owner" searchPlaceholder="Search people" clearable options={ownerOptions} value={ownerId ? String(ownerId) : null} onChange={(v) => setOwnerId(v ? Number(v) : null)} />
          </FormField>
        )}
        {showBuiltin(fieldSettings, 'collection_date') && (
          <FormField label={builtinLabel(fieldSettings, 'collection_date', 'Collection date')} optional hint="The expiry date is worked out from this day and the validity period. Without it the file has no expiry.">
            <TextInput type="date" value={collectionDate} onChange={(e) => setCollectionDate(e.target.value)} />
          </FormField>
        )}
        {showBuiltin(fieldSettings, 'validity') && (
          <div className="flex flex-col gap-[8px]">
            <FormField label={builtinLabel(fieldSettings, 'validity', 'Validity period')} optional>
              <Select value={validityPreset} onChange={(e) => setValidityPreset(e.target.value)}>
                {VALIDITY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </FormField>
            {validityPreset === 'custom' && <TextInput type="number" min="1" unit="days" aria-label="Validity in days" value={validityCustomDays} onChange={(e) => setValidityCustomDays(e.target.value)} placeholder="Number of days" />}
          </div>
        )}
      </div>

      {showBuiltin(fieldSettings, 'source') && (
        <FormField label={builtinLabel(fieldSettings, 'source', 'Source system / linked assets')} optional hint="Pick the assets this evidence came from. You can link more later from the evidence page.">
          <MultiSelect
            label="Linked assets" placeholder="Search assets to link" searchPlaceholder="Search by name or type" searchable options={assetOptions}
            value={linkedAssetIds.map(String)} onChange={(v) => setLinkedAssetIds(v.map(Number))}
          />
        </FormField>
      )}
    </div>
  );

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title="Upload evidence"
      subtitle="Attach a file and capture its details in one step."
      width="w-full max-w-xl"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="evidence-upload-form" variant="primary" loading={isLoading} leftIcon={isLoading ? <Loader2 aria-hidden /> : <Upload aria-hidden />}>Upload evidence</Button>
        </div>
      )}
    >
      <form
        id="evidence-upload-form" className="flex flex-col gap-[16px]" onSubmit={submit}
        onInvalidCapture={(e) => { const held = (e.target as HTMLElement | null)?.closest?.('[data-tab]')?.getAttribute('data-tab'); setTab(held === 'custom' ? 'custom' : 'details'); }}
      >
        {error && (
          <Notice tone="danger" title="The file was not uploaded" action={onRetry ? <Button size="sm" onClick={onRetry} loading={isLoading}>Retry</Button> : undefined}>{error}</Notice>
        )}
        <Tabs ariaLabel="Evidence form" value={tab} onChange={setTab} tabs={[{ key: 'details', label: 'Details' }, { key: 'custom', label: 'Custom fields', count: customCount > 0 ? customCount : undefined }]}>
          <div className="pt-[16px]">
            <TabPanel tabKey="details">{details}</TabPanel>
            <TabPanel tabKey="custom"><div data-tab="custom"><CustomFieldsTab moduleKey="evidence" values={customValues} onChange={setCustomValues} /></div></TabPanel>
          </div>
        </Tabs>
      </form>
    </RightSlidePanel>
  );
}
