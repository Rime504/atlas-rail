import { describe, it, expect } from 'vitest';
import { webhookEventMatchesPattern } from './queues';

describe('webhookEventMatchesPattern', () => {
  it('matches an exact event type', () => {
    expect(webhookEventMatchesPattern('payout.confirmed', 'payout.confirmed')).toBe(true);
  });

  it('does not match a different exact event type', () => {
    expect(webhookEventMatchesPattern('payout.confirmed', 'payout.failed')).toBe(false);
  });

  it('matches a trailing wildcard pattern', () => {
    expect(webhookEventMatchesPattern('payout.confirmed', 'payout.*')).toBe(true);
    expect(webhookEventMatchesPattern('payout.failed', 'payout.*')).toBe(true);
  });

  it('does not let a wildcard bleed into a different resource', () => {
    expect(webhookEventMatchesPattern('recipient.created', 'payout.*')).toBe(false);
  });

  it('matches the global wildcard', () => {
    expect(webhookEventMatchesPattern('anything.at.all', '*')).toBe(true);
  });
});
