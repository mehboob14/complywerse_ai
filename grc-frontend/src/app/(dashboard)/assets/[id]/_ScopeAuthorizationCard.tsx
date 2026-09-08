'use client';

/**
 * Scanning scope & authorization — external (EASM / domain) assets only.
 *
 * Passive recon (DNS / TLS / headers / WHOIS) is public and always allowed.
 * ACTIVE scanning (port / service probing) is only permitted against a domain
 * we are authorised to touch, so this card captures that authorisation. Two
 * honest paths:
 *   • "I own this domain"  → prove it with a DNS TXT token (verified against a
 *     real public DoH resolver, not a checkbox).
 *   • "Third-party"        → attest to written authorisation + an evidence ref
 *     (the liztek.ca case: a vendor domain we don't own but were permitted to
 *     scan).
 *
 * The authorisation area is HIDDEN until "Enable active scanning" is clicked.
 *
 * ponytail: decision is persisted client-side (localStorage). Production upgrade
 * = a scan_authorization field on the asset + a server-side guard on the active
 * scan endpoint + an audit row. The DNS proof itself is already real.
 */

import { useEffect, useMemo, useState } from 'react';
import { authedFetch } from '@/lib/auth-fetch';

type ScopeAuth = {
  status: 'passive_only' | 'owner_verified' | 'third_party_authorized';
  root: string;
  method?: 'dns_txt' | 'attestation';
  authorized_by?: string; // named authoriser (third-party path)
  actor?: string;         // the ComplyVerse user who recorded it
  authorized_at?: string; // ISO
  evidence_ref?: string;
};

