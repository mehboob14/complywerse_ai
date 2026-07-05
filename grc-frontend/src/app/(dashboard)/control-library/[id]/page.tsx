'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import apiClient from '@/lib/api';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import {
  ChevronLeft, Layers, Shield, FileText, Download, X, CheckCircle2, ChevronDown,
  Loader2, Boxes, GitMerge, Library, Network, FileStack, Sparkles, Building2,
  Search, LayoutGrid, List, ArrowRight, Upload, Filter, Check,
} from 'lucide-react';

const SF: [string, string][] = [
  ['ARAMCO', 'ARAMCO'], ['COBIT', 'COBIT'], ['Health Information', 'DOH ADHIE'], ['ADHIE', 'DOH ADHIE'],
  ['Abu Dhabi', 'ADHICS'], ['DOH', 'DOH ADHIE'], ['HIPAA', 'HIPAA'], ['HITRUST', 'HITRUST'], ['22301', 'ISO 22301'],
  ['42001', 'ISO 42001'], ['27001', 'ISO 27001'], ['MAS', 'MAS TRM'], ['Artificial Intelligence', 'NIST AI RMF'],
  ['800-53', 'NIST 800-53'], ['Cybersecurity Framework', 'NIST CSF'], ['PCI', 'PCI DSS'], ['Qatar', 'Qatar CB'],
  ['SABIC', 'SABIC'], ['SAMA', 'SAMA'], ['SBP Cloud', 'SBP Cloud'], ['ETGRMF', 'SBP ETGRMF'],
  ['Internet Banking', 'SBP IB'], ['SOX', 'SOX'], ['SWIFT', 'SWIFT'], ['Sri Lanka', 'Sri Lanka'],
  ['Personal Data Transfer', 'KSA Transfer'], ['CIS', 'CIS'], ['General Data', 'GDPR'],
  ['National Data', 'KSA NDMO'], ['Digital Operational', 'DORA'], ['NIS2', 'NIS2'], ['SOC', 'SOC 2'],
];
const sf = (f: string) => { for (const [k, v] of SF) if ((f || '').includes(k)) return v; return (f || '').split(' ')[0]; };

interface Member { framework: string; control_id: string; original_title: string; reference?: string; }
interface Ev { name: string; absorbs?: string[]; sources?: string[]; }
interface Art { name: string; type?: string; sources?: string[]; }
interface SetT {
  set_id: string; normalized_title: string; member_count: number; frameworks: string[];
  members: Member[]; normalized_evidence: Ev[]; excluded_evidence?: { name: string; reason: string }[];
  normalized_artifacts: Art[]; nc_id?: number;
}
interface Rich {
  domain: string; controls_in: number; frameworks: string[]; framework_count: number;
  absent_frameworks: { name: string; reason: string; present_in?: string[]; present_in_count?: number }[];
  framework_catalog_artifacts: { framework: string; note: string; artifacts: Art[] }[];
  normalized_sets: number; standalone: number; sets: SetT[]; standalone_controls: SetT[];
}

function StatCard({ value, label, sub, tone = 'primary', icon }: { value: ReactNode; label: string; sub: string; tone?: 'primary' | 'slate'; icon: ReactNode }) {
  const bar = tone === 'slate' ? 'bg-slate-400' : 'bg-primary-600';
  const chip = tone === 'slate' ? 'bg-slate-100 text-slate-600' : 'bg-primary-50 text-primary-600';
  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className={`absolute inset-x-0 top-0 h-1 ${bar}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-none text-slate-900 tabular-nums">{value}</p>
          <p className="mt-1.5 text-xs font-semibold text-slate-600">{label}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${chip} shadow-sm transition-transform group-hover:scale-105`}>{icon}</span>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}

