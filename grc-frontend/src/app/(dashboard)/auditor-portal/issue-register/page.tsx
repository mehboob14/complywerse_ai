'use client';

export const dynamic = 'force-dynamic';

/**
 * Auditor Portal → Issue Register — Audit Services' own register.
 *
 * The client's monthly workbook comes in here, and here Audit Services track,
 * validate and report findings. Each finding is also an Issue, so the owners
 * doing the remediation work on it from Issues (Enterprise Log, CAPA Actions).
 */
import { useSearchParams } from 'next/navigation';
import { AuditRegister } from '@/components/audit-register/AuditRegister';
import { useTenantFeatures } from '@/hooks/usePermissions';

export default function IssueRegisterPage() {
  const params = useSearchParams();
  const source = params.get('source') || '';
  const { features, isLoading } = useTenantFeatures();
  if (isLoading) return null;
  if (!features.includes('audit_register')) {
    return <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">The Issue Register is not enabled for your organisation.</p>;
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Issue Register</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Audit Services' register of regulatory, internal audit, pen-test and self-identified
          findings — imported from the monthly workbook, validated here, and reported to the
          Audit Committee.
        </p>
      </div>
      <AuditRegister key={source || 'all'} initialSource={source} />
    </div>
  );
}
