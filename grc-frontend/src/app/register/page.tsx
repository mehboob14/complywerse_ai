'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, Check, AlertCircle, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';

const INDUSTRIES = [
  'Financial Services',
  'Healthcare',
  'Technology',
  'Manufacturing',
  'Retail',
  'Energy',
  'Government',
  'Education',
  'Other',
];

const COMPANY_SIZES = ['1-50', '51-200', '201-500', '501-1000', '1000+'];

const GEOGRAPHIES = [
  'North America',
  'Europe',
  'Middle East',
  'Asia Pacific',
  'Africa',
  'Latin America',
  'Global',
];

const REGULATORY_SCOPES = [
  'PCI-DSS',
  'SOX',
  'GDPR',
  'HIPAA',
  'ISO 27001',
  'NIST',
  'SAMA CSF',
  'Other',
];

const FREE_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'mail.com',
  'protonmail.com',
  'yandex.com',
  'zoho.com',
];

interface FormData {
  email: string;
  password: string;
  confirmPassword: string;
  displayName: string;
  organizationName: string;
  legalEntityName: string;
  industry: string;
  companySize: string;
  geography: string;
  regulatoryScope: string[];
  primaryContactPhone: string;
  termsAccepted: boolean;
}

// Shared field styling (matches the login screen's pill inputs).
const INPUT_BASE =
  'block w-full rounded-full border border-slate-200 bg-slate-50/80 py-3 text-[14px] text-slate-900 placeholder:font-normal placeholder:text-slate-400/70 outline-none transition-all focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-500/15 hover:border-slate-300';
