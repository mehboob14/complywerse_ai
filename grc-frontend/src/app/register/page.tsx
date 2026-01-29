'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Shield, ArrowRight, ArrowLeft, Check, AlertCircle, Eye, EyeOff } from 'lucide-react';

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

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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
    if (!formData.organizationName) return 'Organization name is required';
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
          legal_entity_name: formData.legalEntityName || null,
          industry: formData.industry,
          company_size: formData.companySize,
          geography: formData.geography,
          regulatory_scope: formData.regulatoryScope,
          primary_contact_phone: formData.primaryContactPhone || null,
        }),
        credentials: 'include',
      });

      if (response.ok) {
        router.push('/dashboard');
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
          if (data.detail.includes('email') || data.detail.includes('domain')) {
            errorMessage = 'Please use a corporate email address. Free email providers are not accepted.';
          } else {
            errorMessage = data.detail;
          }
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
    <div className="mb-8 flex items-center justify-center gap-2">
      {[1, 2, 3, 4].map((s) => (
        <div key={s} className="flex items-center">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
              s < step
                ? 'bg-green-600 text-white'
                : s === step
                ? 'bg-primary-600 text-white'
                : 'bg-slate-700 text-slate-400'
            }`}
          >
            {s < step ? <Check size={16} /> : s}
          </div>
          {s < 4 && (
            <div
              className={`h-0.5 w-8 ${s < step ? 'bg-green-600' : 'bg-slate-700'}`}
            />
          )}
        </div>
      ))}
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Account Details</h2>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-300">
          Email address
        </label>
        <input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => updateFormData('email', e.target.value)}
          onBlur={() => markTouched('email')}
          className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder="you@company.com"
        />
        {touched.email && formData.email && (
          <p
            className={`mt-1 text-xs ${
              isCorporateEmail(formData.email) ? 'text-green-400' : 'text-yellow-400'
            }`}
          >
            {isCorporateEmail(formData.email)
              ? '✓ Corporate email detected'
              : '⚠ Please use a corporate email address'}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="displayName" className="block text-sm font-medium text-slate-300">
          Full name
        </label>
        <input
          id="displayName"
          type="text"
          value={formData.displayName}
          onChange={(e) => updateFormData('displayName', e.target.value)}
          className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder="John Doe"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-300">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={formData.password}
            onChange={(e) => updateFormData('password', e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 pr-10 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {formData.password && (
          <div className="mt-2">
            <div className="mb-1 flex items-center gap-2">
              <div className="flex h-1.5 flex-1 gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`h-full flex-1 rounded ${
                      i <= passwordStrength ? passwordStrengthLabel.color : 'bg-slate-600'
                    }`}
                  />
                ))}
              </div>
              <span className={`text-xs ${passwordStrengthLabel.color.replace('bg-', 'text-')}`}>
                {passwordStrengthLabel.label}
              </span>
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300">
          Confirm password
        </label>
        <div className="relative">
          <input
            id="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            value={formData.confirmPassword}
            onChange={(e) => updateFormData('confirmPassword', e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 pr-10 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
          >
            {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {formData.confirmPassword && formData.password !== formData.confirmPassword && (
          <p className="mt-1 text-xs text-red-400">Passwords do not match</p>
        )}
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Organization Details</h2>

      <div>
        <label htmlFor="organizationName" className="block text-sm font-medium text-slate-300">
          Organization name <span className="text-red-400">*</span>
        </label>
        <input
          id="organizationName"
          type="text"
          value={formData.organizationName}
          onChange={(e) => updateFormData('organizationName', e.target.value)}
          className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder="Acme Corporation"
        />
      </div>

      <div>
        <label htmlFor="legalEntityName" className="block text-sm font-medium text-slate-300">
          Legal entity name <span className="text-slate-500">(optional)</span>
        </label>
        <input
          id="legalEntityName"
          type="text"
          value={formData.legalEntityName}
          onChange={(e) => updateFormData('legalEntityName', e.target.value)}
          className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder="Acme Corporation Ltd."
        />
      </div>

      <div>
        <label htmlFor="industry" className="block text-sm font-medium text-slate-300">
          Industry <span className="text-red-400">*</span>
        </label>
        <select
          id="industry"
          value={formData.industry}
          onChange={(e) => updateFormData('industry', e.target.value)}
          className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          <option value="">Select industry</option>
          {INDUSTRIES.map((industry) => (
            <option key={industry} value={industry}>
              {industry}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="companySize" className="block text-sm font-medium text-slate-300">
          Company size <span className="text-red-400">*</span>
        </label>
        <select
          id="companySize"
          value={formData.companySize}
          onChange={(e) => updateFormData('companySize', e.target.value)}
          className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          <option value="">Select company size</option>
          {COMPANY_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} employees
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Compliance Profile</h2>

      <div>
        <label htmlFor="geography" className="block text-sm font-medium text-slate-300">
          Geography <span className="text-red-400">*</span>
        </label>
        <select
          id="geography"
          value={formData.geography}
          onChange={(e) => updateFormData('geography', e.target.value)}
          className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          <option value="">Select geography</option>
          {GEOGRAPHIES.map((geo) => (
            <option key={geo} value={geo}>
              {geo}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300">
          Regulatory scope <span className="text-red-400">*</span>
        </label>
        <p className="mb-2 text-xs text-slate-400">Select all that apply</p>
        <div className="grid grid-cols-2 gap-2">
          {REGULATORY_SCOPES.map((scope) => (
            <label
              key={scope}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors ${
                formData.regulatoryScope.includes(scope)
                  ? 'border-primary-500 bg-primary-900/30'
                  : 'border-slate-600 bg-slate-700 hover:border-slate-500'
              }`}
            >
              <input
                type="checkbox"
                checked={formData.regulatoryScope.includes(scope)}
                onChange={() => toggleRegulatoryScope(scope)}
                className="h-4 w-4 rounded border-slate-500 bg-slate-600 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-white">{scope}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="primaryContactPhone" className="block text-sm font-medium text-slate-300">
          Primary contact phone <span className="text-slate-500">(optional)</span>
        </label>
        <input
          id="primaryContactPhone"
          type="tel"
          value={formData.primaryContactPhone}
          onChange={(e) => updateFormData('primaryContactPhone', e.target.value)}
          className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder="+1 (555) 123-4567"
        />
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Review & Submit</h2>

      <div className="space-y-4 rounded-lg bg-slate-800 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-400">Account Details</h3>
          <div className="mt-2 space-y-1 text-sm">
            <p className="text-white">
              <span className="text-slate-400">Email:</span> {formData.email}
            </p>
            <p className="text-white">
              <span className="text-slate-400">Name:</span> {formData.displayName}
            </p>
          </div>
        </div>

        <div className="border-t border-slate-700 pt-4">
          <h3 className="text-sm font-medium text-slate-400">Organization Details</h3>
          <div className="mt-2 space-y-1 text-sm">
            <p className="text-white">
              <span className="text-slate-400">Organization:</span> {formData.organizationName}
            </p>
            {formData.legalEntityName && (
              <p className="text-white">
                <span className="text-slate-400">Legal Entity:</span> {formData.legalEntityName}
              </p>
            )}
            <p className="text-white">
              <span className="text-slate-400">Industry:</span> {formData.industry}
            </p>
            <p className="text-white">
              <span className="text-slate-400">Company Size:</span> {formData.companySize} employees
            </p>
          </div>
        </div>

        <div className="border-t border-slate-700 pt-4">
          <h3 className="text-sm font-medium text-slate-400">Compliance Profile</h3>
          <div className="mt-2 space-y-1 text-sm">
            <p className="text-white">
              <span className="text-slate-400">Geography:</span> {formData.geography}
            </p>
            <p className="text-white">
              <span className="text-slate-400">Regulatory Scope:</span>{' '}
              {formData.regulatoryScope.join(', ')}
            </p>
            {formData.primaryContactPhone && (
              <p className="text-white">
                <span className="text-slate-400">Phone:</span> {formData.primaryContactPhone}
              </p>
            )}
          </div>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-600 bg-slate-700 p-4">
        <input
          type="checkbox"
          checked={formData.termsAccepted}
          onChange={(e) => updateFormData('termsAccepted', e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-500 bg-slate-600 text-primary-600 focus:ring-primary-500"
        />
        <span className="text-sm text-slate-300">
          I agree to the{' '}
          <a href="#" className="text-primary-400 hover:text-primary-300">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href="#" className="text-primary-400 hover:text-primary-300">
            Privacy Policy
          </a>
        </span>
      </label>
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-600">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">ComplyVerse</h1>
          <p className="mt-2 text-slate-400">Create your organization account</p>
        </div>

        {renderStepIndicator()}

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-900/50 p-3 text-red-400">
              <AlertCircle size={18} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}

          <div className="mt-6 flex gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 font-medium text-white hover:bg-slate-600"
              >
                <ArrowLeft size={18} />
                Back
              </button>
            )}
            {step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
              >
                Next
                <ArrowRight size={18} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isLoading}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <Check size={18} />
                    Create Account
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link href="/login" className="text-primary-400 hover:text-primary-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
