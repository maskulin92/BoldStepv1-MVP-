'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError, apiGet, apiList } from '@/lib/api-client';
import type { Pagination } from '@/types';

/**
 * Generic data-fetch hook for the REST layer.
 *
 * Named `useFirestore` to match the structure in the brief — the data does come
 * from Firestore, just via the API rather than the client SDK, so that every
 * read passes the same auth and scoping rules an integration would.
 */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  refetch: () => Promise<void>;
  setData: (value: T | null) => void;
}

export function useFirestore<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // Guards against a slow earlier request overwriting a newer one.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const result = await apiGet<T>(path);
      if (id === requestId.current) setData(result);
    } catch (err) {
      if (id !== requestId.current) return;
      const apiError = err instanceof ApiClientError ? err : null;
      setError(apiError?.message ?? 'Something went wrong loading this data.');
      setErrorCode(apiError?.code ?? 'INTERNAL_ERROR');
      setData(null);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { data, loading, error, errorCode, refetch: load, setData };
}

export interface ListState<T> {
  items: T[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useFirestoreList<T>(path: string | null, deps: unknown[] = []): ListState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!path) {
      setItems([]);
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const result = await apiList<T>(path);
      if (id === requestId.current) {
        setItems(result.items);
        setPagination(result.pagination);
      }
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof ApiClientError ? err.message : 'Failed to load.');
      setItems([]);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { items, pagination, loading, error, refetch: load };
}
