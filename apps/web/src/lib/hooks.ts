'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { useAuth } from './auth-context';

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches a GET endpoint once the authenticated user is available, and re-fetches whenever
 * `path` changes. Pass `null` for `path` to skip fetching (e.g. while a dependency isn't ready).
 */
export function useApi<T>(path: string | null): UseApiResult<T> {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((res) => {
        if (!cancelled && mounted.current) setData(res);
      })
      .catch((err) => {
        if (!cancelled && mounted.current) {
          setError(
            err instanceof ApiError ? err.message : 'Something went wrong loading this data.',
          );
        }
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, user, authLoading, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, refetch };
}

/** Polls the unauthenticated /health/live endpoint so the UI can show a real "API Online /
 * Offline" indicator instead of just assuming the backend is reachable. */
export function useApiHealth(intervalMs = 15000): 'checking' | 'online' | 'offline' {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${api.baseUrl}/health/live`, { cache: 'no-store' });
        if (!cancelled) setStatus(res.ok ? 'online' : 'offline');
      } catch {
        if (!cancelled) setStatus('offline');
      }
    };
    check();
    const id = window.setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return status;
}
