'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DevnetWarningBanner } from '@atlas-rail/ui';
import { ShieldCheck, Landmark, Users, FileText, Send, BookOpen, Key, Webhook, Settings, ExternalLink } from 'lucide-react';

export const Navigation: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();

  const links = [
    { name: 'Dashboard', href: '/', icon: ShieldCheck },
    { name: 'Treasuries', href: '/treasuries', icon: Landmark },
    { name: 'Recipients', href: '/recipients', icon: Users },
    { name: 'Policies', href: '/policies', icon: FileText },
    { name: 'Payouts', href: '/payouts', icon: Send },
    { name: 'Ledger & Export', href: '/ledger', icon: BookOpen },
    { name: 'Webhooks', href: '/webhooks', icon: Webhook },
    { name: 'API Keys', href: '/api-keys', icon: Key },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
      {/* Persistent Devnet Warning Header */}
      <DevnetWarningBanner />

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-64 bg-[#0f172a] border-r border-slate-800 flex flex-col justify-between">
          <div>
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center font-bold text-white text-lg">
                  A
                </div>
                <div>
                  <h1 className="font-bold text-lg leading-none tracking-tight">Atlas Rail</h1>
                  <span className="text-xs text-slate-400 font-mono">Devnet Control v1</span>
                </div>
              </div>
            </div>

            <nav className="p-4 space-y-1">
              {links.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
            <a
              href="http://localhost:3001/docs"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between p-2 rounded bg-slate-900/60 hover:bg-slate-800 text-slate-300 transition-colors"
            >
              <span>Swagger API Docs</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
};
