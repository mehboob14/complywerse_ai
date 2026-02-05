'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui';
import { adminApi, OrganizationProfile } from '@/lib/api';

export default function OrganizationProfilePage() {
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<OrganizationProfile>>({});

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getOrganization();
      setProfile(response.data);
      setFormData(response.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load organization profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await adminApi.updateOrganization(formData);
      setSuccess('Organization profile updated successfully');
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Profile"
        subtitle="View and manage your organization settings"
      />

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 text-green-400">
          {success}
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-lg">
        <div className="p-6 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Organization Details</h2>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors"
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
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Organization Name
              </label>
              {editing ? (
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              ) : (
                <p className="text-white">{profile?.name || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Legal Entity
              </label>
              {editing ? (
                <input
                  type="text"
                  value={formData.legal_entity || ''}
                  onChange={(e) => handleChange('legal_entity', e.target.value)}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              ) : (
                <p className="text-white">{profile?.legal_entity || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Industry
              </label>
              {editing ? (
                <select
                  value={formData.industry || ''}
                  onChange={(e) => handleChange('industry', e.target.value)}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
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
                <p className="text-white">{profile?.industry || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Company Size
              </label>
              {editing ? (
                <select
                  value={formData.company_size || ''}
                  onChange={(e) => handleChange('company_size', e.target.value)}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="">Select Size</option>
                  <option value="1-50">1-50 employees</option>
                  <option value="51-200">51-200 employees</option>
                  <option value="201-500">201-500 employees</option>
                  <option value="501-1000">501-1000 employees</option>
                  <option value="1000+">1000+ employees</option>
                </select>
              ) : (
                <p className="text-white">{profile?.company_size || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Geography
              </label>
              {editing ? (
                <input
                  type="text"
                  value={formData.geography || ''}
                  onChange={(e) => handleChange('geography', e.target.value)}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              ) : (
                <p className="text-white">{profile?.geography || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Regulatory Scope
              </label>
              {editing ? (
                <input
                  type="text"
                  value={formData.regulatory_scope || ''}
                  onChange={(e) => handleChange('regulatory_scope', e.target.value)}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              ) : (
                <p className="text-white">{profile?.regulatory_scope || '-'}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Website
              </label>
              {editing ? (
                <input
                  type="url"
                  value={formData.website || ''}
                  onChange={(e) => handleChange('website', e.target.value)}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              ) : (
                <p className="text-white">{profile?.website || '-'}</p>
              )}
            </div>
          </div>

          <div className="border-t border-slate-700 pt-6">
            <h3 className="text-md font-semibold text-white mb-4">Primary Contact</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Contact Name
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={formData.primary_contact_name || ''}
                    onChange={(e) => handleChange('primary_contact_name', e.target.value)}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                  />
                ) : (
                  <p className="text-white">{profile?.primary_contact_name || '-'}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Contact Email
                </label>
                {editing ? (
                  <input
                    type="email"
                    value={formData.primary_contact_email || ''}
                    onChange={(e) => handleChange('primary_contact_email', e.target.value)}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                  />
                ) : (
                  <p className="text-white">{profile?.primary_contact_email || '-'}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Contact Phone
                </label>
                {editing ? (
                  <input
                    type="tel"
                    value={formData.primary_contact_phone || ''}
                    onChange={(e) => handleChange('primary_contact_phone', e.target.value)}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                  />
                ) : (
                  <p className="text-white">{profile?.primary_contact_phone || '-'}</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-700 pt-6">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Address
              </label>
              {editing ? (
                <textarea
                  value={formData.address || ''}
                  onChange={(e) => handleChange('address', e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              ) : (
                <p className="text-white">{profile?.address || '-'}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
