import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_TRACKED = 10_000;

// Slows password guessing: after MAX_ATTEMPTS failures for the same address
// within the window, further attempts are refused until it passes. Held in
// memory, so with several API instances each keeps its own count; a shared
// store (e.g. Redis) is the upgrade if that matters.
@Injectable()
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  assertAllowed(key: string, now = Date.now()): void {
    const recent = this.recent(key, now);
    if (recent.length >= MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
      throw new HttpException({ message: `Too many failed attempts; try again in ${Math.ceil(retryAfter / 60)} minute(s)`, statusCode: 429, error: 'Too Many Requests' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  recordFailure(key: string, now = Date.now()): void {
    if (this.failures.size >= MAX_TRACKED) this.sweep(now);
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string, now: number): number[] {
    return (this.failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  }

  private sweep(now: number): void {
    for (const key of this.failures.keys()) if (this.recent(key, now).length === 0) this.failures.delete(key);
  }
}