export default function CategoryDetail() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const [data, setData] = useState<Rich | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'sets' | 'standalone' | 'byframework'>('sets');
  const [selectedFw, setSelectedFw] = useState<string[]>(() => {
    const fw = searchParams?.get('fw');           // carried over from the main library page
    return fw ? fw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }); // [] = all frameworks
  const [showFwFilter, setShowFwFilter] = useState(false);
  const [bfFw, setBfFw] = useState<string>(''); // active framework in the By-framework view
  const [openSet, setOpenSet] = useState<SetT | null>(null);
  const [panelTab, setPanelTab] = useState<'members' | 'evidence' | 'artifacts' | 'upload'>('members');
  const [uploads, setUploads] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const loadUploads = (nc?: number) => {
    if (!nc) { setUploads([]); return; }
    apiClient.get(`/control-library/groups/normalized/${nc}/evidence`)
      .then((r) => setUploads(r.data.items || [])).catch(() => setUploads([]));
  };
  useEffect(() => { if (openSet?.nc_id && panelTab === 'upload') loadUploads(openSet.nc_id); }, [openSet, panelTab]);

  const handleUpload = async (file: File) => {
    if (!openSet?.nc_id) { setUploadMsg('This set is not linked to a control id.'); return; }
    setUploading(true); setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name);
      const r = await apiClient.post(`/control-library/groups/normalized/${openSet.nc_id}/evidence`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setUploadMsg(r.data?.message || 'Uploaded and linked.');
      loadUploads(openSet.nc_id);
    } catch (e: any) {
      setUploadMsg(e?.response?.data?.detail || 'Upload failed.');
    } finally { setUploading(false); }
  };
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [fwGroup, setFwGroup] = useState<string | null>(null);
  const [showAbsent, setShowAbsent] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiClient.get(`/control-library/groups/${id}/rich`)
      .then((r) => setData(r.data as Rich))
      .catch((e) => setErr(e?.response?.data?.detail || 'Failed to load category'));
  }, [id]);

  const totals = useMemo(() => {
    if (!data) return { ev: 0, art: 0, dedup: 0 };
    const ev = data.sets.reduce((a, s) => a + (s.normalized_evidence?.length || 0), 0);
    const art = data.sets.reduce((a, s) => a + (s.normalized_artifacts?.length || 0), 0)
      + (data.standalone_controls?.reduce((a, s) => a + (s.normalized_artifacts?.length || 0), 0) || 0);
    // controls collapsed by normalization = members-in-sets minus number-of-sets
    const membersInSets = data.sets.reduce((a, s) => a + s.member_count, 0);
    const dedup = membersInSets - data.normalized_sets;
    return { ev, art, dedup };
  }, [data]);

  // The library's artifacts are document specifications (name/type/sources), not
  // stored files — so we generate a real, Word-openable .doc starter template.
  const download = (a: Art) => {
    const esc = (s: unknown) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
    const typeLabel = a.type || 'Document';
    const html =
      `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
      `<head><meta charset="utf-8"><title>${esc(a.name)}</title></head>` +
      `<body style="font-family:Calibri,Arial,sans-serif;color:#1e293b;line-height:1.5;">` +
      `<h1 style="color:#0f766e;margin-bottom:4px;">${esc(a.name)}</h1>` +
      `<p style="margin-top:0;"><b>Artifact type:</b> ${esc(typeLabel)}<br><b>Domain:</b> ${esc(data?.domain || '')}` +
      (a.sources?.length ? `<br><b>Maps to:</b> ${esc(a.sources.join('; '))}` : '') + `</p><hr>` +
      `<h2>Purpose</h2><p>This is the <b>${esc(a.name)}</b> required to satisfy the related control(s). Replace the guidance below with your organisation's actual content.</p>` +
      `<h2>1. Scope</h2><p>[Describe what this ${esc(typeLabel.toLowerCase())} covers.]</p>` +
      `<h2>2. Content</h2><p>[Add the ${esc(typeLabel.toLowerCase())} content here.]</p>` +
      `<h2>3. Ownership &amp; Review</h2><p>Owner: ____________&nbsp;&nbsp;&nbsp;Approved by: ____________&nbsp;&nbsp;&nbsp;Review cycle: ____________</p>` +
      `<p style="color:#94a3b8;font-size:10pt;">Generated from the Unified Control Library as a starter template — this is a blank document to fill in, not pre-filled evidence.</p>` +
      `</body></html>`;
    const blob = new Blob(['﻿', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${(a.name || 'artifact').replace(/[^a-z0-9]+/gi, '_')}.doc`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const chip = 'inline-block text-[11px] font-medium text-primary-800 border border-primary-200 bg-primary-50 rounded px-1.5 py-0.5';
  const tag = 'inline-block text-[11px] border border-slate-300 text-slate-500 rounded px-1.5 py-0.5';

  if (err) return (
    <div className="space-y-4">
      <button onClick={() => router.push('/control-library')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-primary-700"><ChevronLeft size={15} />Control Library</button>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{err}</div>
    </div>
  );
  if (!data) return <div className="flex items-center gap-2 p-10 text-slate-400"><Loader2 className="animate-spin" size={18} />Loading category…</div>;

  // ── framework filter ("Build your view") ──────────────────────────────
  const fwAll = Array.from(new Set(data.frameworks.map(sf))).sort();
  // Frameworks NOT in this domain (no controls of this control-type) — shown
  // disabled in the Build-your-view picker so nothing looks "missing".
  const fwAbsent = Array.from(new Set((data.absent_frameworks || []).map((a) => sf(a.name))))
    .filter((f) => !fwAll.includes(f)).sort();
  const filterOn = selectedFw.length > 0;
  const fwOn = (f: string) => !filterOn || selectedFw.includes(f);
  const setHasFw = (s: SetT) => !filterOn || s.frameworks.some((f) => selectedFw.includes(sf(f)));

  // Scope a SET to the active filter. We KEEP all members (so a normalized set
  // still shows the full cross-framework mapping — your frameworks highlighted,
  // the rest shown as "also normalized with"), but scope evidence/artifacts to
  // your frameworks (their `sources` are like "SAMA Cyber Security Framework 3.1.1").
  const srcInSel = (src: string) => selectedFw.includes(sf(src));
  const scopeSet = (s: SetT): SetT => {
    if (!filterOn) return s;
    const normalized_evidence = (s.normalized_evidence || []).filter((e) => !e.sources?.length || e.sources.some(srcInSel));
    const normalized_artifacts = (s.normalized_artifacts || []).filter((a) => !a.sources?.length || a.sources.some(srcInSel));
    return { ...s, normalized_evidence, normalized_artifacts };
  };
  // How many of a set's controls belong to YOUR frameworks (for the scoped counts).
  const selMembers = (s: SetT) => filterOn ? s.members.filter((m) => selectedFw.includes(sf(m.framework))).length : s.member_count;

  // sets / standalone after the framework filter (graceful — nothing is dropped, only hidden)
  const fSets = data.sets.filter(setHasFw).map(scopeSet);
  const fStd = data.standalone_controls.filter((s) => fwOn(sf(s.members[0]?.framework || '')));

  const stdByFw: Record<string, SetT[]> = {};
  fStd.forEach((s) => { const f = sf(s.members[0]?.framework || ''); (stdByFw[f] ||= []).push(s); });
  const stdFwList = Object.entries(stdByFw).sort((a, b) => b[1].length - a[1].length);
  const grp = (fwGroup && stdByFw[fwGroup]) ? fwGroup : (stdFwList[0]?.[0] ?? '');

  // ── by-framework grouping (each framework's controls in this domain) ───
  const byFw: Record<string, { control_id: string; title: string; set: string | null }[]> = {};
  data.sets.forEach((s) => s.members.forEach((m) => {
    (byFw[sf(m.framework)] ||= []).push({ control_id: m.control_id, title: m.original_title, set: s.normalized_title });
  }));
  data.standalone_controls.forEach((s) => { const m = s.members[0]; if (m) (byFw[sf(m.framework)] ||= []).push({ control_id: m.control_id, title: m.original_title, set: null }); });
  const byFwList = Object.entries(byFw).filter(([f]) => fwOn(f)).sort((a, b) => b[1].length - a[1].length);
  const bfActive = (bfFw && byFw[bfFw] && fwOn(bfFw)) ? bfFw : (byFwList[0]?.[0] ?? '');

  // Headline stat cards react to the filter (count sets + standalone after scoping).
  const sEv = fSets.reduce((a, s) => a + (s.normalized_evidence?.length || 0), 0) + fStd.reduce((a, s) => a + (s.normalized_evidence?.length || 0), 0);
  const sArt = fSets.reduce((a, s) => a + (s.normalized_artifacts?.length || 0), 0) + fStd.reduce((a, s) => a + (s.normalized_artifacts?.length || 0), 0);
  const sControls = fSets.reduce((a, s) => a + selMembers(s), 0) + fStd.length;
  const stat = {
    controls: filterOn ? sControls : data.controls_in,
    frameworks: filterOn ? byFwList.length : data.framework_count,
    sets: filterOn ? fSets.length : data.normalized_sets,
    standalone: filterOn ? fStd.length : data.standalone,
    ev: filterOn ? sEv : totals.ev,
    art: filterOn ? sArt : totals.art,
  };
  // Banner framework chips also follow the filter (no unselected framework on screen).
  const bannerFrameworks = filterOn ? data.frameworks.filter((f) => selectedFw.includes(sf(f))) : data.frameworks;

  return (
    <div className="space-y-5">
      <button onClick={() => router.push('/control-library')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-primary-700"><ChevronLeft size={14} />All control domains</button>

      {/* ── Domain banner (grouping) ─────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-primary-600 p-6 text-white shadow-sm">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25"><Layers size={24} /></span>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-primary-100">Control domain · grouping</div>
              <h1 className="text-2xl font-bold leading-tight">{data.domain}</h1>
              <p className="mt-1 max-w-2xl text-sm text-primary-50/90">
                {data.controls_in} controls from {data.framework_count} frameworks are grouped under this domain — {data.normalized_sets} requirements normalized across frameworks, {data.standalone} unique to a single framework.
              </p>
              {filterOn && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11.5px] font-medium ring-1 ring-white/25">
                  <Filter className="h-3 w-3" />
                  Filtered to {selectedFw.length} framework{selectedFw.length === 1 ? '' : 's'} · {fSets.length} sets · {fStd.length} standalone
                  <button onClick={() => setSelectedFw([])} className="ml-1 rounded-full bg-white/20 px-1.5 hover:bg-white/30">clear</button>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {bannerFrameworks.slice(0, 8).map((f) => <span key={f} className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium ring-1 ring-white/20">{sf(f)}</span>)}
            {bannerFrameworks.length > 8 && <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] ring-1 ring-white/15">+{bannerFrameworks.length - 8}</span>}
          </div>
        </div>
      </div>

      {/* ── Dashboard stat cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard value={stat.controls} label="Controls grouped" sub={filterOn ? `In your ${selectedFw.length}-framework view` : 'Under this domain'} tone="primary" icon={<Library className="h-5 w-5" strokeWidth={1.75} />} />
        <StatCard value={filterOn ? stat.frameworks : `${data.framework_count}/30`} label="Frameworks represented" sub={filterOn ? 'Selected frameworks here' : (data.absent_frameworks.length > 0 ? `${data.absent_frameworks.length} have no controls of this type — see why below` : 'All frameworks represented')} tone="primary" icon={<Building2 className="h-5 w-5" strokeWidth={1.75} />} />
        <StatCard value={stat.sets} label="Normalized sets" sub="Same requirement, deduped" tone="primary" icon={<GitMerge className="h-5 w-5" strokeWidth={1.75} />} />
        <StatCard value={stat.standalone} label="Standalone" sub="Framework-unique" tone="slate" icon={<Shield className="h-5 w-5" strokeWidth={1.75} />} />
        <StatCard value={stat.ev} label="Normalized evidence" sub={filterOn ? 'In your filtered view' : 'Across all sets'} tone="primary" icon={<FileText className="h-5 w-5" strokeWidth={1.75} />} />
        <StatCard value={stat.art} label="Artifacts" sub={filterOn ? 'In your filtered view' : 'Across sets & standalone'} tone="slate" icon={<FileStack className="h-5 w-5" strokeWidth={1.75} />} />
      </div>

      {/* framework coverage in this domain — collapsible tables (whole-domain explainer; hidden under a filter) */}
      {!filterOn && fwAll.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <button onClick={() => setShowAbsent(!showAbsent)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Building2 className="h-4 w-4 text-primary-600" strokeWidth={1.75} />Framework coverage in this domain</span>
            <span className="flex items-center gap-2 text-[11.5px]">
              <span className="rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700">{data.framework_count}/30 represented</span>
              {data.absent_frameworks.length > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">{data.absent_frameworks.length} not here</span>}
              <ChevronDown size={15} className={`text-slate-400 ${showAbsent ? 'rotate-180 transition' : 'transition'}`} />
            </span>
          </button>
          {showAbsent && (
            <div className="space-y-4 border-t border-slate-100 px-4 py-3">
              <p className="text-xs leading-relaxed text-slate-500">
                <b className="text-slate-700">{data.framework_count} of 30</b> frameworks have <b>{data.domain.toLowerCase()}</b>-type controls here.
                {data.absent_frameworks.length > 0 && <> The other <b className="text-slate-700">{data.absent_frameworks.length}</b> have none — not missing coverage; their controls live in the domains that match their control-types.</>}
              </p>

              {/* Not in this domain — table */}
              {data.absent_frameworks.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700"><Network className="h-3 w-3" />Not in this domain ({data.absent_frameworks.length})</div>
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Framework</th>
                          <th className="px-3 py-2 text-center font-semibold">Covered in</th>
                          <th className="px-3 py-2 font-semibold">Domains where its controls live</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.absent_frameworks.slice().sort((a, b) => (b.present_in_count ?? 0) - (a.present_in_count ?? 0)).map((a, i) => (
                          <tr key={i} className="align-top hover:bg-slate-50/60">
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{sf(a.name)}</td>
                            <td className="px-3 py-2 text-center"><span className="rounded-full bg-primary-50 px-1.5 py-0.5 text-[11px] font-semibold text-primary-700 tabular-nums">{a.present_in_count ?? 0}</span></td>
                            <td className="px-3 py-2 text-slate-500">{a.present_in?.length ? a.present_in.join(', ') : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Framework-level artifact catalogs moved to the dedicated /control-library/templates
          page (they are framework-wide, not control-level — they were identical on every domain). */}

      {/* tabs + toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTab('sets')} className={`flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm ${tab === 'sets' ? 'border-primary-500 bg-primary-50 font-medium text-primary-800' : 'border-slate-300 text-slate-600 hover:border-primary-300'}`}><GitMerge className="h-4 w-4" />Normalized sets ({fSets.length})</button>
        <button onClick={() => setTab('standalone')} className={`flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm ${tab === 'standalone' ? 'border-primary-500 bg-primary-50 font-medium text-primary-800' : 'border-slate-300 text-slate-600 hover:border-primary-300'}`}><Shield className="h-4 w-4" />Standalone ({fStd.length})</button>
        <button onClick={() => setTab('byframework')} className={`flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm ${tab === 'byframework' ? 'border-primary-500 bg-primary-50 font-medium text-primary-800' : 'border-slate-300 text-slate-600 hover:border-primary-300'}`}><Building2 className="h-4 w-4" />By framework ({byFwList.length})</button>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowFwFilter((v) => !v)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${filterOn || showFwFilter ? 'border-primary-500 bg-primary-50 font-medium text-primary-800' : 'border-slate-300 text-slate-600 hover:border-primary-300'}`}>
              <Filter className="h-4 w-4" />{filterOn ? `${selectedFw.length} framework${selectedFw.length === 1 ? '' : 's'}` : 'Build your view'}
              <ChevronDown size={14} className={showFwFilter ? 'rotate-180 transition' : 'transition'} />
            </button>
            {showFwFilter && (
              <>
                <button className="fixed inset-0 z-30 cursor-default" aria-hidden onClick={() => setShowFwFilter(false)} />
                <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Filter className="h-3.5 w-3.5 text-primary-600" />Build your view</span>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button onClick={() => setSelectedFw(fwAll)} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100">All</button>
                      <button onClick={() => setSelectedFw([])} className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100">Clear</button>
                    </div>
                  </div>
                  <div className="max-h-72 overflow-auto p-1.5">
                    {fwAll.map((f) => {
                      const on = selectedFw.includes(f);
                      const count = (byFw[f] || []).length;
                      return (
                        <button key={f} onClick={() => setSelectedFw((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f])} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>{on && <Check className="h-3 w-3" />}</span>
                          <span className="flex-1 truncate text-[12.5px] text-slate-700">{f}</span>
                          <span className="rounded-full bg-slate-100 px-1.5 text-[10.5px] tabular-nums text-slate-500">{count}</span>
                        </button>
                      );
                    })}
                    {fwAbsent.length > 0 && (
                      <>
                        <div className="mt-1 border-t border-slate-100 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">No controls of this type in this domain</div>
                        {fwAbsent.map((f) => (
                          <div key={f} title="This framework has no controls of this domain's control-type — it's covered in other domains." className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2 py-1.5 opacity-55">
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-100" />
                            <span className="flex-1 truncate text-[12.5px] text-slate-400 line-through">{f}</span>
                            <span className="rounded-full bg-slate-100 px-1.5 text-[10.5px] tabular-nums text-slate-400">0</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">{filterOn ? <span className="font-medium text-primary-700">{selectedFw.length} selected · {fSets.length} sets · {fStd.length} standalone</span> : 'All frameworks shown'}</div>
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'sets' ? 'Search sets or framework…' : tab === 'standalone' ? 'Search standalone…' : 'Search controls…'} className="w-56 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none" />
          </div>
          {tab === 'sets' && (
            <div className="flex overflow-hidden rounded-lg border border-slate-300">
              <button onClick={() => setView('grid')} title="Card view" className={`px-2.5 py-1.5 ${view === 'grid' ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}><LayoutGrid size={15} /></button>
              <button onClick={() => setView('table')} title="Table view" className={`border-l border-slate-300 px-2.5 py-1.5 ${view === 'table' ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}><List size={15} /></button>
            </div>
          )}
        </div>
      </div>

      {/* sets — grid or table */}
      {tab === 'sets' && (() => {
        const q = query.trim().toLowerCase();
        const sets = q ? fSets.filter((s) => s.normalized_title.toLowerCase().includes(q) || s.frameworks.some((f) => sf(f).toLowerCase().includes(q))) : fSets;
        if (sets.length === 0) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">{q ? 'No sets match your search.' : filterOn ? 'No normalized sets involve the selected frameworks. Try adding more frameworks to your view.' : 'No cross-framework sets — every control here is framework-unique.'}</div>;
        if (view === 'table') return (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Normalized requirement</th>
                  <th className="px-4 py-2.5 font-semibold">Frameworks</th>
                  <th className="px-4 py-2.5 text-center font-semibold"># Frameworks</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Evidence</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Artifacts</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sets.map((s) => {
                  const fwc = Array.from(new Set(s.frameworks.map(sf))).sort((a, b) => (filterOn ? ((selectedFw.includes(b) ? 1 : 0) - (selectedFw.includes(a) ? 1 : 0)) : 0));
                  return (
                    <tr key={s.set_id} onClick={() => { setOpenSet(s); setPanelTab('members'); }} className="cursor-pointer transition-colors hover:bg-primary-50/40">
                      <td className="px-4 py-3 font-medium text-slate-800">{s.normalized_title}</td>
                      <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{fwc.slice(0, 5).map((f) => <span key={f} className={filterOn && !selectedFw.includes(f) ? tag : chip}>{f}</span>)}{fwc.length > 5 && <span className={tag}>+{fwc.length - 5}</span>}</div></td>
                      <td className="px-4 py-3 text-center font-semibold tabular-nums text-primary-700">{filterOn ? `${selMembers(s)}/${s.member_count}` : s.member_count}</td>
                      <td className="px-4 py-3 text-center tabular-nums text-slate-600">{s.normalized_evidence.length}</td>
                      <td className="px-4 py-3 text-center tabular-nums text-slate-600">{s.normalized_artifacts.length}</td>
                      <td className="px-4 py-3 text-right"><ArrowRight size={15} className="text-slate-300" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        return (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {sets.map((s) => {
              const fwc = Array.from(new Set(s.frameworks.map(sf))).sort((a, b) => (filterOn ? ((selectedFw.includes(b) ? 1 : 0) - (selectedFw.includes(a) ? 1 : 0)) : 0));
              return (
                <button key={s.set_id} onClick={() => { setOpenSet(s); setPanelTab('members'); }} className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-lg">
                  <div className="absolute inset-x-0 top-0 h-1 bg-primary-600 opacity-70 transition-opacity group-hover:opacity-100" />
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary-600"><GitMerge className="h-3 w-3" />normalized</span>
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700 ring-1 ring-primary-100">{filterOn ? `${selMembers(s)} of ${s.member_count}` : `${s.member_count} frameworks`}</span>
                  </div>
                  <h3 className="mt-1.5 line-clamp-2 min-h-[2.6em] text-[13.5px] font-semibold leading-snug text-slate-900">{s.normalized_title}</h3>
                  <div className="mt-2 flex flex-wrap gap-1">{fwc.slice(0, 6).map((f) => <span key={f} className={filterOn && !selectedFw.includes(f) ? tag : chip}>{f}</span>)}{fwc.length > 6 && <span className={tag}>+{fwc.length - 6}</span>}</div>
                  <div className="mt-auto grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5 text-center">
                    <div><div className="flex items-center justify-center gap-1 text-sm font-bold tabular-nums text-slate-800"><Network size={12} className="text-primary-500" />{s.member_count}</div><div className="text-[10px] text-slate-400">frameworks</div></div>
                    <div><div className="flex items-center justify-center gap-1 text-sm font-bold tabular-nums text-slate-800"><FileText size={12} className="text-emerald-500" />{s.normalized_evidence.length}</div><div className="text-[10px] text-slate-400">evidence</div></div>
                    <div><div className="flex items-center justify-center gap-1 text-sm font-bold tabular-nums text-slate-800"><FileStack size={12} className="text-amber-500" />{s.normalized_artifacts.length}</div><div className="text-[10px] text-slate-400">artifacts</div></div>
                  </div>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* standalone grouped by framework */}
      {tab === 'standalone' && (
        <div className="flex items-start gap-3">
          <div className="flex max-h-[560px] flex-[0_0_30%] flex-col gap-1.5 overflow-auto pr-1">
            {stdFwList.map(([f, items]) => (
              <button key={f} onClick={() => setFwGroup(f)} className={`flex items-center justify-between rounded-lg border bg-white px-3 py-2 ${f === grp ? 'border-l-[3px] border-l-primary-600 bg-primary-50' : 'border-slate-200 hover:border-primary-300'}`}>
                <span className="text-[12.5px] font-medium text-slate-800">{f}</span><span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-500">{items.length}</span>
              </button>
            ))}
          </div>
          <div className="max-h-[560px] flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="font-semibold text-slate-900">{grp} <span className="text-sm font-normal text-slate-400">· {(stdByFw[grp] || []).length} framework-unique controls</span></div>
            <p className="mb-3 text-xs text-slate-500">Appear only in {grp} — no equivalent in any other framework, so they are grouped here but not normalized into a set.</p>
            <p className="mb-2 text-[11px] text-slate-400">Click a control to view its evidence, artifacts, and upload evidence.</p>
            <div className="space-y-1.5">{(stdByFw[grp] || []).filter((s) => { const q = query.trim().toLowerCase(); return !q || (s.members[0]?.original_title || '').toLowerCase().includes(q) || (s.members[0]?.control_id || '').toLowerCase().includes(q); }).map((s, i) => (
              <button key={i} onClick={() => { setOpenSet(s); setPanelTab('members'); }} className="flex w-full items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{s.members[0]?.control_id}</span></div>
                  <div className="mt-0.5 text-[12.5px] text-slate-700">{s.members[0]?.original_title}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700"><FileText className="h-2.5 w-2.5" />{s.normalized_evidence?.length || 0}</span>
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700"><FileStack className="h-2.5 w-2.5" />{s.normalized_artifacts?.length || 0}</span>
                  <ArrowRight size={13} className="text-slate-300" />
                </div>
              </button>
            ))}</div>
          </div>
        </div>
      )}

      {/* by framework — each framework's controls in this domain */}
      {tab === 'byframework' && (() => {
        if (byFwList.length === 0) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No frameworks match the current filter.</div>;
        const items = byFw[bfActive] || [];
        const q = query.trim().toLowerCase();
        const shown = q ? items.filter((c) => (c.title || '').toLowerCase().includes(q) || (c.control_id || '').toLowerCase().includes(q) || (c.set || '').toLowerCase().includes(q)) : items;
        const inSets = items.filter((c) => c.set).length;
        const stdN = items.length - inSets;
        return (
          <div className="flex items-start gap-3">
            <div className="flex max-h-[600px] flex-[0_0_30%] flex-col gap-1.5 overflow-auto pr-1">
              {byFwList.map(([f, list]) => (
                <button key={f} onClick={() => setBfFw(f)} className={`flex items-center justify-between rounded-lg border bg-white px-3 py-2 ${f === bfActive ? 'border-l-[3px] border-l-primary-600 bg-primary-50' : 'border-slate-200 hover:border-primary-300'}`}>
                  <span className="text-[12.5px] font-medium text-slate-800">{f}</span><span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-500">{list.length}</span>
                </button>
              ))}
            </div>
            <div className="max-h-[600px] flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-900">{bfActive} <span className="text-sm font-normal text-slate-400">· {items.length} controls in this domain</span></div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700 ring-1 ring-primary-100">{inSets} normalized</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{stdN} standalone</span>
                </div>
              </div>
              <p className="mb-3 mt-1 text-xs text-slate-500">Every {bfActive} control grouped under <b>{data.domain}</b> — those merged into a cross-framework set are tagged with the set, the rest are unique to {bfActive}.</p>
              <div className="space-y-1.5">{shown.map((c, i) => {
                const parentSet = c.set ? data.sets.find((s) => s.normalized_title === c.set) : null;
                return (
                  <div key={i} className={`rounded-lg border px-3 py-2 transition-colors ${c.set ? 'border-primary-200 bg-primary-50/30 hover:bg-primary-50' : 'border-slate-200 hover:border-primary-200 hover:bg-primary-50/20'} ${parentSet ? 'cursor-pointer' : ''}`} onClick={() => { if (parentSet) { setOpenSet(parentSet); setPanelTab('members'); } }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{c.control_id}</span>
                      {c.set
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-[10.5px] font-medium text-primary-700"><GitMerge className="h-2.5 w-2.5" />in set: {c.set}</span>
                        : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-500"><Shield className="h-2.5 w-2.5" />standalone</span>}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-slate-700">{c.title}</div>
                  </div>
                );
              })}
              {shown.length === 0 && <p className="text-xs text-slate-400">No controls match your search.</p>}</div>
            </div>
          </div>
        );
      })()}

      {/* set detail — right side panel (system UI) */}
      <RightSlidePanel
        isOpen={!!openSet}
        onClose={() => setOpenSet(null)}
        width="w-full max-w-xl"
        title={openSet?.normalized_title || openSet?.members?.[0]?.original_title || ''}
        subtitle={openSet ? (openSet.member_count <= 1
          ? `Standalone control · ${sf(openSet.members?.[0]?.framework || '')} · framework-unique`
          : `Normalized set · ${openSet.member_count} frameworks · one control per framework`) : undefined}
      >
        {openSet && (
          <div>
            {/* in-panel sub-tabs */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {([['members', `Frameworks ${openSet.member_count}`], ['evidence', `Evidence ${openSet.normalized_evidence.length}`], ['artifacts', `Artifacts ${openSet.normalized_artifacts.length}`], ['upload', 'Upload evidence']] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setPanelTab(k)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${panelTab === k ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{lbl}</button>
              ))}
            </div>

            {panelTab === 'members' && (() => {
              const mine = filterOn ? openSet.members.filter((m) => selectedFw.includes(sf(m.framework))) : openSet.members;
              const others = filterOn ? openSet.members.filter((m) => !selectedFw.includes(sf(m.framework))) : [];
              const Row = (m: Member, key: string, muted: boolean) => (
                <div key={key} className={`mb-1.5 rounded-lg border px-3 py-2 ${muted ? 'border-slate-200 bg-slate-50/60' : 'border-primary-200 bg-primary-50/30'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={muted ? 'rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-500' : 'rounded border border-primary-300 bg-primary-100 px-1.5 py-0.5 text-[11px] font-medium text-primary-800'}>{sf(m.framework)}</span>
                    <span className="font-mono text-[12px] text-slate-500">{m.control_id}</span>
                    {!muted && filterOn && <span className="rounded-full bg-primary-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">your view</span>}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-slate-700">{m.original_title}</div>
                </div>
              );
              return (
                <>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Network className="h-3 w-3" />One control per framework — original titles preserved{filterOn && others.length > 0 && ` · ${openSet.member_count} frameworks share this requirement`}</div>
                  {mine.map((m, i) => Row(m, 'mine' + i, false))}
                  {others.length > 0 && (
                    <>
                      <div className="my-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><GitMerge className="h-3 w-3" />Also normalized with — {others.length} other framework{others.length === 1 ? '' : 's'} sharing this requirement</div>
                      {others.map((m, i) => Row(m, 'oth' + i, true))}
                    </>
                  )}
                </>
              );
            })()}

            {panelTab === 'evidence' && (
              <>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600"><FileText className="h-3 w-3" />Normalized evidence ({openSet.normalized_evidence.length})</div>
                {openSet.normalized_evidence.length === 0 && <p className="text-xs text-slate-400">Evidence pending (source gap).</p>}
                {openSet.normalized_evidence.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 py-1 text-[12.5px] text-slate-700"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" /><span>{e.name}</span></div>
                ))}
              </>
            )}

            {panelTab === 'artifacts' && (
              <>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600"><FileStack className="h-3 w-3" />Requirement-specific artifacts ({openSet.normalized_artifacts.length}) — click to download</div>
                {openSet.normalized_artifacts.length === 0 && <p className="text-xs text-slate-400">No requirement-specific artifacts — supporting templates are under the domain's framework-level catalogs.</p>}
                <div className="space-y-1.5">
                  {openSet.normalized_artifacts.map((a, i) => (
                    <button key={i} onClick={() => download(a)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[12.5px] text-slate-700 shadow-sm hover:border-amber-300 hover:bg-amber-50">
                      <span className="flex items-center gap-2"><FileStack size={14} className="text-amber-500" />{a.name}{a.type && <span className="text-slate-400">· {a.type}</span>}</span>
                      <Download size={14} className="text-slate-400" />
                    </button>
                  ))}
                </div>
              </>
            )}

            {panelTab === 'upload' && (
              <>
                <div className="mb-3 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-[12px] leading-relaxed text-primary-900">
                  Upload evidence once here — it is linked to <b>all {openSet.member_count} member controls</b> across frameworks, added to the <b>Evidence Library</b>, and attached to each framework requirement automatically.
                </div>
                <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition-colors hover:border-primary-400 hover:bg-primary-50/40 ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
                  {uploading ? <Loader2 className="h-6 w-6 animate-spin text-primary-500" /> : <Upload className="h-6 w-6 text-primary-500" />}
                  <span className="text-[12.5px] font-medium text-slate-700">{uploading ? 'Uploading & linking…' : 'Click to upload evidence file'}</span>
                  <span className="text-[11px] text-slate-400">PDF, image or document — auto-linked to every framework control</span>
                  <input type="file" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.currentTarget.value = ''; }} />
                </label>
                {uploadMsg && <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 ring-1 ring-emerald-100">{uploadMsg}</div>}

                <div className="mb-2 mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><FileText className="h-3 w-3" />Uploaded evidence ({uploads.length})</div>
                {uploads.length === 0 && <p className="text-xs text-slate-400">No evidence uploaded yet for this set.</p>}
                {uploads.map((u) => (
                  <div key={u.id} className="mb-1.5 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-medium text-slate-800">{u.name}</div>
                      <div className="truncate text-[11px] text-slate-400">{u.file_name} · linked to {u.linked_controls} controls</div>
                    </div>
                    <span className="ml-2 shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100">{u.status}</span>
                  </div>
                ))}

                <div className="mb-2 mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><CheckCircle2 className="h-3 w-3" />Recommended evidence to provide ({openSet.normalized_evidence.length})</div>
                {openSet.normalized_evidence.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 py-0.5 text-[12px] text-slate-600"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-300" />{e.name}</div>
                ))}
              </>
            )}
          </div>
        )}
      </RightSlidePanel>
    </div>
  );
}
