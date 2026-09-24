'use client';

import React, { useEffect, useState } from 'react';
import { Landmark, ShieldCheck, Lock, Unlock, Plus, Loader2 } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../components/Toast';
import { Card, PageHeader, StatusBadge, EmptyState, MonoAddress } from '../../components/ui';
import { Modal } from '../../components/ui';
import { formatUsdc } from '../../lib/format';
import type { Treasury, TreasuryBalance } from '../../lib/types';
import { hasPermission } from '@atlas-rail/domain';

const DEFAULT_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

export default function TreasuriesPage() {
  const { user } = useAuth();
  const { data: treasuries, loading, refetch } = useApi<Treasury[]>('/v1/treasuries');
  const toast = useToast();
  const [balances, setBalances] = useState<Record<string, TreasuryBalance>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!treasuries) return;
    treasuries.forEach((t) => {
      api
        .get<TreasuryBalance>(`/v1/treasuries/${t.id}/balance`)
        .then((b) => setBalances((prev) => ({ ...prev, [t.id]: b })))
        .catch(() => {});
    });
  }, [treasuries]);

  const canWrite = user && hasPermission(user.role, 'treasury:write');
  const canFreeze = user && hasPermission(user.role, 'treasury:freeze');

  const toggleFreeze = async (treasury: Treasury) => {
    setBusyId(treasury.id);
    try {
      const action = treasury.status === 'ACTIVE' ? 'freeze' : 'unfreeze';
      await api.post(`/v1/treasuries/${treasury.id}/${action}`);
      toast.success(
        treasury.status === 'ACTIVE' ? 'Treasury frozen' : 'Treasury unfrozen',
        `${treasury.name} is now ${treasury.status === 'ACTIVE' ? 'FROZEN' : 'ACTIVE'}.`,
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
        title="Organization Treasuries"
        description="Registered devnet USDC treasuries, live balances, and settlement wallet configuration."
        actions={
          canWrite && (
            <button onClick={() => setCreateOpen(true)} className="btn-gradient">
              <Plus className="h-4 w-4" />
              New Treasury
            </button>
          )
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i} className="h-48 p-6">
              <div className="skeleton h-full w-full" />
            </Card>
          ))}
        </div>
      ) : !treasuries || treasuries.length === 0 ? (
        <Card>
          <EmptyState
            icon={Landmark}
            title="No treasuries registered"
            description="Create a treasury to start drafting payouts."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {treasuries.map((t) => {
            const balance = balances[t.id];
            const activePolicy = t.policies?.find((p) => p.status === 'ACTIVE');
            return (
              <Card key={t.id} hover className="p-6">
                <div className="flex items-start justify-between border-b border-white/[0.06] pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-solana-purple/15 text-solana-purple">
                      <Landmark className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-display text-base font-bold text-white">{t.name}</h2>
                      <span className="font-mono text-[11px] text-slate-500">{t.slug}</span>
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-slate-500">
                      Balance
                    </div>
                    <div className="font-display mt-1 text-xl font-bold text-white">
                      {balance ? (
                        formatUsdc(balance.balanceBaseUnits)
                      ) : (
                        <span className="skeleton inline-block h-5 w-20 align-middle" />
                      )}{' '}
                      <span className="text-sm font-medium text-slate-500">{t.assetSymbol}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-slate-500">
                      Active Policy
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-200">
                      {activePolicy ? (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5 text-solana-green" /> v
                          {activePolicy.version}
                        </>
                      ) : (
                        <span className="text-amber-400">None configured</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                    <span className="text-slate-500">Settlement Wallet</span>
                    <MonoAddress value={t.settlementWalletAddress} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                    <span className="text-slate-500">Token Mint</span>
                    <MonoAddress value={t.mintAddress} />
                  </div>
                </div>

                {canFreeze && (
                  <div className="mt-4 flex justify-end border-t border-white/[0.06] pt-4">
                    <button
                      onClick={() => toggleFreeze(t)}
                      disabled={busyId === t.id}
                      className={t.status === 'ACTIVE' ? 'btn-danger' : 'btn-ghost'}
                    >
                      {busyId === t.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : t.status === 'ACTIVE' ? (
                        <Lock className="h-3.5 w-3.5" />
                      ) : (
                        <Unlock className="h-3.5 w-3.5" />
                      )}
                      {t.status === 'ACTIVE' ? 'Freeze Treasury' : 'Unfreeze Treasury'}
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <CreateTreasuryModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={refetch}
      />
    </div>
  );
}

function CreateTreasuryModal({
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
  const [slug, setSlug] = useState('');
  const [mintAddress, setMintAddress] = useState(DEFAULT_MINT);
  const [settlementWalletAddress, setSettlementWalletAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setSlug('');
    setMintAddress(DEFAULT_MINT);
    setSettlementWalletAddress('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/v1/treasuries', { name, slug, mintAddress, settlementWalletAddress });
      toast.success('Treasury created', `${name} is now active on devnet.`);
      reset();
      onCreated();
      onClose();
    } catch (err) {
      toast.error(
        'Could not create treasury',
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
      title="Register New Treasury"
      description="Devnet only — this does not create an on-chain account."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="field-label">Treasury Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field"
            placeholder="Atlas Main USDC Treasury"
          />
        </div>
        <div>
          <label className="field-label">Slug</label>
          <input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="input-field font-mono"
            placeholder="usdc-devnet-treasury"
          />
        </div>
        <div>
          <label className="field-label">Settlement Wallet Address</label>
          <input
            required
            value={settlementWalletAddress}
            onChange={(e) => setSettlementWalletAddress(e.target.value)}
            className="input-field font-mono text-xs"
            placeholder="Devnet Solana wallet address"
          />
        </div>
        <div>
          <label className="field-label">USDC Token Mint</label>
          <input
            required
            value={mintAddress}
            onChange={(e) => setMintAddress(e.target.value)}
            className="input-field font-mono text-xs"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-gradient">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Treasury
          </button>
        </div>
      </form>
    </Modal>
  );
}
