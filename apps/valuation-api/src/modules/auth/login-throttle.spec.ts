import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './login-throttle.js';

describe('LoginThrottle', () => {
  it('allows ten failures, blocks the eleventh attempt, and forgets after the window', () => {
    const throttle = new LoginThrottle();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i += 1) {
      throttle.assertAllowed('a@x.test', t0 + i);
      throttle.recordFailure('a@x.test', t0 + i);
    }
    expect(() => throttle.assertAllowed('a@x.test', t0 + 11)).toThrow(/Too many/);
    expect(() => throttle.assertAllowed('b@x.test', t0 + 11)).not.toThrow();
    expect(() => throttle.assertAllowed('a@x.test', t0 + 16 * 60 * 1000)).not.toThrow();
  });

  it('a successful login clears the count', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 9; i += 1) throttle.recordFailure('a@x.test', i);
    throttle.reset('a@x.test');
    for (let i = 0; i < 9; i += 1) throttle.recordFailure('a@x.test', 100 + i);
    expect(() => throttle.assertAllowed('a@x.test', 200)).not.toThrow();
  });
});
