'use client';

// The top of the workspace: back to the library, the report's name (typed in place), what module it reads and whether it is saved, then the three things a person does with it: share, save, download.
// "Save a copy" and "New report" sit in a menu. Draws and calls; the save and download logic is ReportWorkspace's.
import type { MouseEvent } from 'react';
import { ArrowLeft, Lock, Save, Users } from 'lucide-react';
import { Button, Menu, type MenuItem } from '@/components/ui/ds';

export function WorkspaceHead({
  name, onName, moduleLine, shared, canShare, onShare, saving, status, onBack, onSave, onSaveAs, onNew, downloadItems, downloading,
}: {
  name: string;
  onName: (v: string) => void;
  moduleLine: string;
  shared: boolean;
  /** false for someone else's report: it cannot be shared, saving makes a copy */
  canShare: boolean;
  onShare: () => void;
  saving: boolean;
  status: { text: string; tone: 'muted' | 'warning' | 'success' };
  onBack: (e: MouseEvent) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onNew: () => void;
  downloadItems: MenuItem[];
  downloading: boolean;
}) {
  const more: MenuItem[] = [
    { key: 'copy', label: 'Save a copy', onSelect: onSaveAs },
    { key: 'new', label: 'Start a new report', onSelect: onNew },
  ];
  const tone = status.tone === 'warning' ? 'text-ds-warning' : status.tone === 'success' ? 'text-ds-success' : 'text-ds-fg-muted';
  return (
    <header className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
      <h1 className="sr-only">Report builder</h1>
      <Button href="/reports" variant="ghost" leftIcon={<ArrowLeft aria-hidden />} onClick={onBack}>Reports</Button>
      <div className="min-w-[220px] flex-1">
        <input
          aria-label="Report name"
          value={name}
          maxLength={120}
          placeholder="Name this report"
          onChange={(e) => onName(e.target.value)}
          className="h-ds-control w-full min-w-0 rounded-ds-control border border-transparent bg-transparent px-[8px] text-ds-title text-ds-fg placeholder:text-ds-fg-muted hover:border-ds-border-control focus-visible:outline-none focus-visible:shadow-ds-ring"
        />
        <p className="m-0 px-[8px] text-ds-label text-ds-fg-muted">{moduleLine}<span aria-hidden> · </span><span role="status" className={tone}>{status.text}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button aria-pressed={shared} disabled={!canShare} leftIcon={shared ? <Users aria-hidden /> : <Lock aria-hidden />} onClick={onShare} title={canShare ? (shared ? 'Everyone in the organisation can open this report. Click to keep it private.' : 'Only you can open this report. Click to share it with everyone in the organisation.') : 'This report belongs to someone else'}>
          {shared ? 'Shared' : 'Private'}
        </Button>
        <Button variant="primary" loading={saving} leftIcon={<Save aria-hidden />} onClick={onSave}>Save</Button>
        <Menu label="Download" items={downloadItems} disabled={downloading} align="end" />
        <Menu label="More actions" iconOnly items={more} />
      </div>
    </header>
  );
}
