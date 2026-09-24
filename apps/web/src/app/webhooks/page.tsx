'use client';

import React, { useState } from 'react';
import {
  Plus,
  Send,
  Trash2,
  Loader2,
  Webhook as WebhookIcon,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';
import { WEBHOOK_EVENT_TYPES } from '@atlas-rail/config';
import { hasPermission } from '@atlas-rail/domain';
import { useApi } from '../../lib/hooks';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../components/Toast';
import { Card, PageHeader, EmptyState, Modal, StatusBadge } from '../../components/ui';
import { formatDate } from '../../lib/format';
import type { WebhookDelivery, WebhookEndpoint } from '../../lib/types';

const ALL_EVENTS = Object.values(WEBHOOK_EVENT_TYPES);

export default function WebhooksPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: endpoints, loading, refetch } = useApi<WebhookEndpoint[]>('/v1/webhooks');
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canManage = user && hasPermission(user.role, 'webhook:manage');

  const testDelivery = async (id: string) => {
    setBusyId(id);
    try {
      const res = await api.post<{ signatureHeader: string }>(`/v1/webhooks/${id}/test`);
      toast.success('Test delivery sent', `Signed with ${res.signatureHeader.slice(0, 28)}…`);
      refetch();
    } catch (err) {
      toast.error(
        'Test delivery failed',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await api.delete(`/v1/webhooks/${id}`);
      toast.success('Webhook endpoint removed');
      refetch();
    } catch (err) {
      toast.error(
        'Could not remove endpoint',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Signed Webhooks"
        description="HMAC-SHA256 signed event notifications for ERP and backend system integrations."
        actions={
          canManage && (
            <button onClick={() => setCreateOpen(true)} className="btn-gradient">
              <Plus className="h-4 w-4" />
              Add Webhook Endpoint
            </button>
          )
        }
      />

      {loading ? (
        <Card className="h-32 p-6">
          <div className="skeleton h-full w-full" />
        </Card>
      ) : !endpoints || endpoints.length === 0 ? (
        <Card>
          <EmptyState
            icon={WebhookIcon}
            title="No webhook endpoints configured"
            description="Add an endpoint so your ERP hears about payout lifecycle events without polling."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {endpoints.map((ep) => (
            <Card key={ep.id} className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-bold text-slate-100">{ep.url}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {ep.eventTypes.join(', ')} · {ep._count?.deliveries ?? 0} deliveries
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={ep.status} />
                  {canManage && (
                    <>
                      <button
                        onClick={() => testDelivery(ep.id)}
                        disabled={busyId === ep.id}
                        className="flex items-center gap-1.5 rounded-lg border border-solana-purple/25 bg-solana-purple/10 px-3 py-1.5 text-xs font-semibold text-[#c9a3ff] transition-colors hover:bg-solana-purple/20"
                      >
                        {busyId === ep.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Test
                      </button>
                      <button
                        onClick={() => remove(ep.id)}
                        disabled={busyId === ep.id}
                        className="rounded-lg p-1.5 text-rose-400 transition-colors hover:bg-rose-500/10"
                        aria-label="Delete webhook"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setExpanded(expanded === ep.id ? null : ep.id)}
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${expanded === ep.id ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>
              </div>

              {expanded === ep.id && <DeliveryList webhookId={ep.id} />}
            </Card>
          ))}
        </div>
      )}

      <CreateWebhookModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={refetch}
      />
    </div>
  );
}

function DeliveryList({ webhookId }: { webhookId: string }) {
  const { data: deliveries, loading } = useApi<WebhookDelivery[]>(
    `/v1/webhooks/${webhookId}/deliveries`,
  );
  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Recent Deliveries
      </h3>
      {loading ? (
        <div className="skeleton h-16 w-full" />
      ) : !deliveries || deliveries.length === 0 ? (
        <p className="text-xs text-slate-600">No deliveries yet — send a test to see one here.</p>
      ) : (
        <div className="space-y-1.5">
          {deliveries.slice(0, 10).map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-xs"
            >
              <span className="font-mono text-slate-300">{d.eventType}</span>
              <span className="text-slate-500">{formatDate(d.createdAt)}</span>
              <StatusBadge status={d.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateWebhookModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([...ALL_EVENTS]);
  const [submitting, setSubmitting] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggleEvent = (evt: string) => {
    setEvents((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post<{ secret: string }>('/v1/webhooks', { url, eventTypes: events });
      setSecret(res.secret);
      toast.success('Webhook endpoint created');
      onCreated();
    } catch (err) {
      toast.error(
        'Could not create endpoint',
        err instanceof ApiError ? err.message : 'Please check the URL and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setSecret(null);
    setEvents([...ALL_EVENTS]);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add Webhook Endpoint"
      description="Every delivery is signed with Atlas-Signature: t=<ts>,v1=<hmac>."
    >
      {secret ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-300">
            This signing secret is only shown once. Store it securely — you&rsquo;ll need it to
            verify incoming deliveries.
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 p-3">
            <code className="break-all font-mono text-xs text-slate-200">{secret}</code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(secret);
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
            <label className="field-label">Endpoint URL</label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="input-field font-mono text-xs"
              placeholder="https://your-erp.example.com/webhooks/atlas"
            />
          </div>
          <div>
            <label className="field-label">Subscribed Events</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_EVENTS.map((evt) => (
                <label
                  key={evt}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={events.includes(evt)}
                    onChange={() => toggleEvent(evt)}
                    className="accent-solana-purple"
                  />
                  <span className="font-mono">{evt}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={handleClose} className="btn-ghost">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || events.length === 0}
              className="btn-gradient"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Endpoint
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
