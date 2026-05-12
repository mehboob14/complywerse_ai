'use client';

import { useEffect, useState } from 'react';
import { Lock, Shield } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';

// Mirrors the GET /admin/password-policy response shape. Kept local because
// no other page consumes it.
interface Policy {
  id: number;
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_special: boolean;
  lockout_threshold: number;
  lockout_minutes: number;
  session_idle_timeout_minutes: number;
  password_history_count: number;
  max_password_age_days: number;
  updated_at: string | null;
}

export default function PasswordPolicyPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  // Edit-mode draft. We only mutate this; on Cancel we discard back to the
  // last-loaded policy. Mirrors the pattern used by the Company Profile page.
  const [draft, setDraft] = useState<Policy | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminApi.getPasswordPolicy();
      setPolicy(r.data as Policy);
      setDraft(r.data as Policy);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        'Failed to load password policy';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setOkMessage(null);
    try {
      const payload = {
        min_length: draft.min_length,
        require_uppercase: draft.require_uppercase,
        require_lowercase: draft.require_lowercase,
        require_digit: draft.require_digit,
        require_special: draft.require_special,
        lockout_threshold: draft.lockout_threshold,
        lockout_minutes: draft.lockout_minutes,
        session_idle_timeout_minutes: draft.session_idle_timeout_minutes,
        password_history_count: draft.password_history_count,
        max_password_age_days: draft.max_password_age_days,
      };
      const r = await adminApi.updatePasswordPolicy(payload);
      setPolicy(r.data as Policy);
      setDraft(r.data as Policy);
      setEditing(false);
      setOkMessage('Password & session policy updated successfully.');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        'Failed to save policy';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Policy>(k: K, v: Policy[K]) => {
    setDraft((p) => (p ? { ...p, [k]: v } : p));
  };

  if (loading) return <PageLoader className="h-64" />;
  if (!policy || !draft) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-700">
        {error || 'Could not load password policy.'}
      </div>
    );
  }

  // Reusable read/edit field — string version (number input). Mirrors the
  // Company Profile page so the two screens feel like the same product.
  const NumberField = ({
    label,
    value,
    onChange,
    min,
    max,
    hint,
  }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
    hint?: string;
  }) => (
    <div>
      <label className="block text-sm font-medium text-slate-500 mb-2">{label}</label>
      {editing ? (
        <>
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          />
          {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
        </>
      ) : (
        <p className="text-black">{value}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-700">
          {error}
        </div>
      )}
      {okMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-emerald-700">
          {okMessage}
        </div>
      )}

      {/* ── Card 1: Password Complexity ───────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-card">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-black flex items-center gap-2">
            <Lock size={16} className="text-slate-600" />
            Password Complexity
          </h2>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm transition-colors"
            >
              Edit Policy
            </button>
          ) : (
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setEditing(false);
                  setDraft(policy);
                  setError(null);
                  setOkMessage(null);
                }}
                className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        <div className="p-6">
          {/* Strict 2x2: minimum-length + character-class group in row 1;
              password history + max age in row 2. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <NumberField
              label="Minimum Length"
              value={draft.min_length}
              onChange={(v) => set('min_length', v)}
              min={8}
              max={128}
              hint="NIST minimum is 8; 12+ is recommended for organisation accounts."
            />

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-2">
                Character Requirements
              </label>
              {editing ? (
                <div className="space-y-2.5">
                  {([
                    ['require_uppercase', 'Uppercase letter (A–Z)'],
                    ['require_lowercase', 'Lowercase letter (a–z)'],
                    ['require_digit', 'Digit (0–9)'],
                    ['require_special', 'Special character (!@#$ etc.)'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={draft[key] as boolean}
                        onChange={(e) => set(key as keyof Policy, e.target.checked as never)}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              ) : (
                <ul className="space-y-1.5 text-sm text-black">
                  {([
                    ['require_uppercase', 'Uppercase letter (A–Z)'],
                    ['require_lowercase', 'Lowercase letter (a–z)'],
                    ['require_digit', 'Digit (0–9)'],
                    ['require_special', 'Special character (!@#$ etc.)'],
                  ] as const).map(([key, label]) => (
                    <li key={key} className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          (policy[key] as boolean) ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                        aria-hidden="true"
                      />
                      <span className={(policy[key] as boolean) ? '' : 'text-slate-400 line-through'}>
                        {label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <NumberField
              label="Disallow Reuse of Last N Passwords"
              value={draft.password_history_count}
              onChange={(v) => set('password_history_count', v)}
              min={0}
              max={24}
              hint="0 disables history checks."
            />

            <NumberField
              label="Max Password Age (days)"
              value={draft.max_password_age_days}
              onChange={(v) => set('max_password_age_days', v)}
              min={0}
              max={730}
              hint="0 disables expiry. Current NIST guidance discourages forced rotation."
            />
          </div>
        </div>
      </div>

      {/* ── Card 2: Account Lockout & Session ─────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-card">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-black flex items-center gap-2">
            <Shield size={16} className="text-slate-600" />
            Account Lockout & Session
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Brute-force protection and idle-session enforcement. Changes apply to all subsequent
            logins.
          </p>
        </div>

        <div className="p-6">
          {/* Strict 2x2: threshold + duration in row 1; idle timeout + spacer
              in row 2. The session-timeout field sits in the row-2 left cell,
              and the right cell is a short reference text for context. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <NumberField
              label="Failed Attempts Before Lock"
              value={draft.lockout_threshold}
              onChange={(v) => set('lockout_threshold', v)}
              min={3}
              max={50}
              hint="Lock the account after this many consecutive failed logins."
            />

            <NumberField
              label="Lock Duration (minutes)"
              value={draft.lockout_minutes}
              onChange={(v) => set('lockout_minutes', v)}
              min={1}
              max={1440}
              hint="How long an account stays locked after the threshold is hit."
            />

            <NumberField
              label="Idle Session Timeout (minutes)"
              value={draft.session_idle_timeout_minutes}
              onChange={(v) => set('session_idle_timeout_minutes', v)}
              min={5}
              max={1440}
              hint="Sign the user out after this many minutes of no keyboard/mouse activity."
            />

            {/* Right-hand info cell — keeps the 2×2 grid balanced and gives
                administrators a quick reference for the active setup. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-700 mb-1">Current configuration</p>
              <ul className="space-y-0.5 text-sm text-slate-600">
                <li>
                  Lockout: <span className="text-black font-medium">{policy.lockout_threshold}</span> attempts → lock for{' '}
                  <span className="text-black font-medium">{policy.lockout_minutes}</span> min
                </li>
                <li>
                  Idle timeout: <span className="text-black font-medium">{policy.session_idle_timeout_minutes}</span> min
                </li>
                {policy.updated_at && (
                  <li className="text-xs text-slate-500 pt-1">
                    Last updated {new Date(policy.updated_at).toLocaleString()}
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
