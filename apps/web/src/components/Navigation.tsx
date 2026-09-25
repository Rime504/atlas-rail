'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
  Menu,
  X,
  Bot,
  Activity,
  UserCheck,
  ReceiptText,
} from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { useApiHealth } from '../lib/hooks';
import { PendingApprovalsProvider, usePendingApprovals } from '../lib/agent-hooks';
import { api } from '../lib/api';

interface NavLink {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: PermissionAction;
  badge?: 'approvals';
}

const HOME_LINKS: NavLink[] = [{ name: 'Home', href: '/', icon: LayoutDashboard, permission: 'mandate:read' }];

const TREASURY_LINKS: NavLink[] = [
  { name: 'Dashboard', href: '/treasury', icon: Landmark, permission: 'payout:read' },
  { name: 'Treasuries', href: '/treasuries', icon: Landmark, permission: 'treasury:read' },
  { name: 'Recipients', href: '/recipients', icon: Users, permission: 'recipient:read' },
  { name: 'Policies', href: '/policies', icon: FileText, permission: 'policy:read' },
  { name: 'Payouts', href: '/payouts', icon: Send, permission: 'payout:read' },
  { name: 'Ledger & Export', href: '/ledger', icon: BookOpen, permission: 'ledger:read' },
];

const AGENT_LINKS: NavLink[] = [
  { name: 'Mandates', href: '/mandates', icon: Bot, permission: 'mandate:read' },
  { name: 'Live Decisions', href: '/decisions', icon: Activity, permission: 'mandate:read' },
  {
    name: 'Approvals',
    href: '/approvals',
    icon: UserCheck,
    permission: 'approval:read',
    badge: 'approvals',
  },
  { name: 'Receipts', href: '/receipts', icon: ReceiptText, permission: 'receipt:read' },
];

const ADMIN_LINKS: NavLink[] = [
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

function NavGroup({
  label,
  links,
  pathname,
  onNavigate,
}: {
  label?: string;
  links: NavLink[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const { pending } = usePendingApprovals();
  if (links.length === 0) return null;
  return (
    <div className="space-y-1">
      {label && (
        <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {label}
        </p>
      )}
      {links.map((item) => {
        const Icon = item.icon;
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const count = item.badge === 'approvals' ? pending : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
              active
                ? 'bg-solana-gradient text-[#05060f] shadow-glow'
                : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
            }`}
          >
            <Icon
              className={`h-4 w-4 ${active ? '' : 'text-slate-500 group-hover:text-slate-300'}`}
            />
            <span className="flex-1">{item.name}</span>
            {count > 0 && (
              <span
                className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                  active ? 'bg-[#05060f] text-solana-green' : 'bg-amber-400 text-[#05060f]'
                }`}
                aria-label={`${count} pending approvals`}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const visible = (links: NavLink[]) =>
    links.filter((l) => !user || hasPermission(user.role, l.permission));
  const home = useMemo(() => visible(HOME_LINKS), [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const treasury = useMemo(() => visible(TREASURY_LINKS), [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const agent = useMemo(() => visible(AGENT_LINKS), [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const admin = useMemo(() => visible(ADMIN_LINKS), [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const initials = (user?.displayName || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="hidden items-center gap-3 border-b border-white/[0.06] p-6 lg:flex">
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

        <nav className="space-y-1 p-4" aria-label="Primary">
          <NavGroup links={home} pathname={pathname} onNavigate={onNavigate} />
          <NavGroup label="Agent Mandates" links={agent} pathname={pathname} onNavigate={onNavigate} />
          <NavGroup label="Treasury" links={treasury} pathname={pathname} onNavigate={onNavigate} />
          <NavGroup label="Administration" links={admin} pathname={pathname} onNavigate={onNavigate} />
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
    </>
  );
}

function MobileBar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { pending } = usePendingApprovals();
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/[0.06] bg-[#070818]/90 px-4 py-3 backdrop-blur-xl lg:hidden">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-solana-gradient font-display text-sm font-bold text-[#05060f] shadow-glow">
          A
        </span>
        <span className="font-display text-base font-bold tracking-tight text-white">Atlas Rail</span>
      </Link>
      <div className="flex items-center gap-2">
        {pending > 0 && (
          <Link
            href="/approvals"
            className="flex items-center gap-1.5 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-[#05060f]"
          >
            <UserCheck className="h-3.5 w-3.5" />
            {pending}
          </Link>
        )}
        <button
          onClick={onToggle}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:bg-white/[0.06]"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
    </header>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user && pathname !== '/login') {
      router.replace('/login');
    }
  }, [loading, user, pathname, router]);

  // Close the drawer on navigation and lock body scroll while it is open.
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

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

  const canSeeApprovals = hasPermission(user.role, 'approval:read');

  return (
    <PendingApprovalsProvider enabled={canSeeApprovals}>
      <div className="flex min-h-screen flex-col bg-background text-slate-100">
        <DevnetWarningBanner />
        <MobileBar open={drawerOpen} onToggle={() => setDrawerOpen((o) => !o)} />

        {/* Mobile drawer */}
        <div
          className={`fixed inset-0 z-30 lg:hidden ${drawerOpen ? '' : 'pointer-events-none'}`}
          aria-hidden={!drawerOpen}
        >
          <div
            className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
              drawerOpen ? 'opacity-100' : 'opacity-0'
            }`}
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className={`absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col border-r border-white/[0.06] bg-[#070818] pt-16 transition-transform duration-200 ${
              drawerOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <SidebarBody onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>

        <div className="flex flex-1">
          <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-white/[0.06] bg-[#070818]/80 backdrop-blur-xl lg:flex">
            <SidebarBody />
          </aside>
          <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl animate-fade-in">{children}</div>
          </main>
        </div>
      </div>
    </PendingApprovalsProvider>
  );
}

export const Navigation: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <AuthGate>{children}</AuthGate>;
};
