'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { esignApi } from '@/lib/api';
import { authedFetch } from '@/lib/auth-fetch';

/** The drawn signature, fetched with the user's login (a plain image link would be refused). */
export function SignatureImage({ id, className = 'h-10' }: { id: number; className?: string }) {
  const { data } = useQuery({
    queryKey: ['esign-image', id],
    queryFn: async () => {
      const r = await authedFetch(`/api/governance/esignatures/${id}/image`);
      if (!r.ok) throw new Error('signature image');
      return URL.createObjectURL(await r.blob());
    },
    staleTime: Infinity,
    retry: false,
  });
  // eslint-disable-next-line @next/next/no-img-element
  return data ? <img src={data} alt="Drawn signature" className={`rounded border border-slate-200 bg-white ${className}`} /> : <span className={`inline-block w-20 rounded bg-slate-100 ${className}`} />;
}

type Verified = {
  valid: boolean; signer_name: string; signer_title?: string | null; signed_at: string; ip_address?: string | null;
  document_version?: string | null; document_changed_since?: boolean | null;
};

/** What a signed record shows: the drawing, its fingerprint, and a Verify that checks the seal again. */
export default function SignatureSeal({ id, fingerprint, thumb = true }: { id: number; fingerprint: string; thumb?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<Verified | null | false>(null);

  const verify = async () => {
    setBusy(true);
    try { setSeen((await esignApi.get(id)).data as Verified); } catch { setSeen(false); } finally { setBusy(false); }
  };

  return (
    <div className="mt-1.5 flex items-start gap-3">
      {thumb && <SignatureImage id={id} />}
      <div className="min-w-0 text-[11px] text-slate-500">
        <div className="flex flex-wrap items-center gap-x-2">
          <span title="SHA-256 fingerprint of the drawn signature">E-signed · <span className="font-mono">{fingerprint.slice(0, 12)}</span></span>
          <button type="button" onClick={verify} disabled={busy} className="font-medium text-primary-700 hover:underline disabled:opacity-50">
            {busy ? <Loader2 className="inline h-3 w-3 animate-spin" /> : 'Verify'}
          </button>
        </div>
        {seen === false && <p className="mt-0.5 text-rose-600">Could not check this signature.</p>}
        {seen && (
          <p className={`mt-0.5 flex items-start gap-1 ${seen.valid ? 'text-emerald-700' : 'text-rose-600'}`}>
            {seen.valid ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> : <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />}
            <span>
              {seen.valid ? 'Verified: the signature and its record are unchanged.' : 'Does not verify: the signature or its record was changed.'}{' '}
              {seen.signer_name}{seen.signer_title ? `, ${seen.signer_title}` : ''}, {new Date(`${seen.signed_at}Z`).toLocaleString()}
              {seen.ip_address ? ` · ${seen.ip_address}` : ''}{seen.document_version ? ` · version ${seen.document_version}` : ''}.
              {seen.document_changed_since ? ' The document has been edited since.' : ''}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
