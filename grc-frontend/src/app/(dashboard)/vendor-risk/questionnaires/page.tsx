'use client';

// Questionnaires: what a supplier is asked, what it was sent, and what is reused. One page, three tabs in the address (?tab=): the Library (the questionnaires you can send, as cards or a list; the Tiering view is
// the onboarding questions, edited in Settings), Sent (everything sent to a supplier, as the facet explorer, with its answers in a drawer) and Shared (the Vendor Exchange, which used to be a page under
// Insights: publish a completed assessment, import one by token or package). The page draws the head and the strip; each tab owns its own state and is drawn only while it is open. The builder is
// /questionnaires/<id>/builder. The old Exchange address forwards here with its query.
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Download, Plus, Send, Share2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, TabPanel, Tabs, type TabItem } from '@/components/ui/ds';
import { routeFor } from '@/lib/navRegistry';
import { TAB_KEYS, TAB_LABEL, libraryHead, tabHref, tabOf, type TabKey } from '../_lib/questionnaires/hubModel';
import { headLine } from '../_lib/questionnaires/sentModel';
import { sharedHead } from '../_lib/questionnaires/sharedModel';
import { NewQuestionnaireSheet } from './_forms/NewQuestionnaireSheet';
import { useRights } from './_forms/useRights';
import { LibraryTab } from './_library/LibraryTab';
import { useTemplates } from './_library/useTemplates';
import { SendSheet } from './_sent/SendSheet';
import SentTab from './_sent/SentTab';
import { useSent, useShared } from './_sent/sentApi';
import { ImportSheet, PublishSheet } from './_shared/SharedSheets';
import SharedTab from './_shared/SharedTab';

const INFO: Record<TabKey, string> = {
  library: 'The questionnaires you can send. Suppliers answer them in the portal; the answers set the residual score and raise findings.',
  sent: 'Every questionnaire sent to a supplier: where it stands, what was answered and its link. Open one to read the answers.',
  shared: 'Reuse a completed assessment: publish it once, share it by token, or export it as a package. Imported answers are re-scored with your own engine.',
};
const TABS: TabItem[] = TAB_KEYS.map((key) => ({ key, label: TAB_LABEL[key] }));

export default function QuestionnairesPage() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const label = routeFor('/vendor-risk/questionnaires')?.label ?? 'Questionnaires';
  const rights = useRights();

  // the open tab is the address's; what the person picks shows at once and the address follows. A tab starts clean: it carries none of another tab's search or filters.
  const [picked, setPicked] = useState<TabKey | null>(null);
  useEffect(() => { setPicked(null); }, [search]);
  const tab = picked ?? tabOf(search);
  const select = (key: TabKey) => { setPicked(key); router.replace(tabHref(pathname, key), { scroll: false }); };

  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<{ templateId: number | null } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [importing, setImporting] = useState(false);

  const templates = useTemplates();
  const sent = useSent(tab === 'sent');
  const shared = useShared(tab === 'shared');
  const items = templates.data?.items;
  const tiering = new URLSearchParams(search).get('purpose') === 'tiering';

  const meta = tab === 'library' ? (items ? libraryHead(items) : undefined)
    : tab === 'sent' ? (sent.data ? headLine(sent.data.items, new Date()) : undefined)
      : (shared.data ? sharedHead(shared.data.items) : undefined);
  const actions = tab === 'library' ? (rights.create && !tiering ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>New questionnaire</Button> : null)
    : tab === 'sent' ? (rights.send ? <Button variant="primary" leftIcon={<Send aria-hidden />} onClick={() => setSending({ templateId: null })}>Send a questionnaire</Button> : null)
      : (rights.resend ? (
        <>
          <Button leftIcon={<Download aria-hidden />} onClick={() => setImporting(true)}>Import</Button>
          <Button variant="primary" leftIcon={<Share2 aria-hidden />} onClick={() => setPublishing(true)}>Publish</Button>
        </>
      ) : null);

  return (
    <div className="flex min-h-full flex-col gap-[16px]">
      <PageHeader variant="page" title={label} info={INFO[tab]} meta={meta} actions={actions} />
      <Tabs tabs={TABS} value={tab} onChange={select} ariaLabel="Questionnaires">
        <TabPanel tabKey="library" className="pt-[16px]">
          {tab === 'library' && (
            <LibraryTab
              templates={items ?? []} total={templates.data?.total} loading={templates.isLoading}
              error={templates.isError ? templates.error : undefined} onRetry={() => { void templates.refetch(); }}
              rights={rights} onSend={(t) => setSending({ templateId: t.id })} onNew={() => setCreating(true)}
            />
          )}
        </TabPanel>
        <TabPanel tabKey="sent" className="pt-[16px]">{tab === 'sent' && <SentTab list={sent} label={`${label}: sent`} rights={rights} onSend={() => setSending({ templateId: null })} />}</TabPanel>
        <TabPanel tabKey="shared" className="pt-[16px]">{tab === 'shared' && <SharedTab list={shared} rights={rights} onPublish={() => setPublishing(true)} />}</TabPanel>
      </Tabs>

      <NewQuestionnaireSheet open={creating} templates={items ?? []} onClose={() => setCreating(false)} />
      <SendSheet open={!!sending} templates={items ?? []} templateId={sending?.templateId ?? null} onClose={() => setSending(null)} />
      <PublishSheet open={publishing} onClose={() => setPublishing(false)} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
