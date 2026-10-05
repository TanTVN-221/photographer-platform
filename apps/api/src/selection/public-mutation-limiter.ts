const WINDOW_MS = 60 * 1000;
const MAX_MUTATIONS = 60;
const MAX_KEYS = 10_000;

type Bucket = { count: number; resetAt: number };

/** Per-process pilot throttle; production needs a shared/edge policy. */
export class PublicMutationLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  check(clientAddress: string, slug: string): number | null {
    const now = this.now();
    const key = `${clientAddress}\0${slug}`;
    let bucket = this.buckets.get(key);
    if (bucket !== undefined && bucket.resetAt <= now) {
      this.buckets.delete(key);
      bucket = undefined;
    }
    if (bucket === undefined && this.buckets.size >= MAX_KEYS) {
      for (const [storedKey, stored] of this.buckets) {
        if (stored.resetAt <= now) this.buckets.delete(storedKey);
      }
      if (this.buckets.size >= MAX_KEYS) return 60;
    }
    if (bucket !== undefined && bucket.count >= MAX_MUTATIONS) {
      return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    }
    if (bucket === undefined) this.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    else bucket.count += 1;
    return null;
  }
}
