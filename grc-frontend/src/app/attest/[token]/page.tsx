'use client';

/**
 * Public document attestation page — no dashboard login required.
 * Token in the URL identifies the campaign; tenant via subdomain or ?tenant_slug=.
 * Email must match the campaign creator's organization domain.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { governanceApi, getTenantSlug } from '@/lib/api';

type PublicPayload = {
  campaign: {
    id: number;
    name: string;
    message?: string;
    due_date?: string;
    status: string;
    allowed_email_domain?: string | null;
    acknowledgment_count?: number;
    attestation_percent?: number | null;
  };
  document: {
    title: string;
    description?: string;
    version?: string;
    doc_type?: string;
    html?: string | null;
    content?: string | null;
    file_name?: string | null;
  };
};

function SignaturePad({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || 480;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = w * ratio;
    canvas.height = 160 * ratio;
    canvas.style.width = `${w}px`;
    canvas.style.height = '160px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, 160);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    hasInk.current = false;
    onChange(null);
  }, [onChange]);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasInk.current = true;
    onChange(canvasRef.current!.toDataURL('image/png'));
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    resize();
  };

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-slate-300 bg-white touch-none">
        <canvas
          ref={canvasRef}
          className="block w-full cursor-crosshair"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
      </div>
      <button type="button" onClick={clear} className="mt-1.5 text-xs text-slate-500 hover:text-slate-800">
        Clear signature
      </button>
    </div>
  );
}

export default function PublicAttestPage() {
  const params = useParams();
  const search = useSearchParams();
  const token = String(params?.token || '');
  const tenantSlug = search.get('tenant_slug') || getTenantSlug();

  const [data, setData] = useState<PublicPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [designation, setDesignation] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ message: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        if (tenantSlug && typeof window !== 'undefined') {
          localStorage.setItem('tenant_slug', tenantSlug);
        }
        const res = await governanceApi.getPublicDocAttestation(token, tenantSlug);
        if (!cancelled) setData(res.data as PublicPayload);
      } catch (e: any) {
        const detail = e?.response?.data?.detail;
        if (!cancelled) {
          setLoadError(
            typeof detail === 'string'
              ? detail
              : e?.response?.status === 410
                ? 'This attestation campaign is closed.'
                : 'This attestation link is invalid or unavailable.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, tenantSlug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!name.trim() || !email.trim()) {
      setSubmitError('Name and email are required.');
      return;
    }
    if (!designation.trim()) {
      setSubmitError('Designation (job title / role) is required.');
      return;
    }
    if (!signature) {
      setSubmitError('Please draw your signature before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await governanceApi.submitPublicDocAttestation(
        token,
        {
          name: name.trim(),
          email: email.trim(),
          designation: designation.trim(),
          signature_data: signature,
        },
        tenantSlug,
      );
      setDone({ message: (res.data as any)?.message || 'Thank you — your acknowledgment has been recorded.' });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setSubmitError(typeof detail === 'string' ? detail : 'Could not submit acknowledgment. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">Unable to open attestation</h1>
          <p className="mt-2 text-sm text-slate-600">{loadError || 'Link not found.'}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">Acknowledgment received</h1>
          <p className="mt-2 text-sm text-slate-600">{done.message}</p>
        </div>
      </div>
    );
  }

  const { campaign, document: doc } = data;
  const domain = campaign.allowed_email_domain;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Document attestation</p>
            <h1 className="text-base font-semibold text-slate-900">{campaign.name}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {campaign.message && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            {campaign.message}
          </div>
        )}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">{doc.title}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {[doc.doc_type, doc.version ? `v${doc.version}` : null].filter(Boolean).join(' · ')}
            </p>
            {doc.description && <p className="mt-2 text-sm text-slate-600">{doc.description}</p>}
          </div>
          <div className="max-h-[50vh] overflow-y-auto px-4 py-4 text-sm leading-relaxed text-slate-800">
            {doc.html ? (
              <div dangerouslySetInnerHTML={{ __html: doc.html }} />
            ) : doc.content ? (
              <pre className="whitespace-pre-wrap font-sans">{doc.content}</pre>
            ) : (
              <p className="text-slate-500">
                Document content is not available for preview
                {doc.file_name ? ` (${doc.file_name})` : ''}. Please review the document with your organization if needed, then acknowledge below.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-semibold text-slate-900">Acknowledge</h2>
          <p className="mt-1 text-sm text-slate-500">
            By signing below, you confirm that you have read and understood this document.
          </p>
          {domain && (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Use your organization email ending in{' '}
              <span className="font-semibold text-slate-800">@{domain}</span>. Other domains are not accepted.
            </p>
          )}
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Full name</label>
                <input
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Email{domain ? ` (@${domain})` : ''}
                </label>
                <input
                  required
                  type="email"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder={domain ? `you@${domain}` : undefined}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Designation</label>
              <input
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. Compliance Officer"
                autoComplete="organization-title"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Digital signature</label>
              <SignaturePad onChange={setSignature} />
            </div>
            {submitError && <p className="text-sm text-rose-600">{submitError}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit acknowledgment
            </button>
          </form>
        </section>

        <p className="pb-8 text-center text-xs text-slate-400">
          Secure attestation link · No app login required
        </p>
      </main>
    </div>
  );
}
