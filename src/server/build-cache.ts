/**
 * In-memory LRU cache for completed build archives.
 *
 * Keyed by build ID. Acts as a hot-read layer on top of SQLite BLOBs —
 * recent archive downloads are served from memory while older entries
 * fall back to a SQLite read.
 *
 * On cache hit, the entry is moved to the end (most recently used).
 * Oldest entries are evicted when the cache exceeds maxEntries.
 */

import type { CacheEntry } from "./types.ts";

export interface BuildCache {
  readonly get: (id: string) => CacheEntry | undefined;
  readonly set: (id: string, entry: CacheEntry) => void;
  readonly has: (id: string) => boolean;
  readonly size: () => number;
  readonly clear: () => void;
}

export function createBuildCache(maxEntries: number): BuildCache {
  const cache = new Map<string, CacheEntry>();

  return {
    get(id: string): CacheEntry | undefined {
      const entry = cache.get(id);
      if (!entry) return undefined;

      // Move to end (most recently used)
      cache.delete(id);
      cache.set(id, entry);
      return entry;
    },

    set(id: string, entry: CacheEntry): void {
      if (cache.has(id)) {
        cache.delete(id);
      }
      cache.set(id, entry);

      // Evict oldest if over capacity
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          cache.delete(oldest);
        }
      }
    },

    has(id: string): boolean {
      return cache.has(id);
    },

    size(): number {
      return cache.size;
    },

    clear(): void {
      cache.clear();
    },
  };
}
