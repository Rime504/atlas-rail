'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const STYLES: Record<ToastKind, { border: string; icon: React.ReactNode; iconWrap: string }> = {
  success: {
    border: 'border-emerald-500/30',
    iconWrap: 'text-emerald-400 bg-emerald-500/10',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  error: {
    border: 'border-rose-500/30',
    iconWrap: 'text-rose-400 bg-rose-500/10',
    icon: <XCircle className="h-4 w-4" />,
  },
  info: {
    border: 'border-solana-purple/30',
    iconWrap: 'text-solana-purple bg-solana-purple/10',
    icon: <Info className="h-4 w-4" />,
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, kind, title, description }]);
      window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value: ToastContextValue = {
    push,
    success: (title, description) => push('success', title, description),
    error: (title, description) => push('error', title, description),
    info: (title, description) => push('info', title, description),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-full max-w-sm flex-col gap-2.5">
        {toasts.map((t) => {
          const s = STYLES[t.kind];
          return (
            <div
              key={t.id}
              className={`glass-card pointer-events-auto animate-fade-in flex items-start gap-3 border ${s.border} bg-[#0b0d1c]/95 p-4 shadow-2xl`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.iconWrap}`}
              >
                {s.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-100">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs text-slate-400">{t.description}</p>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="text-slate-500 transition-colors hover:text-slate-300"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
