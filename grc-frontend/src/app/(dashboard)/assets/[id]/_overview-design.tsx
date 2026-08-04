'use client';

/*
 * AssetOverview — GRC / compliance asset detail (Overview tab).
 * Design handoff, used VERBATIM. The only change from the delivered file is that
 * the inlined demo `ASSET` constant is replaced by an `A` prop, so the exact same
 * UI renders against live API data (see _overview-map.ts for the mapper).
 *
 * Fonts: the design uses "Public Sans" (UI) and "IBM Plex Mono" (technical values).
 * Add them once in app/layout via next/font or a <link>, e.g.
 *   https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap
 */

import React, { useMemo, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

// deterministic layout: which deep-inventory sections span full width vs share a row, and their order
const LAYOUT: Record<string, 'half' | 'full'> = { CPU: 'half', Firmware: 'half', Memory: 'half', Storage: 'half', GPU: 'full', 'Microsoft Defender': 'half', BitLocker: 'half', Firewall: 'full', 'Operating System': 'full', 'Windows Update': 'half', 'Scheduled Tasks': 'half', Shares: 'full', Services: 'full', 'Network Adapters': 'full', 'Local Users': 'full', 'Local Groups': 'full' };
const ORDER: Record<string, string[]> = { hardware: ['CPU', 'Firmware', 'Memory', 'Storage', 'GPU'], security: ['Microsoft Defender', 'BitLocker', 'Firewall'], system: ['Operating System', 'Windows Update', 'Scheduled Tasks', 'Shares', 'Services'] };

const MONO = "font-['IBM_Plex_Mono',ui-monospace,monospace]";
const SHADOW = 'shadow-[0_1px_2px_rgba(18,45,36,0.05),0_12px_26px_-18px_rgba(18,45,36,0.22)]';
const CARD = `bg-white border border-[#e6e9e3] rounded-2xl overflow-hidden ${SHADOW}`;
const HOVER = 'transition-[box-shadow,transform] duration-200 hover:shadow-[0_10px_26px_-10px_rgba(18,45,36,0.30)] hover:-translate-y-0.5';
const TONE: Record<string, string> = { ok: '#0f7a5c', warn: '#a86a12', bad: '#b42318', muted: '#97a19a' };

function badgeCls(status: string) {
  const map: Record<string, string> = {
    discovered: 'text-[#0f7a5c] bg-[#ecfdf3] border-[#c3ead2]',
    error: 'text-[#b42318] bg-[#fdeceb] border-[#f3cfcb]',
    permission_denied: 'text-[#a86a12] bg-[#fdf3e3] border-[#f0dcae]',
  };
  return 'text-[9.5px] font-bold tracking-[0.04em] uppercase px-2 py-0.5 rounded-md border ' + (map[status] || 'text-[#5c6b62] bg-[#f0f2ee] border-[#e0e4dc]');
}

function Cell({ label, value, tone, mono }: any) {
  const empty = value === '—' || value === '' || value == null;
  const v = empty ? 'Not set' : value;
  const wide = !empty && typeof v === 'string' && v.length > 24;
  const color = empty ? '#97a19a' : TONE[tone] || '#1a2b24';
  return (
    <div className={'min-w-0' + (wide ? ' sm:col-span-2' : '')}>
      <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a948b] mb-0.5">{label}</div>
      <div className={(mono ? MONO + ' text-[12px]' : 'text-[13px]') + ' break-words leading-snug'} style={{ color, fontStyle: empty ? 'italic' : undefined }}>{v}</div>
    </div>
  );
}

function KV({ items }: { items: any[] }) {
  const inline = items.length <= 2;
  return (
    <div className={inline ? 'flex flex-wrap gap-x-8 gap-y-2' : 'grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-5 gap-y-3'}>
      {items.map((it, i) => <Cell key={i} {...it} />)}
    </div>
  );
}

