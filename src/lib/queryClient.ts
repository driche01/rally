import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 min
      // Hold cached entries for 24h so a hydrated cache from AsyncStorage
      // isn't immediately GC'd before any component subscribes.
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

/**
 * Persists React Query's cache into AsyncStorage so a fresh app launch
 * hydrates from disk instead of the network. After hydration, normal
 * staleTime / refetchOnMount logic still runs in the background — so
 * stale entries refresh silently while the user sees the cached data.
 *
 * Skipped on web: AsyncStorage on web shims to localStorage, which is
 * 5MB and shared across tabs; not worth the failure modes when the web
 * surface (respond link, landing) doesn't benefit anyway.
 */
export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'rally-rq-cache-v1',
  // Default serializer is JSON.stringify — fine for our payloads.
  // Throttle writes to once per second so rapid query updates don't
  // hammer AsyncStorage on slow Android devices.
  throttleTime: 1000,
});

/** How long a persisted cache entry is trusted on rehydration. */
export const QUERY_PERSIST_MAX_AGE = 1000 * 60 * 60 * 24; // 24h