const FIELD = `${INPUT_BASE} px-4`;
const FIELD_PW = `${INPUT_BASE} pl-4 pr-11`;
const SELECT = `${INPUT_BASE} pl-4 pr-10 appearance-none cursor-pointer`;
const LABEL = 'mb-1 block pl-1 text-[13px] font-medium text-slate-700';
const STEP_LABELS = ['Account', 'Company', 'Compliance', 'Review'];

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // CRITICAL: Clear ALL localStorage on page load to prevent cross-tenant data leakage
  useEffect(() => {
    localStorage.clear();
  }, []);

  // Fail closed: if self-serve registration is off, bounce to login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/registration-status', { credentials: 'include' });
        if (!res.ok) {
          if (!cancelled) router.replace('/login');
          return;
        }
        const data = await res.json();
        if (!cancelled && !data?.open) router.replace('/login');
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    confirmPassword: '',
    displayName: '',
    organizationName: '',
    legalEntityName: '',
    industry: '',
    companySize: '',
    geography: '',
    regulatoryScope: [],
    primaryContactPhone: '',
    termsAccepted: false,
  });

  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const updateFormData = (field: keyof FormData, value: string | string[] | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const markTouched = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const isCorporateEmail = (email: string) => {
    if (!isValidEmail(email)) return false;
    const domain = email.split('@')[1]?.toLowerCase();
    return domain && !FREE_EMAIL_DOMAINS.includes(domain);
  };

  const getPasswordStrength = (password: string) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z\d]/.test(password)) strength++;
    return strength;
  };

  const passwordStrength = useMemo(() => getPasswordStrength(formData.password), [formData.password]);

  const passwordStrengthLabel = useMemo(() => {
    if (passwordStrength <= 1) return { label: 'Weak', color: 'bg-red-500' };
    if (passwordStrength <= 2) return { label: 'Fair', color: 'bg-yellow-500' };
    if (passwordStrength <= 3) return { label: 'Good', color: 'bg-blue-500' };
    return { label: 'Strong', color: 'bg-green-500' };
  }, [passwordStrength]);

  const validateStep1 = () => {
    if (!formData.email) return 'Email is required';
    if (!isValidEmail(formData.email)) return 'Please enter a valid email address';
    if (!isCorporateEmail(formData.email)) return 'Please use a corporate email address';
    if (!formData.password) return 'Password is required';
    if (formData.password.length < 8) return 'Password must be at least 8 characters';
    if (formData.password !== formData.confirmPassword) return 'Passwords do not match';
    if (!formData.displayName) return 'Full name is required';
    return null;
  };

  const validateStep2 = () => {
    if (!formData.organizationName) return 'Company name is required';
    if (!formData.industry) return 'Please select an industry';
    if (!formData.companySize) return 'Please select a company size';
    return null;
  };

  const validateStep3 = () => {
    if (!formData.geography) return 'Please select a geography';
    if (formData.regulatoryScope.length === 0) return 'Please select at least one regulatory scope';
    return null;
  };

  const validateCurrentStep = () => {
    switch (step) {
      case 1:
        return validateStep1();
      case 2:
        return validateStep2();
      case 3:
        return validateStep3();
      default:
        return null;
    }
  };

  const handleNext = () => {
    const validationError = validateCurrentStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setError('');
    setStep((prev) => prev - 1);
  };

  const toggleRegulatoryScope = (scope: string) => {
    const currentScopes = formData.regulatoryScope;
    if (currentScopes.includes(scope)) {
      updateFormData(
        'regulatoryScope',
        currentScopes.filter((s) => s !== scope)
      );
    } else {
      updateFormData('regulatoryScope', [...currentScopes, scope]);
    }
  };

  const handleSubmit = async () => {
    if (!formData.termsAccepted) {
      setError('Please accept the terms and conditions');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/register-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          display_name: formData.displayName,
          organization_name: formData.organizationName,
          legal_entity: formData.legalEntityName || null,
          industry: formData.industry,
          company_size: formData.companySize,
          geography: formData.geography,
          regulatory_scope: formData.regulatoryScope.join(', '),
          primary_contact_phone: formData.primaryContactPhone || null,
        }),
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        // CRITICAL: Clear ALL previous localStorage to prevent cross-tenant data
        // leakage. Don't carry the auto-issued auth token into the new tenant's
        // login flow either — registration finishes by sending the user to the
        // login page so they can authenticate explicitly.
        localStorage.clear();

        // Subdomain-first tenant routing (restored from the temporary
        // single-host mode):
        //   - From plain `localhost` we now DO redirect to
        //     `{subdomain}.localhost:{port}/login` so the new tenant gets
        //     its own subdomain origin from the moment the user logs in.
        //     *.localhost auto-resolves to 127.0.0.1 on modern OSes.
        //   - From a dotted host (`app.example.com`) we redirect to
        //     `{subdomain}.example.com/login` as before.
        //   - Bare IPv4 hosts still skip the redirect — `acme.10.0.0.5`
        //     isn't reachable. Those deployments stay single-origin.
        const subdomain = data.tenant?.subdomain || data.tenant?.slug;
        const { protocol, hostname, port } = window.location;
        const isBareIPv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
        const canRedirectCrossSubdomain = !!subdomain && !isBareIPv4;

        if (canRedirectCrossSubdomain) {
          const baseHost = hostname.endsWith('.localhost')
            ? 'localhost'
            : hostname.split('.').slice(-2).join('.');
          const emailParam = encodeURIComponent(formData.email);
          const target = `${protocol}//${subdomain}.${baseHost}${port ? ':' + port : ''}/login?registered=1&email=${emailParam}`;
          window.location.href = target;
          return;
        }
        // Same-origin login (single-tenant or IP-only deployment). The
        // login form's email-domain match will route to the new tenant
        // automatically, so no host change is needed.
        router.push(`/login?registered=1&email=${encodeURIComponent(formData.email)}`);
      } else {
        const data = await response.json();
        let errorMessage = 'Registration failed. Please try again.';

        if (Array.isArray(data.detail)) {
          const messages = data.detail.map((err: { msg?: string; loc?: string[] }) => {
            const field = err.loc?.slice(-1)[0] || 'field';
            return err.msg || `Invalid ${field}`;
          });
          errorMessage = messages.join('. ');
        } else if (typeof data.detail === 'string') {
          // Only relabel as "use a corporate email" when the backend
          // *explicitly* rejected the domain as a free provider. Anything
          // else (duplicate user, tenant slug taken, malformed input,
          // server bug, etc.) should surface the actual message — the
          // previous catch-all of "any error mentioning 'email'" was
          // masking real failures.
          const detailLower = data.detail.toLowerCase();
          const isFreeDomainRejection =
            detailLower.includes('free email') ||
            detailLower.includes('corporate email') ||
            detailLower.includes('not a corporate') ||
            detailLower.includes('disposable email');
          errorMessage = isFreeDomainRejection
            ? 'Please use a corporate email address. Free email providers are not accepted.'
            : data.detail;
        }

        setError(errorMessage);
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderStepIndicator = () => (
    <div className="mb-3.5">
      <div className="flex items-center">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const active = n === step;
          return (
            <div key={label} className={`flex items-center ${n < 4 ? 'flex-1' : ''}`}>
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    done
                      ? 'bg-primary-600 text-white'
                      : active
                      ? 'bg-primary-700 text-white ring-4 ring-primary-500/15'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {done ? <Check size={15} /> : n}
                </div>
                {/* The active step names itself on mobile; the rest stay numbers
                    so the row still fits a narrow screen. */}
                <span className={`text-xs font-medium ${active ? 'inline' : 'hidden sm:inline'} ${active || done ? 'text-slate-700' : 'text-slate-400'}`}>
                  {label}
                </span>
              </div>
              {n < 4 && <div className={`mx-2 h-0.5 flex-1 rounded ${done ? 'bg-primary-500' : 'bg-slate-200'}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-3">
      <div>
        <label htmlFor="email" className={LABEL}>Email address</label>
        <input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => updateFormData('email', e.target.value)}
          onBlur={() => markTouched('email')}
          className={FIELD}
          placeholder="you@company.com"
        />
        {touched.email && formData.email && (
          <p className={`mt-1 text-xs ${isCorporateEmail(formData.email) ? 'text-emerald-600' : 'text-amber-600'}`}>
            {isCorporateEmail(formData.email) ? '✓ Corporate email detected' : '⚠ Please use a corporate email address'}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="displayName" className={LABEL}>Full name</label>
        <input
          id="displayName"
          type="text"
          value={formData.displayName}
          onChange={(e) => updateFormData('displayName', e.target.value)}
          className={FIELD}
          placeholder="John Doe"
        />
      </div>

      <div>
        <label htmlFor="password" className={LABEL}>Password</label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={formData.password}
            onChange={(e) => updateFormData('password', e.target.value)}
            className={FIELD_PW}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {formData.password && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex h-1.5 flex-1 gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={`h-full flex-1 rounded ${i <= passwordStrength ? passwordStrengthLabel.color : 'bg-slate-200'}`} />
              ))}
            </div>
            <span className={`text-xs font-medium ${passwordStrengthLabel.color.replace('bg-', 'text-')}`}>
              {passwordStrengthLabel.label}
            </span>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className={LABEL}>Confirm password</label>
        <div className="relative">
          <input
            id="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            value={formData.confirmPassword}
            onChange={(e) => updateFormData('confirmPassword', e.target.value)}
            className={FIELD_PW}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {formData.confirmPassword && formData.password !== formData.confirmPassword && (
          <p className="mt-1 text-xs text-rose-600">Passwords do not match</p>
        )}
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-3">
      <div>
        <label htmlFor="organizationName" className={LABEL}>Company name <span className="text-rose-500">*</span></label>
        <input
          id="organizationName"
          type="text"
          value={formData.organizationName}
          onChange={(e) => updateFormData('organizationName', e.target.value)}
          className={FIELD}
          placeholder="Acme Corporation"
        />
      </div>

      <div>
        <label htmlFor="legalEntityName" className={LABEL}>Legal entity name <span className="text-slate-400">(optional)</span></label>
        <input
          id="legalEntityName"
          type="text"
          value={formData.legalEntityName}
          onChange={(e) => updateFormData('legalEntityName', e.target.value)}
          className={FIELD}
          placeholder="Acme Corporation Ltd."
        />
      </div>

      <div>
        <label htmlFor="industry" className={LABEL}>Industry <span className="text-rose-500">*</span></label>
        <div className="relative">
          <select id="industry" value={formData.industry} onChange={(e) => updateFormData('industry', e.target.value)} className={SELECT}>
            <option value="">Select industry</option>
            {INDUSTRIES.map((industry) => (
              <option key={industry} value={industry}>{industry}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      <div>
        <label htmlFor="companySize" className={LABEL}>Company size <span className="text-rose-500">*</span></label>
        <div className="relative">
          <select id="companySize" value={formData.companySize} onChange={(e) => updateFormData('companySize', e.target.value)} className={SELECT}>
            <option value="">Select company size</option>
            {COMPANY_SIZES.map((size) => (
              <option key={size} value={size}>{size} employees</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-3">
      <div>
        <label htmlFor="geography" className={LABEL}>Geography <span className="text-rose-500">*</span></label>
        <div className="relative">
          <select id="geography" value={formData.geography} onChange={(e) => updateFormData('geography', e.target.value)} className={SELECT}>
            <option value="">Select geography</option>
            {GEOGRAPHIES.map((geo) => (
              <option key={geo} value={geo}>{geo}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      <div>
        <label className={LABEL}>
          Regulatory scope <span className="text-rose-500">*</span>{' '}
          <span className="font-normal text-slate-400">— select all that apply</span>
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {REGULATORY_SCOPES.map((scope) => {
            const checked = formData.regulatoryScope.includes(scope);
            return (
              <button
                type="button"
                key={scope}
                onClick={() => toggleRegulatoryScope(scope)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-sm transition-colors ${
                  checked ? 'border-primary-500 bg-primary-50 text-slate-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-primary-500 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>
                  {checked && <Check size={12} strokeWidth={3} />}
                </span>
                {scope}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="primaryContactPhone" className={LABEL}>Primary contact phone <span className="text-slate-400">(optional)</span></label>
        <input
          id="primaryContactPhone"
          type="tel"
          value={formData.primaryContactPhone}
          onChange={(e) => updateFormData('primaryContactPhone', e.target.value)}
          className={FIELD}
          placeholder="+1 (555) 123-4567"
        />
      </div>
    </div>
  );

  const ReviewRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-2.5">
      <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Account</h3>
          <div className="space-y-0.5">
            <ReviewRow label="Email" value={formData.email} />
            <ReviewRow label="Name" value={formData.displayName} />
          </div>
        </div>
        <div className="border-t border-slate-200 pt-2.5">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Company</h3>
          <div className="space-y-0.5">
            <ReviewRow label="Company" value={formData.organizationName} />
            {formData.legalEntityName && <ReviewRow label="Legal entity" value={formData.legalEntityName} />}
            <ReviewRow label="Industry" value={formData.industry} />
            <ReviewRow label="Company size" value={`${formData.companySize} employees`} />
          </div>
        </div>
        <div className="border-t border-slate-200 pt-2.5">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Compliance profile</h3>
          <div className="space-y-0.5">
            <ReviewRow label="Geography" value={formData.geography} />
            <ReviewRow label="Regulatory scope" value={formData.regulatoryScope.join(', ')} />
            {formData.primaryContactPhone && <ReviewRow label="Phone" value={formData.primaryContactPhone} />}
          </div>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
        <input
          type="checkbox"
          checked={formData.termsAccepted}
          onChange={(e) => updateFormData('termsAccepted', e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 bg-white text-primary-600 focus:ring-primary-500"
        />
        <span className="text-sm text-slate-600">
          I agree to the{' '}
          <a href="https://compliverse.ai/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-primary-700 hover:text-primary-800">Terms of Service</a>{' '}
          and{' '}
          <a href="https://compliverse.ai/privacy-policy" target="_blank" rel="noopener noreferrer" className="font-medium text-primary-700 hover:text-primary-800">Privacy Policy</a>.
        </span>
      </label>
    </div>
  );

  return (
    <AuthShell tagline="Set up your organization's compliance workspace in four steps.">
      {/* No "Step 2 of 4 — …" line: the indicator below already says where you
          are, and now names the active step on mobile too. */}
      <div className="mb-3">
        <h2 className="text-2xl font-bold leading-tight tracking-tight text-slate-900">Create your account</h2>
      </div>

      {renderStepIndicator()}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="text-xs">{error}</span>
        </div>
      )}

      <div key={step} className="auth-fade-up">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>

      <div className="mt-3.5 flex gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={handleBack}
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        )}
        {step < 4 ? (
          <button
            type="button"
            onClick={handleNext}
            className="auth-cta group flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary-400 via-primary-600 to-primary-700 px-4 py-3 text-sm font-bold text-white shadow-[0_14px_30px_-14px_rgba(13,148,136,0.65)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-14px_rgba(13,148,136,0.7)]"
          >
            <span className="inline-flex items-center gap-2">
              Continue
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading}
            className="auth-cta group flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary-400 via-primary-600 to-primary-700 px-4 py-3 text-sm font-bold text-white shadow-[0_14px_30px_-14px_rgba(13,148,136,0.65)] transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-14px_rgba(13,148,136,0.7)] disabled:translate-y-0 disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  <Check size={16} />
                  Create account
                </>
              )}
            </span>
          </button>
        )}
      </div>

      <p className="mt-3.5 text-center text-[13px] text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-primary-700 underline-offset-2 hover:text-primary-800 hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