function ObjList({ label, objects }: { label?: string; objects: any[] }) {
  return (
    <div>
      {label && <div className="text-[10px] font-bold tracking-[0.04em] uppercase text-[#5c6b62] mb-2">{label}</div>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
        {objects.map((o, i) => (
          <div key={i} className="border border-[#eceee8] bg-[#fafbf8] rounded-lg px-3 py-2.5">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-3.5 gap-y-2">
              {o.map((it: any, j: number) => <Cell key={j} {...it} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ items }: { items: any[] }) {
  return (
    <div className="flex gap-2.5">
      {items.map((it, i) => (
        <div key={i} className="flex-1 bg-[#f4f7f3] border border-[#e6e9e3] rounded-xl py-3 text-center">
          <div className={'text-[22px] font-extrabold text-[#0d5c48] leading-none ' + MONO}>{it.value}</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[#8a948b] mt-1.5">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function SmallTable({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-[#eceee8] rounded-xl overflow-hidden">
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

const TH = 'text-left sticky top-0 bg-[#f4f7f3] text-[#5c6b62] font-bold text-[10px] tracking-[0.04em] uppercase px-3 py-2 border-b border-[#e4e7e0]';
const TD = 'px-3 py-2 border-b border-[#f2f4ef] align-top';

function UsersTable({ rows }: { rows: any[] }) {
  return (
    <SmallTable head={<tr><th className={TH}>Account</th><th className={TH}>SID</th><th className={TH + ' text-center'}>Status</th></tr>}>
      {rows.map((r, i) => {
        const disabled = r[4] === '✓';
        const full = r[0] && r[0] !== '—' ? r[0] : '';
        return (
          <tr key={i}>
            <td className={TD}>
              <div className="font-semibold text-[#1a2b24]">{r[1]}</div>
              {full && <div className="text-[#8a948b] text-[11px]">{full}</div>}
            </td>
            <td className={TD + ' text-[#8a948b] text-[10.5px] break-all ' + MONO}>{r[2]}</td>
            <td className={TD + ' text-center'}>
              <span className={'text-[10px] font-bold uppercase tracking-[0.03em] rounded-md px-2 py-0.5 border ' + (disabled ? 'text-[#8a948b] bg-[#f0f2ee] border-[#e0e4dc]' : 'text-[#0f7a5c] bg-[#e7f6ee] border-[#c3ead2]')}>{disabled ? 'Disabled' : 'Enabled'}</span>
            </td>
          </tr>
        );
      })}
    </SmallTable>
  );
}

function GroupsTable({ rows }: { rows: any[] }) {
  return (
    <SmallTable head={<tr><th className={TH + ' w-[38%]'}>Group</th><th className={TH}>Description</th></tr>}>
      {rows.map((r, i) => (
        <tr key={i}>
          <td className={TD + ' font-semibold text-[#1a2b24]'}>{r[0]}</td>
          <td className={TD + ' text-[#5c6b62]'}>{r[1]}</td>
        </tr>
      ))}
    </SmallTable>
  );
}

// Generic table for any kind's big lists (DB databases, router interfaces, cloud
// resources…). Reuses the exact TH/TD styling of the users/groups tables so it
// reads as one system; the first column is emphasised like a name.
function GenericTable({ headers, rows }: { headers: string[]; rows: any[] }) {
  return (
    <SmallTable head={<tr>{headers.map((h, i) => <th key={i} className={TH}>{h}</th>)}</tr>}>
      {rows.map((r, i) => (
        <tr key={i}>
          {r.map((c: any, j: number) => (
            <td key={j} className={TD + (j === 0 ? ' font-semibold text-[#1a2b24]' : ' text-[#5c6b62]')}>{c}</td>
          ))}
        </tr>
      ))}
    </SmallTable>
  );
}

function Block({ b }: { b: any }) {
  if (b.type === 'note') return <div className="text-[12.5px] text-[#8a948b] italic leading-snug">{b.text}</div>;
  if (b.type === 'kv') return <KV items={b.items} />;
  if (b.type === 'sub') return (<div><div className="text-[10px] font-bold tracking-[0.04em] uppercase text-[#5c6b62] mb-2">{b.label}</div><KV items={b.items} /></div>);
  if (b.type === 'objlist') return <ObjList label={b.label} objects={b.objects} />;
  if (b.type === 'stat') return <Stat items={b.items} />;
  if (b.type === 'table' && b.variant === 'users') return <UsersTable rows={b.rows} />;
  if (b.type === 'table' && b.variant === 'groups') return <GroupsTable rows={b.rows} />;
  if (b.type === 'table') return <GenericTable headers={b.headers} rows={b.rows} />;
  return null;
}

function SectionCard({ sec, span }: { sec: any; span: 'half' | 'full' }) {
  return (
    <div className={CARD + ' ' + HOVER + (span === 'full' ? ' lg:col-span-2' : '')}>
      <div className="flex items-center justify-between gap-2 px-[18px] py-[15px] border-b border-[#f2f4ef]">
        <span className="text-[13px] font-bold text-[#1a2b24]">{sec.title}</span>
        <span className={badgeCls(sec.status)}>{sec.status}</span>
      </div>
      <div className="px-[18px] py-[17px] flex flex-col gap-3.5">
        {(sec.blocks || []).map((b: any, i: number) => <Block key={i} b={b} />)}
      </div>
    </div>
  );
}

function ProvenanceCard({ card, accent, kind, full }: { card: any; accent: string; kind: 'machine' | 'manual'; full?: boolean }) {
  const setCount = kind === 'manual' ? card.fields.filter((f: any) => f.value !== '—' && f.value !== '' && f.value != null).length : 0;
  return (
    <div className={CARD + ' ' + HOVER + ' border-l-[3px] ' + accent + (full ? ' lg:col-span-2' : '')}>
      <div className="flex items-center justify-between gap-3 px-[18px] py-[15px] border-b border-[#eceee8]">
        <div className="text-[14px] font-bold text-[#1a2b24]">{card.title}</div>
        {kind === 'machine'
          ? <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.03em] uppercase text-[#0f7a5c] bg-[#e7f6ee] border border-[#c3ead2] px-2.5 py-[3px] rounded-full">{card.note}</span>
          : <a onClick={card.onEdit} className="text-[12px] font-semibold text-[#0d5c48] cursor-pointer">Edit</a>}
      </div>
      <div className="px-[18px] py-4">
        {kind === 'manual' && (
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex-1 h-1.5 bg-[#eef1ec] rounded-full overflow-hidden"><div className="h-full bg-[#d9a441]" style={{ width: (card.complete != null ? card.complete : Math.round((setCount / card.fields.length) * 100)) + '%' }} /></div>
            <span className="text-[11px] font-bold text-[#c79a3a] whitespace-nowrap">{setCount} of {card.fields.length} set</span>
          </div>
        )}
        {card.tiles && (
          <div className="flex gap-2.5 mb-4">
            {card.tiles.map((t: any, i: number) => (
              <div key={i} className="flex-1 bg-[#f4f7f3] border border-[#e6e9e3] rounded-xl py-3 text-center">
                <div className={'text-[24px] font-extrabold text-[#0d5c48] leading-none ' + MONO}>{t.num}</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[#8a948b] mt-1.5">{t.label}</div>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-5 gap-y-3.5">
          {card.fields.map((f: any, i: number) => <Cell key={i} {...f} />)}
        </div>
      </div>
    </div>
  );
}

export default function AssetOverview({ A }: { A: any }) {
  // Default to the first collected domain — 'hardware' for a host, 'instance' for
  // a database, 'account' for cloud, etc. — so the correct tab is highlighted.
  const [deepTab, setDeepTab] = useState<string>(() => A.deep?.[0]?.key || 'hardware');
  const [swQuery, setSwQuery] = useState('');
  const [svcQuery, setSvcQuery] = useState('');
  const [svcState, setSvcState] = useState<'all' | 'running' | 'stopped'>('all');

  const software = useMemo(() => {
    const q = swQuery.trim().toLowerCase();
    const rows = A.security.software;
    return q ? rows.filter((p: any) => (p.name + ' ' + p.version).toLowerCase().includes(q)) : rows;
  }, [A, swQuery]);

  const group = A.deep.find((g: any) => g.key === deepTab) || A.deep[0] || { key: 'hardware', sections: [] };
  const deepSections = useMemo(() => {
    const order = ORDER[group.key];
    const secs = order ? [...group.sections].sort((a: any, b: any) => (order.indexOf(a.title) < 0 ? 99 : order.indexOf(a.title)) - (order.indexOf(b.title) < 0 ? 99 : order.indexOf(b.title))) : group.sections;
    return secs;
  }, [group]);

  const svcSection = useMemo(() => (A.deep.find((g: any) => g.key === 'system') || { sections: [] }).sections.find((s: any) => s.variant === 'services'), [A]);
  const svc = useMemo(() => {
    if (!svcSection) return { rows: [], run: 0, stop: 0, total: 0 };
    const rows = svcSection.rows;
    const run = rows.filter((r: any) => r[4] === 'Running').length;
    const stop = rows.filter((r: any) => r[4] === 'Stopped').length;
    const q = svcQuery.trim().toLowerCase();
    let f = rows;
    if (svcState === 'running') f = f.filter((r: any) => r[4] === 'Running');
    else if (svcState === 'stopped') f = f.filter((r: any) => r[4] === 'Stopped');
    if (q) f = f.filter((r: any) => (r[1] + ' ' + r[5] + ' ' + r[0] + ' ' + r[2]).toLowerCase().includes(q));
    return { rows: f, run, stop, total: rows.length };
  }, [svcSection, svcQuery, svcState]);

  const spanOf = (sec: any): 'half' | 'full' => {
    const blocks = sec.blocks || [];
    const wide = sec.variant === 'services' || blocks.some((b: any) => b.type === 'table') || blocks.some((b: any) => b.type === 'objlist' && (b.objects || []).length >= 3);
    return LAYOUT[sec.title] || (wide ? 'full' : 'half');
  };

  return (
    <div className="min-h-screen bg-[#eef1ec] text-[#1a2b24] font-['Public_Sans',system-ui,sans-serif] px-6 pt-7 pb-16 [font-feature-settings:'ss01']">
      <div className="max-w-[1300px] mx-auto">

        {/* HEADER */}
        <div className={CARD}>
          <div className="flex flex-wrap gap-4 items-start justify-between px-[22px] pt-5 pb-[18px]">
            <div className="flex gap-4 items-center min-w-0">
              <div className="w-[46px] h-[46px] rounded-xl bg-[#e8f2ec] text-[#0d5c48] flex items-center justify-center font-extrabold text-xl shrink-0">{A.header.avatar}</div>
              <div className="min-w-0">
                <div className="flex gap-2.5 items-center flex-wrap">
                  <div className={'text-[22px] font-extrabold tracking-[-0.02em] whitespace-nowrap ' + MONO}>{A.header.name}</div>
                  {A.header.tags.map((t: any, i: number) => (
                    <span key={i} className={'text-[10px] font-bold tracking-[0.06em] uppercase px-2.5 py-[3px] rounded-full border ' + (t.tone === 'ok' ? 'bg-[#e7f6ee] text-[#0f7a5c] border-[#c3ead2]' : 'bg-[#eef1ec] text-[#5c6b62] border-[#e0e4dc]')}>{t.label}</span>
                  ))}
                </div>
                <div className="text-[12.5px] text-[#8a948b] mt-1">{A.header.idline}</div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {A.actions.map((a: any, i: number) => (
                <button key={i} onClick={a.onClick} className={'text-[12.5px] font-semibold px-3.5 py-2 rounded-lg whitespace-nowrap border ' + (a.primary ? 'bg-[#0d5c48] text-white border-[#0d5c48]' : a.danger ? 'bg-white text-[#b42318] border-[#f0cfca]' : 'bg-white text-[#1a2b24] border-[#dfe3db]')}>{a.label}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-0.5 px-3 overflow-x-auto border-t border-[#eceee8] bg-[#fbfcfa]">
            {A.tabs.map((tb: any, i: number) => (
              <span key={i} onClick={tb.onClick} className={'px-3.5 pt-3 pb-2.5 text-[13px] whitespace-nowrap cursor-pointer border-b-2 ' + (tb.active ? 'text-[#0d5c48] font-bold border-[#0d5c48]' : 'text-[#5c6b62] font-semibold border-transparent')}>{tb.label}{tb.count != null && <span className="ml-1.5 text-[11px] text-[#aab2a8] font-semibold">{tb.count}</span>}</span>
            ))}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 my-4">
          {A.kpis.map((k: any, i: number) => {
            const col = k.tone === 'muted' ? '#97a19a' : TONE[k.tone] || '#1a2b24';
            return (
              <div key={i} className="bg-white border border-[#e6e9e3] rounded-xl px-4 py-3.5">
                <div className="text-[10px] font-bold tracking-[0.06em] uppercase text-[#8a948b]">{k.label}</div>
                <div className={'text-[26px] font-extrabold leading-none mt-1.5 ' + MONO} style={{ color: k.tone ? col : '#1a2b24' }}>{k.value}</div>
                {k.bar != null && <div className="h-[5px] bg-[#eef1ec] rounded-full mt-2.5 overflow-hidden"><div className="h-full" style={{ width: (k.bar || 2) + '%', background: k.tone === 'warn' ? '#d9a441' : '#0f9d78' }} /></div>}
                <div className="text-[11.5px] mt-1.5" style={{ color: k.tone === 'ok' ? '#0f7a5c' : k.tone === 'warn' ? '#a86a12' : '#8a948b' }}>{k.sub}</div>
              </div>
            );
          })}
        </div>

        {/* PROVENANCE LEGEND */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 mx-0.5 mb-3">
          <div className="flex items-center gap-2.5"><span className="w-2 h-2 rounded-full bg-[#0f9d78]" /><span className="text-[11px] font-extrabold tracking-[0.07em] uppercase text-[#5c6b62]">Machine-collected facts</span><span className="text-[11px] text-[#aab2a8]">{A.legend?.machine}</span></div>
          <div className="flex items-center gap-2.5"><span className="w-2 h-2 rounded-full bg-[#d9a441]" /><span className="text-[11px] font-extrabold tracking-[0.07em] uppercase text-[#5c6b62]">Manually maintained</span><span className="text-[11px] text-[#aab2a8]">Owner / CMDB entry</span></div>
        </div>

        {/* PROVENANCE CARDS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          {A.machine.map((c: any, i: number) => <ProvenanceCard key={i} card={c} accent="border-l-[#0f9d78]" kind="machine" />)}
          {A.manual.map((c: any, i: number) => <ProvenanceCard key={i} card={c} accent="border-l-[#d9a441]" kind="manual" full />)}
        </div>

        {/* SOFTWARE & SECURITY POSTURE */}
        <div className={CARD + ' mt-4'}>
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#eceee8]">
            <div>
              <div className="text-[15px] font-extrabold tracking-[-0.01em]">Software &amp; Security Posture</div>
              <div className="text-[11.5px] text-[#aab2a8] mt-px">Auto-collected · agentless scan</div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.03em] uppercase text-[#0f7a5c] bg-[#e7f6ee] border border-[#c3ead2] px-2.5 py-[3px] rounded-full">Agentless scan</span>
          </div>
          <div className="px-5 py-[18px]">
            <div className="flex flex-wrap gap-2.5 mb-[18px]">
              {A.security.signals.map((s: any, i: number) => {
                const bad = s.tone === 'bad';
                return (
                  <div key={i} className={'flex-1 min-w-[150px] rounded-xl px-3.5 py-3 border ' + (bad ? 'border-[#f3cfcb] bg-[#fdf1f0]' : 'border-[#e6e9e3] bg-white')}>
                    <div className="text-[10px] font-bold tracking-[0.05em] uppercase text-[#8a948b]">{s.label}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: bad ? '#b42318' : '#c6ccc2' }} />
                      <span className="text-[14px] font-bold" style={{ color: bad ? '#b42318' : '#1a2b24' }}>{s.value}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#5c6b62]">Installed software <span className="text-[#aab2a8] font-semibold">· {software.length} of {A.security.software.length}</span></div>
              <input value={swQuery} onChange={(e) => setSwQuery(e.target.value)} placeholder="Filter packages…" className="w-full sm:w-[260px] text-[12.5px] px-3 py-[7px] border border-[#dfe3db] rounded-lg bg-[#f9faf8] outline-none focus:border-[#0d5c48]" />
            </div>
            <div className="border border-[#eceee8] rounded-xl overflow-hidden">
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead><tr><th className={TH + ' text-[10.5px] px-3.5 py-[9px]'}>Package</th><th className={TH + ' text-[10.5px] px-3.5 py-[9px] w-[160px]'}>Version</th><th className={TH + ' text-[10.5px] px-3.5 py-[9px] w-[150px]'}>Tracked</th></tr></thead>
                  <tbody>
                    {software.map((p: any, i: number) => {
                      const setup = p.tracked && p.tracked.indexOf('set up') >= 0;
                      const dash = !p.tracked || p.tracked === '—';
                      return (
                        <tr key={i} onClick={p.onClick} className={p.onClick ? 'cursor-pointer hover:bg-[#f9faf8]' : undefined}>
                          <td className="px-3.5 py-2 border-b border-[#f2f4ef] text-[#1a2b24] font-medium">{p.name}</td>
                          <td className={'px-3.5 py-2 border-b border-[#f2f4ef] text-[#5c6b62] text-[11.5px] ' + MONO}>{p.version}</td>
                          <td className="px-3.5 py-2 border-b border-[#f2f4ef]"><span className={setup ? 'text-[11.5px] font-semibold text-[#0d5c48] cursor-pointer' : dash ? 'text-[#c6ccc2]' : 'text-[11.5px] font-semibold text-[#0f7a5c]'}>{dash ? '—' : p.tracked}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {software.length === 0 && <div className="py-6 text-center text-[#aab2a8] text-[12.5px]">No packages match “{swQuery}”.</div>}
            </div>
          </div>
        </div>

        {/* DEEP INVENTORY */}
        {(A.deep.length > 0 || A.deepNote?.denied?.length || A.deepNote?.absent?.length) && (
        <div className={CARD + ' mt-4'}>
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3.5 border-b border-[#eceee8]">
            <div>
              <div className="text-[15px] font-extrabold tracking-[-0.01em]">Deep Inventory</div>
              <div className="text-[11.5px] text-[#aab2a8] mt-px">Machine-collected · {A.deep.reduce((n: number, g: any) => n + g.sections.length, 0)} sections across {A.deep.length} domains</div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.03em] uppercase text-[#0f7a5c] bg-[#e7f6ee] border border-[#c3ead2] px-2.5 py-[3px] rounded-full">All discovered</span>
          </div>
          {/* Honest callout for what couldn't be collected — instead of empty cards. */}
          {(A.deepNote?.denied?.length > 0 || A.deepNote?.absent?.length > 0) && (
            <div className="px-5 pt-3.5 flex flex-col gap-2">
              {A.deepNote.denied?.length > 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-[#f0dcae] bg-[#fdf7ea] px-3.5 py-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#d9a441] mt-1.5 shrink-0" />
                  <div className="text-[12px] text-[#7a5a12] leading-snug">
                    <b>Needs elevated access</b> (root / sudo): {A.deepNote.denied.join(' · ')}. These read root-only sources (e.g. <span className="italic">dmidecode</span>, AppArmor profiles, sudoers) — reconnect with a sudo-capable account to collect them.
                  </div>
                </div>
              )}
              {A.deepNote.absent?.length > 0 && (
                <div className="text-[11.5px] text-[#8a948b] px-1">Not present on this host: {A.deepNote.absent.join(' · ')}.</div>
              )}
            </div>
          )}
          {A.deep.length > 0 && (<>
          <div className="flex gap-1.5 px-5 py-3.5 overflow-x-auto bg-[#fbfcfa] border-b border-[#eceee8]">
            {A.deep.map((g: any) => {
              const active = g.key === deepTab;
              return (
                <button key={g.key} onClick={() => setDeepTab(g.key)} className={'text-[12.5px] font-semibold rounded-lg px-3.5 py-[7px] whitespace-nowrap inline-flex items-center gap-1.5 border ' + (active ? 'bg-[#0d5c48] text-white border-[#0d5c48]' : 'bg-white text-[#5c6b62] border-[#dfe3db]')}>{g.label}<span className={'text-[11px] font-bold ' + (active ? 'text-[#bfe6d6]' : 'text-[#aab2a8]')}>{g.sections.length}</span></button>
              );
            })}
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
              {deepSections.map((sec: any, i: number) => {
                if (sec.variant === 'services') {
                  const chip = (key: 'all' | 'running' | 'stopped', lbl: string) => (
                    <button onClick={() => setSvcState(key)} className={'text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap border ' + (svcState === key ? 'bg-[#0d5c48] text-white border-[#0d5c48]' : 'bg-white text-[#5c6b62] border-[#dfe3db]')}>{lbl}</button>
                  );
                  return (
                    <div key={i} className={CARD + ' ' + HOVER + ' lg:col-span-2'}>
                      <div className="flex items-center justify-between gap-2 px-[18px] py-[15px] border-b border-[#f2f4ef]">
                        <span className="text-[13px] font-bold text-[#1a2b24]">{sec.title}</span>
                        <span className={badgeCls(sec.status)}>{sec.status}</span>
                      </div>
                      <div className="px-[18px] py-[17px]">
                        <div className="flex flex-wrap gap-2 items-center mb-3">
                          <input value={svcQuery} onChange={(e) => setSvcQuery(e.target.value)} placeholder="Filter services…" className="flex-1 min-w-[220px] text-[12.5px] px-3 py-[7px] border border-[#dfe3db] rounded-lg bg-[#f9faf8] outline-none focus:border-[#0d5c48]" />
                          <div className="flex gap-1.5">{chip('all', 'All ' + svc.total)}{chip('running', 'Running ' + svc.run)}{chip('stopped', 'Stopped ' + svc.stop)}</div>
                        </div>
                        <div className="border border-[#eceee8] rounded-xl overflow-hidden">
                          <div className="max-h-[430px] overflow-auto">
                            <table className="w-full border-collapse text-[12px]">
                              <thead><tr><th className={TH}>Service</th><th className={TH}>State</th><th className={TH}>Start</th><th className={TH}>Account</th></tr></thead>
                              <tbody>
                                {svc.rows.map((r: any, j: number) => {
                                  const running = r[4] === 'Running';
                                  return (
                                    <tr key={j}>
                                      <td className={TD}><div className={'font-semibold text-[#1a2b24] text-[11.5px] ' + MONO}>{r[1]}</div><div className="text-[#8a948b] text-[11px] mt-px">{r[5]}</div></td>
                                      <td className={TD}><span className={'inline-block text-[10.5px] rounded-md px-2 py-0.5 border ' + (running ? 'font-bold text-[#0f7a5c] bg-[#e7f6ee] border-[#c3ead2]' : 'font-semibold text-[#8a948b] bg-[#f0f2ee] border-[#e0e4dc]')}>{r[4]}</span></td>
                                      <td className={TD + ' text-[#5c6b62]'}>{r[3]}</td>
                                      <td className={TD + ' text-[#5c6b62] text-[11px]'}>{r[0]}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        {svc.rows.length === 0 && <div className="py-4 text-center text-[#aab2a8] text-[12px]">No services match.</div>}
                      </div>
                    </div>
                  );
                }
                return <SectionCard key={i} sec={sec} span={spanOf(sec)} />;
              })}
            </div>
          </div>
          </>)}
        </div>
        )}

        <div className="text-center text-[#aab2a8] text-[11.5px] mt-6">Overview · {A.header.name} · all figures reflect the latest agentless collection</div>
      </div>
    </div>
  );
}
