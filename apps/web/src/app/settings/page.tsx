'use client';

import React from 'react';
import { Building } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organization Settings</h1>
        <p className="text-sm text-slate-400">Manage tenant organization profile and security posture.</p>
      </div>

      <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold border-b border-slate-800 pb-3 flex items-center">
          <Building className="w-5 h-5 text-blue-400 mr-2" />
          Tenant Organization Profile
        </h2>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block text-xs uppercase font-semibold text-slate-400">Organization Name</label>
            <div className="font-semibold text-slate-200 mt-1">Atlas Demo Imports</div>
          </div>
          <div>
            <label className="block text-xs uppercase font-semibold text-slate-400">Organization Slug</label>
            <div className="font-mono text-xs text-slate-400 mt-1">atlas-demo</div>
          </div>
        </div>
      </div>
    </div>
  );
}
