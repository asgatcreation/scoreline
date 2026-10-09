/**
 * Tiny in-memory cache so popular pages don't hit the database on every
 * request. Cleared whenever real match data changes.
 */
export class TtlCache {
  private readonly entries = new Map<string, { value: unknown; expires: number }>();

  constructor(private readonly maxEntries = 500) {}

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const value = await load();
    if (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
