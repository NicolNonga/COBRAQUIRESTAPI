import { RetryPolicy } from './retry-policy';

describe('RetryPolicy', () => {
  it('cresce exponencialmente e respeita o tecto', () => {
    const p = new RetryPolicy(1_000, 10_000);
    const now = 0;
    for (let i = 0; i < 200; i++) {
      expect(p.nextAttemptAt(1, now).getTime()).toBeLessThanOrEqual(1_000);
      expect(p.nextAttemptAt(3, now).getTime()).toBeLessThanOrEqual(4_000);
      expect(p.nextAttemptAt(20, now).getTime()).toBeLessThanOrEqual(10_000);
      expect(p.nextAttemptAt(20, now).getTime()).toBeGreaterThanOrEqual(1_000);
    }
  });
});
