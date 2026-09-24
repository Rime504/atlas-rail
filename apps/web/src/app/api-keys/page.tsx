'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Loader2, Key, Copy, Check } from 'lucide-react';
import { hasPermission } from '@atlas-rail/domain';
import { useApi } from '../../lib/hooks';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../components/Toast';
import { Card, PageHeader, EmptyState, Modal } from '../../components/ui';
import { formatDate } from '../../lib/format';
import type { ApiKeySummary } from '../../lib/types';

export default function ApiKeysPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: keys, loading, refetch } = useApi<ApiKeySummary[]>('/v1/api-keys');
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canManage = user && hasPermission(user.role, 'apikey:manage');

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      await api.delete(`/v1/api-keys/${id}`);
      toast.success('API key revoked');
      refetch();
    } catch (err) {
      toast.error(
        'Could not revoke key',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Access Keys"
        description="Scoped organization developer keys for programmatic payout creation and polling."
        actions={
          canManage && (
            <button onClick={() => setCreateOpen(true)} className="btn-gradient">
              <Plus className="h-4 w-4" />
              Generate API Key
            </button>
          )
        }
      />

      {loading ? (
        <Card className="h-24 p-6">
          <div className="skeleton h-full w-full" />
        </Card>
      ) : !keys || keys.length === 0 ? (
        <Card>
          <EmptyState
            icon={Key}
            title="No API keys yet"
            description="Generate a scoped key to integrate the Atlas Rail API into your own systems."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => (
            <Card key={k.id} className="flex items-center justify-between p-5">
              <div>
                <div className="font-semibold text-slate-200">{k.name}</div>
                <div className="mt-0.5 font-mono text-xs text-slate-500">
                  Prefix: {k.keyPrefix}… · Scopes: [{k.scopes.join(', ')}] · Created{' '}
                  {formatDate(k.createdAt)}
                </div>
              </div>
              {canManage && (
                <button
                  onClick={() => revoke(k.id)}
                  disabled={busyId === k.id}
                  className="rounded-lg p-2 text-rose-400 transition-colors hover:bg-rose-500/10"
                  aria-label="Revoke key"
                >
                  {busyId === k.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <CreateApiKeyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={refetch}
      />
    </div>
  );
}

function CreateApiKeyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post<{ secretKey: string }>('/v1/api-keys', { name, scopes: ['*'] });
      setSecretKey(res.secretKey);
      toast.success('API key generated');
      onCreated();
    } catch (err) {
      toast.error(
        'Could not generate key',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setName('');
    setSecretKey(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Generate API Key"
      description="The secret key is shown once — store it in your secrets manager immediately."
    >
      {secretKey ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-300">
            This is the only time this secret will be shown. It cannot be retrieved again.
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 p-3">
            <code className="break-all font-mono text-xs text-slate-200">{secretKey}</code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(secretKey);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-white/10"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={handleClose} className="btn-gradient">
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="field-label">Key Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="Dev Integration Master Key"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={handleClose} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-gradient">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Generate Key
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
