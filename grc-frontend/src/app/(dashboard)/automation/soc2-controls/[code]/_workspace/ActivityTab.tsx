'use client';

// The Activity tab: who changed what on this control, newest first, in words (ownership, applicability, testing, evidence, links). The server keeps the latest 100 changes and says nothing about
// the rest, so a full list says it was cut. A person with no name is "Someone", never a number.
import { Notice, SectionCard } from '@/components/ui/ds';
import { EmptyState } from '@/components/ui/ds';
import { formatDateTime } from '@/lib/format';
import { Loaded, Small } from './parts';
import { feedIsCut, feedOf } from './workspaceModel';
import { useHistory } from './workspaceData';
import { useWorkspace } from './workspaceContext';

export function ActivityTab() {
  const { d, code } = useWorkspace();
  const q = useHistory(d.scope_id, code);
  if (!d.scope_id) return <EmptyState kind="firstUse" bare title="Changes are kept once your scope is set up" description="Choose your frameworks first; ownership, applicability and testing are recorded within a scope." />;
  return (
    <SectionCard id="activity" title="Activity" info="Ownership, applicability, testing and evidence changes on this control.">
      <Loaded q={q} what="the changes" rows={5}>
        {(events) => {
          const rows = feedOf(events);
          if (rows.length === 0) return <EmptyState kind="firstUse" bare title="Nothing has changed yet" description="Changes to this control are recorded here." />;
          return (
            <div className="flex flex-col gap-[10px]">
              {feedIsCut(events) && <Notice tone="info">These are the latest 100 changes. Older ones are kept in the audit log.</Notice>}
              <ol className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
                {rows.map((r) => (
                  <li key={r.key} className="px-[12px] py-[8px]">
                    <p className="break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{r.what}</p>
                    <Small>{`${r.who} · ${formatDateTime(r.at)}`}</Small>
                  </li>
                ))}
              </ol>
            </div>
          );
        }}
      </Loaded>
    </SectionCard>
  );
}