const AC = '#17B898', ACS = '#12A085', AMBER = '#9A6410', AMBER_BG = '#FBF2DF';
const GREEN = '#1F7A54', GREEN_BG = '#E7F5EE', MUTED = '#8A95A1', BORDER = '#E4E8EC';
const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #E8ECEE', borderRadius: 15, boxShadow: '0 1px 2px rgba(16,24,40,.04)', marginBottom: 14 };
const BTN_P: React.CSSProperties = { height: 34, padding: '0 14px', border: `1px solid ${AC}`, background: AC, color: '#06342B', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const BTN_S: React.CSSProperties = { height: 34, padding: '0 13px', border: `1px solid ${BORDER}`, background: '#fff', color: '#3A4653', borderRadius: 10, fontSize: 12, fontWeight: 500, cursor: 'pointer' };
const INPUT: React.CSSProperties = { height: 34, border: `1px solid ${BORDER}`, borderRadius: 9, padding: '0 10px', fontSize: 12.5, width: '100%', background: '#fff' };
const MONO = 'ui-monospace,Consolas,monospace';

// Registrable-root guess: last two labels. Wrong for multi-part TLDs
// (example.co.uk), so the field stays editable — the operator confirms it.
// ponytail: swap in a public-suffix-list lookup if .co.uk-style roots show up.
function guessRoot(domain: string): string {
  const d = (domain || '').toLowerCase().trim().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  const parts = d.split('.').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('.') : d;
}

// Deterministic token so the record is stable across reloads without a server.
// ponytail: real deployments mint a random nonce stored server-side.
function scopeToken(root: string): string {
  let h = 2166136261 >>> 0;
  const s = root.toLowerCase() + '::complyverse-scope';
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const h2 = Math.imul(h ^ 0x9e3779b9, 2654435761) >>> 0;
  return (h.toString(36) + h2.toString(36)).padStart(12, '0');
}

// Real DNS TXT lookup from the browser via public DNS-over-HTTPS JSON APIs
// (both CORS-enabled). Cloudflare first, Google as fallback.
async function lookupTxt(host: string): Promise<string[]> {
  const urls = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=TXT`,
    `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=TXT`,
  ];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const j = await res.json();
      const ans = Array.isArray(j?.Answer) ? j.Answer : [];
      const txts = ans
        .filter((a: any) => a?.type === 16 && typeof a?.data === 'string')
        .map((a: any) => String(a.data).replace(/^"|"$/g, '').replace(/" "/g, ''));
      if (txts.length) return txts;
    } catch { /* try next resolver */ }
  }
  return [];
}

const KEY = (id: number | string) => `cv:scope-auth:${id}`;
function loadAuth(id: number | string, root: string): ScopeAuth {
  if (typeof window === 'undefined') return { status: 'passive_only', root };
  try { const raw = localStorage.getItem(KEY(id)); if (raw) return { root, ...JSON.parse(raw) }; } catch {}
  return { status: 'passive_only', root };
}

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function ScopeAuthorizationCard({ asset, canManage }: { asset: any; canManage: boolean }) {
  const domain: string = asset?.fqdn || asset?.host_name || asset?.name || '';
  const defaultRoot = useMemo(() => guessRoot(domain), [domain]);
  const [auth, setAuth] = useState<ScopeAuth>(() => loadAuth(asset?.id, defaultRoot));
  const [open, setOpen] = useState(false); // the reveal area — closed before click
  const [tab, setTab] = useState<'own' | 'third'>('own');
  const [root, setRoot] = useState(auth.root || defaultRoot);
  const [me, setMe] = useState('');
  // owned-path verify state
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'err' | 'ok' | 'info'; text: string } | null>(null);
  // third-party attestation form
  const [by, setBy] = useState('');
  const [ref, setRef] = useState('');
  const [attested, setAttested] = useState(false);

  useEffect(() => {
    let live = true;
    authedFetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (live && d?.user) setMe(d.user.full_name || d.user.name || d.user.email || '');
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const persist = (rec: ScopeAuth) => {
    setAuth(rec);
    try { localStorage.setItem(KEY(asset?.id), JSON.stringify(rec)); } catch {}
  };

  const token = useMemo(() => scopeToken(root || defaultRoot), [root, defaultRoot]);
  const txtHost = `_complyverse-scope.${root || defaultRoot}`;
  const txtValue = `complyverse-site-verification=${token}`;
  const copy = (t: string) => { try { navigator.clipboard?.writeText(t); } catch {} };

  const verifyOwnership = async () => {
    setChecking(true); setMsg({ tone: 'info', text: 'Querying DNS…' });
    const txts = await lookupTxt(txtHost);
    setChecking(false);
    if (txts.some(t => t.includes(token))) {
      persist({ status: 'owner_verified', root: root || defaultRoot, method: 'dns_txt', actor: me, authorized_at: new Date().toISOString() });
      setMsg(null); setOpen(false);
    } else {
      setMsg({ tone: 'err', text: txts.length
        ? 'A TXT record exists but the token does not match — check you copied the exact value.'
        : 'TXT record not found. DNS changes can take a few minutes to propagate; add the record above, then re-check.' });
    }
  };

  const confirmThirdParty = () => {
    if (!attested || !by.trim()) return;
    persist({ status: 'third_party_authorized', root: root || defaultRoot, method: 'attestation', authorized_by: by.trim(), evidence_ref: ref.trim() || undefined, actor: me, authorized_at: new Date().toISOString() });
    setOpen(false);
  };

  const revoke = () => persist({ status: 'passive_only', root: auth.root || defaultRoot });

  const active = auth.status !== 'passive_only';
  const badge = active
    ? { bg: GREEN_BG, fg: GREEN, label: 'Active scanning authorized' }
    : { bg: AMBER_BG, fg: AMBER, label: 'Passive only' };

  return (
    <div style={CARD}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 16px', borderBottom: '1px solid #F0F3F5' }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, background: AMBER, flex: 'none' }} />
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={ACS} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>
        <h4 style={{ fontSize: 12.5, fontWeight: 600, flex: 1, margin: 0 }}>Scanning scope &amp; authorization</h4>
        <span style={{ background: badge.bg, color: badge.fg, borderRadius: 999, padding: '3px 10px', fontSize: 10.5, fontWeight: 600 }}>{badge.label}</span>
      </div>

      {/* body */}
      <div style={{ padding: '14px 16px' }}>
        {active ? (
          <div>
            <div style={{ fontSize: 12, color: '#3A4653', lineHeight: 1.55 }}>
              Active scanning is authorized for <b className="mono" style={{ fontFamily: MONO }}>{auth.root}</b> and its subdomains
              {auth.method === 'dns_txt' ? ' via verified DNS ownership' : ' via written third-party authorization'}.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 10, fontSize: 11.5, color: MUTED }}>
              <span>Method: <b style={{ color: '#3A4653', fontWeight: 600 }}>{auth.method === 'dns_txt' ? 'DNS TXT ownership' : 'Third-party attestation'}</b></span>
              {auth.authorized_by && <span>Authorized by: <b style={{ color: '#3A4653', fontWeight: 600 }}>{auth.authorized_by}</b></span>}
              {auth.actor && <span>Recorded by: <b style={{ color: '#3A4653', fontWeight: 600 }}>{auth.actor}</b></span>}
              {auth.authorized_at && <span>On: <b style={{ color: '#3A4653', fontWeight: 600 }}>{fmtDate(auth.authorized_at)}</b></span>}
              {auth.evidence_ref && <span>Evidence: <b className="mono" style={{ color: '#3A4653', fontWeight: 600, fontFamily: MONO }}>{auth.evidence_ref}</b></span>}
            </div>
            {canManage && <button type="button" onClick={revoke} style={{ ...BTN_S, marginTop: 12, color: '#B23A3A', borderColor: '#F0D2D2' }}>Revoke — set back to passive</button>}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: '#3A4653', lineHeight: 1.55 }}>
              This external asset is scanned <b>passively only</b> (public DNS, TLS, HTTP headers and WHOIS). Active port &amp; service
              scanning needs authorization for <b className="mono" style={{ fontFamily: MONO }}>{defaultRoot || domain || 'this domain'}</b> before it can run.
            </div>
            {!open && (
              canManage
                ? <button type="button" onClick={() => { setOpen(true); setMsg(null); }} style={{ ...BTN_P, marginTop: 12 }}>Enable active scanning</button>
                : <div style={{ marginTop: 12, fontSize: 11.5, color: MUTED }}>You do not have permission to change scanning scope. Ask an asset administrator.</div>
            )}
          </div>
        )}

        {/* ── reveal area: rendered only after the button is clicked ── */}
        {open && !active && (
          <div style={{ marginTop: 14, borderTop: '1px solid #F0F3F5', paddingTop: 14 }}>
            {/* method chooser */}
            <div style={{ display: 'inline-flex', background: '#F1F4F6', borderRadius: 10, padding: 3, gap: 3, marginBottom: 14 }}>
              {([['own', 'I own this domain'], ['third', 'Third-party (written authorization)']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => { setTab(k); setMsg(null); }} style={{ height: 28, padding: '0 12px', border: 0, borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: tab === k ? '#fff' : 'transparent', color: tab === k ? ACS : '#6B7787', boxShadow: tab === k ? '0 1px 2px rgba(16,24,40,.08)' : 'none' }}>{label}</button>
              ))}
            </div>

            {/* domain to authorize (the "create / confirm the domain" step, both paths) */}
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#3A4653', marginBottom: 5 }}>Root domain to bring into scope</label>
            <input value={root} onChange={e => setRoot(e.target.value)} spellCheck={false} style={{ ...INPUT, fontFamily: MONO, maxWidth: 340 }} />
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>Authorization covers this apex domain and every subdomain under it.</div>

            {tab === 'own' ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11.5, color: '#3A4653', marginBottom: 8 }}>Publish this TXT record in the domain's DNS, then verify:</div>
                <div style={{ background: '#F7FBFA', border: '1px solid #F0F3F5', borderRadius: 9, padding: '10px 12px', fontFamily: MONO, fontSize: 11.5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ color: MUTED, width: 42, flex: 'none' }}>Host</span>
                    <span style={{ flex: 1, wordBreak: 'break-all', color: '#0F1F2B' }}>{txtHost}</span>
                    <button type="button" onClick={() => copy(txtHost)} style={{ ...BTN_S, height: 24, padding: '0 8px', fontSize: 10.5 }}>Copy</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: MUTED, width: 42, flex: 'none' }}>Value</span>
                    <span style={{ flex: 1, wordBreak: 'break-all', color: '#0F1F2B' }}>{txtValue}</span>
                    <button type="button" onClick={() => copy(txtValue)} style={{ ...BTN_S, height: 24, padding: '0 8px', fontSize: 10.5 }}>Copy</button>
                  </div>
                </div>
                {msg && <div style={{ marginTop: 10, fontSize: 11.5, color: msg.tone === 'err' ? '#B23A3A' : msg.tone === 'ok' ? GREEN : MUTED }}>{msg.text}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="button" onClick={verifyOwnership} disabled={checking || !root.trim()} style={{ ...BTN_P, opacity: checking || !root.trim() ? 0.6 : 1 }}>{checking ? 'Verifying…' : 'Verify DNS record'}</button>
                  <button type="button" onClick={() => setOpen(false)} style={BTN_S}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11.5, color: '#3A4653', marginBottom: 10 }}>
                  Use this when the domain belongs to a third party (e.g. a vendor) and you hold <b>written authorization</b> to scan it. We do not
                  attempt to prove ownership — you are attesting to the authorization on record.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 520 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#3A4653', marginBottom: 5 }}>Authorized by <span style={{ color: '#B23A3A' }}>*</span></label>
                    <input value={by} onChange={e => setBy(e.target.value)} placeholder="Person / organization" style={INPUT} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#3A4653', marginBottom: 5 }}>Evidence reference</label>
                    <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Ticket / contract # / link" style={INPUT} />
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, fontSize: 11.5, color: '#3A4653', cursor: 'pointer', maxWidth: 520 }}>
                  <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>I confirm ComplyVerse has documented written authorization from the domain owner to perform active scanning of <b className="mono" style={{ fontFamily: MONO }}>{root || defaultRoot}</b>.</span>
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button type="button" onClick={confirmThirdParty} disabled={!attested || !by.trim()} style={{ ...BTN_P, opacity: !attested || !by.trim() ? 0.6 : 1 }}>Authorize active scanning</button>
                  <button type="button" onClick={() => setOpen(false)} style={BTN_S}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
