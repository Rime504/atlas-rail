'use client';

import React, { useState } from 'react';
import { Plus, Loader2, Users, ShieldCheck, Ban } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../components/Toast';
import {
  Card,
  PageHeader,
  StatusBadge,
  EmptyState,
  SkeletonRows,
  MonoAddress,
  Modal,
  RiskBadge,
} from '../../components/ui';
import { formatDate } from '../../lib/format';
import type { Recipient, RecipientType } from '../../lib/types';
import { hasPermission } from '@atlas-rail/domain';

const DEFAULT_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

export default function RecipientsPage() {
  const { user } = useAuth();
  const { data: recipients, loading, refetch } = useApi<Recipient[]>('/v1/recipients');
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canWrite = user && hasPermission(user.role, 'recipient:write');
  const canVerify = user && hasPermission(user.role, 'recipient:verify');
  const canBlock = user && hasPermission(user.role, 'recipient:block');

  const setStatus = async (recipient: Recipient, action: 'verify' | 'block' | 'archive') => {
    setBusyId(recipient.id);
    try {
      await api.post(`/v1/recipients/${recipient.id}/${action}`, {});
      toast.success(
        `Recipient ${action === 'verify' ? 'verified' : action === 'block' ? 'blocked' : 'archived'}`,
        recipient.displayName,
      );
      refetch();
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Registered Recipients"
        description="Allowlist of verified vendor wallets and recipient risk governance."
        actions={
          canWrite && (
            <button onClick={() => setCreateOpen(true)} className="btn-gradient">
              <Plus className="h-4 w-4" />
              Add Recipient
            </button>
          )
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <SkeletonRows rows={5} cols={5} />
        ) : !recipients || recipients.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No recipients registered"
            description="Add a recipient wallet before you can draft a payout to them."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-4">Recipient</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Wallet Address</th>
                  <th className="p-4">Reference</th>
                  <th className="p-4">Risk</th>
                  <th className="p-4">Added</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {recipients.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="p-4">
                      <div className="font-medium text-slate-200">{r.displayName}</div>
                      <div className="text-xs text-slate-500">{r.recipientType}</div>
                    </td>
                    <td className="p-4">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="p-4">
                      <MonoAddress value={r.walletAddress} />
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-400">
                      {r.referenceCode || '—'}
                    </td>
                    <td className="p-4">
                      <RiskBadge level={r.riskLevel} />
                    </td>
                    <td className="p-4 text-xs text-slate-500">{formatDate(r.createdAt)}</td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        {busyId === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                        ) : (
                          <>
                            {canVerify && r.status === 'PENDING' && (
                              <button
                                onClick={() => setStatus(r, 'verify')}
                                className="flex items-center gap-1 text-xs font-semibold text-solana-green hover:underline"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" /> Verify
                              </button>
                            )}
                            {canBlock && r.status !== 'BLOCKED' && (
                              <button
                                onClick={() => setStatus(r, 'block')}
                                className="flex items-center gap-1 text-xs font-semibold text-rose-400 hover:underline"
                              >
                                <Ban className="h-3.5 w-3.5" /> Block
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateRecipientModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={refetch}
      />
    </div>
  );
}

function CreateRecipientModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [displayName, setDisplayName] = useState('');
  const [recipientType, setRecipientType] = useState<RecipientType>('BUSINESS');
  const [walletAddress, setWalletAddress] = useState('');
  const [referenceCode, setReferenceCode] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setDisplayName('');
    setWalletAddress('');
    setReferenceCode('');
    setEmail('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/v1/recipients', {
        displayName,
        recipientType,
        walletAddress,
        expectedMintAddress: DEFAULT_MINT,
        referenceCode: referenceCode || undefined,
        email: email || undefined,
      });
      toast.success('Recipient added', `${displayName} is pending verification.`);
      reset();
      onCreated();
      onClose();
    } catch (err) {
      toast.error(
        'Could not add recipient',
        err instanceof ApiError ? err.message : 'Please check the form and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Recipient"
      description="New recipients start as PENDING until verified."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="field-label">Display Name</label>
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input-field"
            placeholder="Acme Logistics Inc"
          />
        </div>
        <div>
          <label className="field-label">Recipient Type</label>
          <select
            value={recipientType}
            onChange={(e) => setRecipientType(e.target.value as RecipientType)}
            className="input-field"
          >
            <option value="BUSINESS">Business</option>
            <option value="INDIVIDUAL">Individual</option>
            <option value="INTERNAL">Internal</option>
          </select>
        </div>
        <div>
          <label className="field-label">Solana Wallet Address (Devnet)</label>
          <input
            required
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            className="input-field font-mono text-xs"
            placeholder="9WzDXw...9zYtAWWM"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">Reference Code</label>
            <input
              value={referenceCode}
              onChange={(e) => setReferenceCode(e.target.value)}
              className="input-field"
              placeholder="VEN-8821"
            />
          </div>
          <div>
            <label className="field-label">Email (Optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="billing@vendor.com"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-gradient">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Add Recipient
          </button>
        </div>
      </form>
    </Modal>
  );
}
