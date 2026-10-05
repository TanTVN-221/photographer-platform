const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_KEYS = 10_000;
const MAX_CONCURRENT_VERIFICATIONS = 4;

type Bucket = { count: number; resetAt: number };

/** Single-process pilot guard; deployment must add an edge/shared limiter. */
export class PasswordAttemptLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private inFlight = 0;

  constructor(private readonly now: () => number = Date.now) {}

  acquire(clientAddress: string, slug: string):
    | { readonly allowed: true; readonly release: () => void }
    | { readonly allowed: false; readonly retryAfterSeconds: number } {
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
      if (this.buckets.size >= MAX_KEYS) return { allowed: false, retryAfterSeconds: 60 };
    }
    if (bucket !== undefined && bucket.count >= MAX_ATTEMPTS) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    if (this.inFlight >= MAX_CONCURRENT_VERIFICATIONS) {
      return { allowed: false, retryAfterSeconds: 1 };
    }
    if (bucket === undefined) this.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    else bucket.count += 1;
    this.inFlight += 1;
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (!released) {
          this.inFlight -= 1;
          released = true;
        }
      },
    };
  }
}
