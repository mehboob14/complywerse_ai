'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { certificationsApi } from '@/lib/api';
import {
  ArrowLeft,
  Shield,
  LayoutDashboard,
  ListChecks,
  FileBadge,
  Share2,
  Check,
} from 'lucide-react';

import OverviewTab from './_tabs/OverviewTab';
import ControlsTab from './_tabs/ControlsTab';
import EvidenceTab from './_tabs/EvidenceTab';
// Other tab component files (Documents, Risks, RiskAssessment, Assets,
// Vulnerabilities, Vendors, Exceptions, AuditTrail) are kept on disk for
// future restoration but are not wired to the tab bar.

type TabKey =
  | 'overview'
  | 'controls'
  | 'evidence';

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'controls', label: 'Controls', icon: ListChecks },
  { key: 'evidence', label: 'Evidence', icon: FileBadge },
];

export default function AuditorPortalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const frameworkId = params.frameworkId as string;

  // Initial tab seeded from ?tab=... so URLs are shareable per-section.
  // Validate against the trimmed TabKey set so legacy bookmarks (?tab=risks
  // / ?tab=audit-trail / etc.) gracefully fall back to overview instead of
  // rendering a blank panel.
  const validKeys: TabKey[] = ['overview', 'controls', 'evidence'];
  const rawTab = searchParams.get('tab');
  const initialTab: TabKey = (rawTab && (validKeys as string[]).includes(rawTab)) ? (rawTab as TabKey) : 'overview';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [shareCopied, setShareCopied] = useState(false);

  // Journey/framework picker — same approach as the previous page.
  const { data: journeysList } = useQuery({
    queryKey: ['auditor-frameworks'],
    queryFn: async () => {
      const response = await certificationsApi.getAll();
      return response.data as Array<{
        id: number;
        name?: string;
        framework?: { name?: string; short_code?: string };
        framework_name?: string;
        uploaded_framework_id?: number;
        framework_id?: number;
        status?: string;
      }>;
    },
  });

  const currentJourney = useMemo(() => {
    const list = journeysList || [];
    return list.find((j) => String(j.id) === String(frameworkId));
  }, [journeysList, frameworkId]);

  const frameworkLabel =
    currentJourney?.framework?.name ||
    currentJourney?.framework_name ||
    currentJourney?.name ||
    'Framework';

  const handleTabClick = (tab: TabKey) => {
    setActiveTab(tab);
    // Keep the URL in sync so an auditor can copy/share the exact view
    // they're looking at without losing their tab selection.
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url);
  };

  const handleShare = async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeTab);
      await navigator.clipboard.writeText(url.toString());
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch {
      // Clipboard unavailable; silently no-op rather than alarming the user.
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewTab
            frameworkId={frameworkId}
            onJumpTab={(t) => {
              // The Overview tab may emit jumps to legacy keys (risks, documents,
              // assets, ...) that we no longer expose. Re route those to Controls
              // or Evidence which still surface the relevant data.
              const next = t === 'evidence' ? 'evidence'
                : t === 'controls' ? 'controls'
                : 'overview';
              handleTabClick(next as TabKey);
            }}
          />
        );
      case 'controls': return <ControlsTab frameworkId={frameworkId} />;
      case 'evidence': return <EvidenceTab frameworkId={frameworkId} />;
      default: return <OverviewTab frameworkId={frameworkId} />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/auditor-portal')}
            className="rounded-lg bg-white border border-slate-300 p-2 hover:bg-slate-50 transition-colors"
            title="Back to portal index"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            <div>
              <h1 className="text-lg font-semibold text-slate-900 leading-tight">{frameworkLabel}</h1>
              <p className="text-xs text-slate-500">
                Auditor portal
                {currentJourney?.status && (
                  <span> • {currentJourney.status.replace(/_/g, ' ')}</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Framework / journey switcher + share */}
        <div className="flex items-center gap-2">
          <select
            value={frameworkId}
            onChange={(e) => {
              const newId = e.target.value;
              const url = new URL(window.location.href);
              url.pathname = `/auditor-portal/${newId}`;
              router.push(`${url.pathname}${url.search}`);
            }}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {(journeysList || []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.framework?.name || j.framework_name || j.name || `Framework ${j.id}`}
              </option>
            ))}
          </select>
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title="Copy a shareable link to this view"
          >
            {shareCopied ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" />
                Copied
              </>
            ) : (
              <>
                <Share2 className="h-4 w-4" />
                Share
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tab nav */}
      <div className="overflow-x-auto border-b border-slate-200">
        <nav className="flex gap-1 min-w-max">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => handleTabClick(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Active tab content */}
      <div>{renderTab()}</div>
    </div>
  );
}
