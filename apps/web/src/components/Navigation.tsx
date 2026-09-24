'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { DevnetWarningBanner } from '@atlas-rail/ui';
import { hasPermission, type PermissionAction } from '@atlas-rail/domain';
import {
  LayoutDashboard,
  Landmark,
  Users,
  FileText,
  Send,
  BookOpen,
  Key,
  Webhook,
  Settings,
  ExternalLink,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { useApiHealth } from '../lib/hooks';
import { api } from '../lib/api';

const NAV_LINKS: {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: PermissionAction;
}[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, permission: 'payout:read' },
  { name: 'Treasuries', href: '/treasuries', icon: Landmark, permission: 'treasury:read' },
  { name: 'Recipients', href: '/recipients', icon: Users, permission: 'recipient:read' },
  { name: 'Policies', href: '/policies', icon: FileText, permission: 'policy:read' },
  { name: 'Payouts', href: '/payouts', icon: Send, permission: 'payout:read' },
  { name: 'Ledger & Export', href: '/ledger', icon: BookOpen, permission: 'ledger:read' },
  { name: 'Webhooks', href: '/webhooks', icon: Webhook, permission: 'webhook:manage' },
  { name: 'API Keys', href: '/api-keys', icon: Key, permission: 'apikey:manage' },
  { name: 'Settings', href: '/settings', icon: Settings, permission: 'organization:read' },
];

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  OPERATOR: 'Operator',
  APPROVER: 'Approver',
  AUDITOR: 'Auditor',
  DEVELOPER: 'Developer',
};

function HealthPill() {
  const status = useApiHealth();
  const label =
    status === 'online' ? 'API Online' : status === 'offline' ? 'API Offline' : 'Checking…';
  const dot =
    status === 'online' ? 'bg-solana-green' : status === 'offline' ? 'bg-rose-500' : 'bg-amber-400';
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-medium text-slate-400">
      <span
        className={`h-1.5 w-1.5 rounded-full ${dot} ${status === 'checking' ? 'animate-pulse' : ''}`}
      />
      {label}
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const links = useMemo(
    () => NAV_LINKS.filter((l) => !user || hasPermission(user.role, l.permission)),
    [user],
  );

  const initials = (user?.displayName || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside className="flex w-64 shrink-0 flex-col justify-between border-r border-white/[0.06] bg-[#070818]/80 backdrop-blur-xl">
      <div>
        <div className="flex items-center gap-3 border-b border-white/[0.06] p-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-solana-gradient font-display text-base font-bold text-[#05060f] shadow-glow">
            A
          </div>
          <div>
            <h1 className="font-display text-base font-bold leading-none tracking-tight text-white">
              Atlas Rail
            </h1>
            <span className="text-[11px] font-medium text-slate-500">Devnet Control · v0.1</span>
          </div>
        </div>

        <nav className="space-y-1 p-4">
          {links.map((item) => {
            const Icon = item.icon;
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-solana-gradient text-[#05060f] shadow-glow'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${active ? '' : 'text-slate-500 group-hover:text-slate-300'}`}
                />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-3 border-t border-white/[0.06] p-4">
        <HealthPill />
        <a
          href={`${api.baseUrl}/docs`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-slate-400 transition-colors hover:border-white/[0.14] hover:text-slate-200"
        >
          <span>Swagger API Docs</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>

        {user && (
          <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-slate-200">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-200">{user.displayName}</p>
              <p className="truncate text-[11px] text-slate-500">
                {ROLE_LABEL[user.role] || user.role}
              </p>
            </div>
            <button
              onClick={() => {
                logout();
                router.push('/login');
              }}
              className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-rose-400"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (!loading && !user && pathname !== '/login') {
      router.replace('/login');
    }
  }, [loading, user, pathname, router]);

  if (pathname === '/login') return <>{children}</>;

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-solana-gradient font-display text-lg font-bold text-[#05060f] shadow-glow">
            A
          </div>
          <p className="text-xs font-medium tracking-wide text-slate-500">Loading Atlas Rail…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-slate-100">
      <DevnetWarningBanner />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-7xl animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}

export const Navigation: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <AuthGate>{children}</AuthGate>;
};
