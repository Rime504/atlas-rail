'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  Lock,
  Mail,
  ArrowRight,
  Landmark,
  GitBranch,
  FileCheck2,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { ApiError } from '../../lib/api';

const DEMO_ACCOUNTS = [
  {
    email: 'owner@atlasrail.local',
    name: 'Elena Rostova',
    role: 'Owner',
    description: 'Full governance access',
  },
  {
    email: 'operator@atlasrail.local',
    name: 'Marcus Vance',
    role: 'Operator',
    description: 'Draft payouts & recipients',
  },
  {
    email: 'approver1@atlasrail.local',
    name: 'Sarah Jenkins',
    role: 'Approver',
    description: 'Independent authorization',
  },
  {
    email: 'auditor@atlasrail.local',
    name: 'Compliance Officer',
    role: 'Auditor',
    description: 'Read-only ledger access',
  },
];

const DEMO_PASSWORD = 'ChangeMe_AtlasRail_DevOnly';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(loginEmail, loginPassword);
      router.push('/');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 0
            ? err.message
            : 'Invalid credentials, or the account is disabled.'
          : 'Something went wrong signing in.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-2">
      {/* Left: brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.06] p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-solana-purple/25 blur-[120px]" />
          <div className="absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-solana-green/15 blur-[120px]" />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-solana-gradient font-display text-lg font-bold text-[#05060f] shadow-glow">
            A
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white">
            Atlas Rail
          </span>
        </div>

        <div className="relative max-w-lg">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Devnet-only policy sandbox
          </div>
          <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight text-white">
            The governance layer between{' '}
            <span className="gradient-text">&ldquo;approved&rdquo;</span> and{' '}
            <span className="gradient-text">&ldquo;sent.&rdquo;</span>
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-slate-400">
            Programmable spend limits, multi-person approval, pre-flight simulation, and an
            append-only audit ledger for Solana USDC payouts — without ever taking custody of a
            private key.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <Landmark className="h-4 w-4 text-solana-green" />
              <p className="mt-2 text-xs font-semibold text-slate-200">Spend Policy</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Limits &amp; approvals</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <ShieldCheck className="h-4 w-4 text-solana-purple" />
              <p className="mt-2 text-xs font-semibold text-slate-200">Simulation</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Program-ID allowlist</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <FileCheck2 className="h-4 w-4 text-solana-green" />
              <p className="mt-2 text-xs font-semibold text-slate-200">Audit Ledger</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Append-only</p>
            </div>
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-slate-600">
          <GitBranch className="h-3.5 w-3.5" />
          Apache 2.0 · Open source · Self-hostable
        </div>
      </div>

      {/* Right: form */}
      <div className="flex flex-col items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-solana-gradient font-display text-base font-bold text-[#05060f]">
              A
            </div>
            <span className="font-display text-base font-bold text-white">Atlas Rail</span>
          </div>

          <h2 className="font-display text-2xl font-bold text-white">Sign in to your treasury</h2>
          <p className="mt-1.5 text-sm text-mutedText">
            Enter your credentials to access the operator console.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              doLogin(email, password);
            }}
            className="mt-7 space-y-4"
          >
            <div>
              <label className="field-label">Email address</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="input-field pl-10"
                  autoComplete="email"
                />
              </div>
            </div>
            <div>
              <label className="field-label">Password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="input-field pl-10"
                  autoComplete="current-password"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3.5 py-2.5 text-xs font-medium text-rose-300">
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting} className="btn-gradient w-full">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-9">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.08]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                Quick demo access
              </span>
              <div className="h-px flex-1 bg-white/[0.08]" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {DEMO_ACCOUNTS.map((acct) => (
                <button
                  key={acct.email}
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setEmail(acct.email);
                    setPassword(DEMO_PASSWORD);
                    doLogin(acct.email, DEMO_PASSWORD);
                  }}
                  className="group rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-left transition-all duration-200 hover:border-solana-purple/40 hover:bg-white/[0.05] disabled:opacity-50"
                >
                  <p className="text-xs font-semibold text-slate-200 group-hover:text-white">
                    {acct.role}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">{acct.name}</p>
                  <p className="mt-1 truncate text-[10px] text-slate-600">{acct.description}</p>
                </button>
              ))}
            </div>
            <p className="mt-4 text-center text-[11px] text-slate-600">
              Seeded accounts from <code className="text-slate-500">make db-seed</code> · password{' '}
              <code className="text-slate-500">{DEMO_PASSWORD}</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
