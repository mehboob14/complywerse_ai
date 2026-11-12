'use client';

// An empty folder, as Explorer says it: an open yellow folder and "This folder is empty", with what to do next (the New button for someone who may add a unit; the (i) for the rest).
import type { ReactNode } from 'react';
import { InfoTip } from '@/components/ui/InfoTip';
import { FolderIcon } from './folderIcon';

export function EmptyFolder({ title, info, action }: { title: string; info?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-[24px] py-[32px] text-center">
      <FolderIcon size={64} open />
      <div className="mt-[8px] flex items-center justify-center gap-[4px]">
        <p className="text-ds-section text-ds-fg">{title}</p>
        {info && <InfoTip text={info} label={`About: ${title.toLowerCase()}`} />}
      </div>
      {action && <div className="mt-[16px] flex flex-wrap items-center justify-center gap-[8px]">{action}</div>}
    </div>
  );
}
