'use client';

/**
 * Public document attestation page — no dashboard login required.
 * Token in the URL identifies the campaign; tenant via subdomain or ?tenant_slug=.
 * Email must match the campaign creator's organization domain.
 * The person reads the document (as a document: see _Reader.tsx), then acknowledges it below; a bar keeps the way to the form in reach
 * until the form is on screen.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import apiClient, { governanceApi, getTenantSlug } from '@/lib/api';
import SignaturePad from '@/components/governance/SignaturePad';
import { Button, FormField, Notice, TextInput } from '@/components/ui/ds';
import Reader from './_Reader';
import { dueDay, titleLine, type PublicDocument } from './_logic';

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
  document: PublicDocument;
};

const SCREEN = 'flex min-h-screen items-center justify-center bg-ds-bg px-[16px]';
const CARD = 'max-w-md rounded-ds-card border border-ds-border bg-ds-surface p-[32px] text-center';

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

  const formRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [formInView, setFormInView] = useState(false);

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

  // the bar that leads to the form is only for as long as the form is out of sight
  useEffect(() => {
    const form = formRef.current;
    if (!form || typeof IntersectionObserver === 'undefined') return undefined;
    const watch = new IntersectionObserver(([entry]) => setFormInView(entry.isIntersecting), { threshold: 0.1 });
    watch.observe(form);
    return () => watch.disconnect();
  }, [data, done]);

  const toForm = (e: React.MouseEvent) => {
    e.preventDefault();
    formRef.current?.scrollIntoView({ block: 'start' });
    nameRef.current?.focus({ preventScroll: true });
  };

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
      setDone({
        message: (res.data as any)?.message || 'Thank you — your acknowledgment has been recorded.',
      });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setSubmitError(typeof detail === 'string' ? detail : 'Could not submit acknowledgment. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={SCREEN} role="status" aria-label="Loading the document">
        <Loader2 aria-hidden className="h-[32px] w-[32px] animate-spin text-ds-fg-muted" />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <main className={SCREEN}>
        <div className={CARD}>
          <AlertCircle aria-hidden className="mx-auto h-[40px] w-[40px] text-ds-danger" />
          <h1 className="mt-[12px] text-ds-section text-ds-fg">Unable to open attestation</h1>
          <p className="mt-[8px] text-ds-body text-ds-fg-muted">{loadError || 'Link not found.'}</p>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className={SCREEN}>
        <div className={CARD}>
          <CheckCircle2 aria-hidden className="mx-auto h-[40px] w-[40px] text-ds-success" />
          <h1 className="mt-[12px] text-ds-section text-ds-fg">Acknowledgment received</h1>
          <p className="mt-[8px] text-ds-body text-ds-fg-muted" role="status">{done.message}</p>
        </div>
      </main>
    );
  }

  const { campaign, document: doc } = data;
  const domain = campaign.allowed_email_domain;
  const due = dueDay(campaign.due_date);
  const base = apiClient.defaults.baseURL || '/api';

  return (
    <div className="min-h-screen bg-ds-bg">
      <header className="border-b border-ds-border bg-ds-surface">
        <div className="mx-auto flex max-w-[920px] items-center gap-[12px] px-[16px] py-[12px]">
          <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-ds-control bg-ds-primary text-ds-on-primary">
            <FileText aria-hidden className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="m-0 text-ds-label text-ds-fg-muted">Document attestation</p>
            <p className="m-0 truncate text-ds-body font-medium text-ds-fg">{campaign.name}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[920px] px-[16px] pb-[96px] pt-[20px]">
        <section aria-labelledby="doc-title" className="mb-[16px]">
          <h1 id="doc-title" className="m-0 break-words text-ds-title text-ds-fg">{doc.title}</h1>
          <p className="mt-[4px] text-ds-body text-ds-fg-muted">
            {[titleLine(doc), due ? `Due ${due}` : ''].filter(Boolean).join(' · ')}
          </p>
          {doc.description && <p className="mt-[8px] break-words text-ds-body text-ds-fg-body">{doc.description}</p>}
          {campaign.message && <Notice className="mt-[12px]">{campaign.message}</Notice>}
        </section>

        <section aria-label="The document" className="mb-[24px]">
          <Reader doc={doc} base={base} tenantSlug={tenantSlug} />
        </section>

        <section
          id="acknowledge"
          ref={formRef}
          aria-labelledby="ack-title"
          className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px] sm:p-[24px]"
        >
          <h2 id="ack-title" className="m-0 text-ds-section text-ds-fg">Acknowledge</h2>
          <p className="mt-[4px] text-ds-body text-ds-fg-muted">
            By signing below, you confirm that you have read and understood this document.
          </p>
          <form onSubmit={submit} className="mt-[16px] flex flex-col gap-[16px]">
            <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
              <FormField label="Full name" required>
                <TextInput ref={nameRef} required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </FormField>
              <FormField label="Email" required hint={domain ? `Use your organization email ending in @${domain}.` : undefined}>
                <TextInput
                  required
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder={domain ? `you@${domain}` : undefined}
                />
              </FormField>
            </div>
            <FormField label="Designation" required>
              <TextInput
                required
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. Compliance Officer"
                autoComplete="organization-title"
              />
            </FormField>
            <div role="group" aria-labelledby="signature-label">
              <p id="signature-label" className="m-0 mb-[4px] text-ds-label text-ds-fg">Electronic signature</p>
              <SignaturePad onChange={setSignature} />
              <p className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">
                Draw it with your mouse, finger or pen. It is kept with your acknowledgment, with the time and your IP address.
              </p>
            </div>
            {submitError && <Notice tone="danger">{submitError}</Notice>}
            <div>
              <Button type="submit" variant="primary" loading={submitting} className="w-full sm:w-auto">
                Submit acknowledgment
              </Button>
            </div>
          </form>
        </section>
      </main>

      {!formInView && (
        <aside aria-label="Acknowledge" className="fixed inset-x-0 bottom-0 z-20 border-t border-ds-border bg-ds-surface">
          <div className="mx-auto flex max-w-[920px] items-center justify-between gap-[12px] px-[16px] py-[8px]">
            <p className="m-0 min-w-0 text-ds-body text-ds-fg-muted">Read it, then acknowledge.</p>
            <Button href="#acknowledge" variant="primary" onClick={toForm} className="shrink-0">
              Acknowledge
            </Button>
          </div>
        </aside>
      )}
    </div>
  );
}
