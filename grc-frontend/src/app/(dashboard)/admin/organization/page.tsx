'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui';
import { adminApi, OrganizationProfile } from '@/lib/api';

async function ensureTenantContext(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (!response.ok) return false;
    
    const data = await response.json();
    if (data.authenticated && data.tenant) {
      const resolvedSlug = data.tenant.subdomain || data.tenant.slug || '';
      localStorage.setItem('tenant_slug', resolvedSlug);
      localStorage.setItem('tenant_subdomain', resolvedSlug);
      localStorage.setItem('tenant_name', data.tenant.name || '');
      localStorage.setItem('tenant_id', String(data.tenant.id || ''));
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export default function OrganizationProfilePage() {
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<OrganizationProfile>>({});
  const [tenantReady, setTenantReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      const ready = await ensureTenantContext();
      setTenantReady(ready);
      if (ready) {
        fetchProfile();
      } else {
        setLoading(false);
        setError('No company context found. Please log out and log in with your company credentials.');
      }
    };
    init();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getOrganization();
      setProfile(response.data);
      setFormData(response.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load company profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await adminApi.updateOrganization(formData);
      setSuccess('Company profile updated successfully');
      setEditing(false);
      fetchProfile();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: keyof OrganizationProfile, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Profile"
        subtitle="View and manage your company settings"
      />

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-700">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-emerald-700">
          {success}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-card">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-black">Company Details</h2>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm transition-colors"
            >
              Edit Profile
            </button>
          ) : (
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setEditing(false);
                  setFormData(profile || {});
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

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-2">
                Company Name
              </label>
              {editing ? (
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
              ) : (
                <p className="text-black">{profile?.name || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-2">
                Legal Entity
              </label>
              {editing ? (
                <input
                  type="text"
                  value={formData.legal_entity || ''}
                  onChange={(e) => handleChange('legal_entity', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
              ) : (
                <p className="text-black">{profile?.legal_entity || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-2">
                Industry
              </label>
              {editing ? (
                <select
                  value={formData.industry || ''}
                  onChange={(e) => handleChange('industry', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value="">Select Industry</option>
                  <option value="Banking">Banking</option>
                  <option value="Insurance">Insurance</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Technology">Technology</option>
                  <option value="Manufacturing">Manufacturing</option>
                  <option value="Retail">Retail</option>
                  <option value="Government">Government</option>
                  <option value="Other">Other</option>
                </select>
              ) : (
                <p className="text-black">{profile?.industry || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-2">
                Company Size
              </label>
              {editing ? (
                <select
                  value={formData.company_size || ''}
                  onChange={(e) => handleChange('company_size', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value="">Select Size</option>
                  <option value="1-50">1-50 employees</option>
                  <option value="51-200">51-200 employees</option>
                  <option value="201-500">201-500 employees</option>
                  <option value="501-1000">501-1000 employees</option>
                  <option value="1000+">1000+ employees</option>
                </select>
              ) : (
                <p className="text-black">{profile?.company_size || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-2">
                Geography
              </label>
              {editing ? (
                <input
                  type="text"
                  value={formData.geography || ''}
                  onChange={(e) => handleChange('geography', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
              ) : (
                <p className="text-black">{profile?.geography || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-2">
                Regulatory Scope
              </label>
              {editing ? (
                <input
                  type="text"
                  value={formData.regulatory_scope || ''}
                  onChange={(e) => handleChange('regulatory_scope', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
              ) : (
                <p className="text-black">{profile?.regulatory_scope || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-2">
                Website
              </label>
              {editing ? (
                <input
                  type="url"
                  value={formData.website || ''}
                  onChange={(e) => handleChange('website', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
              ) : (
                <p className="text-black">{profile?.website || '-'}</p>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <h3 className="text-md font-semibold text-black mb-4">Primary Contact</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-2">
                  Contact Name
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={formData.primary_contact_name || ''}
                    onChange={(e) => handleChange('primary_contact_name', e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                  />
                ) : (
                  <p className="text-black">{profile?.primary_contact_name || '-'}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-2">
                  Contact Email
                </label>
                {editing ? (
                  <input
                    type="email"
                    value={formData.primary_contact_email || ''}
                    onChange={(e) => handleChange('primary_contact_email', e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                  />
                ) : (
                  <p className="text-black">{profile?.primary_contact_email || '-'}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-2">
                  Contact Phone
                </label>
                {editing ? (
                  <input
                    type="tel"
                    value={formData.primary_contact_phone || ''}
                    onChange={(e) => handleChange('primary_contact_phone', e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                  />
                ) : (
                  <p className="text-black">{profile?.primary_contact_phone || '-'}</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-2">
                Address
              </label>
              {editing ? (
                <textarea
                  value={formData.address || ''}
                  onChange={(e) => handleChange('address', e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-black focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
              ) : (
                <p className="text-black">{profile?.address || '-'}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
