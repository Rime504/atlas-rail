'use client';

import React, { useEffect, useState } from 'react';
import { Building, Loader2, Save, UserCircle2, ShieldCheck } from 'lucide-react';
import { ROLE_PERMISSIONS, hasPermission } from '@atlas-rail/domain';
import { useApi } from '../../lib/hooks';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../components/Toast';
import { Card, PageHeader } from '../../components/ui';
import { formatDate } from '../../lib/format';
import type { Organization } from '../../lib/types';

export default function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: org, loading, refetch } = useApi<Organization>('/v1/organizations/current');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (org) setName(org.name);
  }, [org]);

  const canWrite = user && hasPermission(user.role, 'organization:write');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch('/v1/organizations/current', { name });
      toast.success('Organization updated');
      refetch();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Organization Settings"
        description="Manage tenant organization profile, your account, and role-based access."
      />

      <Card className="p-6">
        <h2 className="mb-4 flex items-center border-b border-white/[0.06] pb-3 text-lg font-semibold text-slate-100">
          <Building className="mr-2 h-5 w-5 text-solana-purple" />
          Tenant Organization Profile
        </h2>
        {loading ? (
          <div className="skeleton h-20 w-full" />
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="field-label">Organization Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canWrite}
                className="input-field"
              />
            </div>
            <div>
              <label className="field-label">Organization Slug</label>
              <div className="font-mono text-xs text-slate-500">{org?.slug}</div>
            </div>
            {canWrite && (
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={saving || name === org?.name}
                  className="btn-gradient"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save Changes
                </button>
              </div>
            )}
          </form>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 flex items-center border-b border-white/[0.06] pb-3 text-lg font-semibold text-slate-100">
          <UserCircle2 className="mr-2 h-5 w-5 text-solana-green" />
          Your Account
        </h2>
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <label className="field-label">Display Name</label>
            <div className="font-semibold text-slate-200">{user?.displayName}</div>
          </div>
          <div>
            <label className="field-label">Email</label>
            <div className="font-mono text-xs text-slate-400">{user?.email}</div>
          </div>
          <div>
            <label className="field-label">Role</label>
            <div className="font-semibold text-slate-200">{user?.role}</div>
          </div>
          <div>
            <label className="field-label">Organization Created</label>
            <div className="text-xs text-slate-400">{org ? formatDate(org.createdAt) : '—'}</div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 flex items-center border-b border-white/[0.06] pb-3 text-lg font-semibold text-slate-100">
          <ShieldCheck className="mr-2 h-5 w-5 text-solana-purple" />
          Your Role Permissions
        </h2>
        <div className="flex flex-wrap gap-2">
          {user &&
            ROLE_PERMISSIONS[user.role].map((perm) => (
              <span
                key={perm}
                className="rounded-md border border-white/[0.08] bg-black/20 px-2.5 py-1 font-mono text-[11px] text-slate-300"
              >
                {perm}
              </span>
            ))}
        </div>
      </Card>
    </div>
  );
}
