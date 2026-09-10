import { describe, expect, it } from 'vitest';
import { validateOps } from '../sync';

const op = (overrides: Record<string, unknown> = {}) => ({
  opId: 'op_1', deviceId: 'dev_1', table: 'tasks', entityId: 'task_1',
  baseRevision: 0, patch: { title: 'Hello' }, createdAt: '2026-09-08T12:00:00.000Z',
  ...overrides,
});

describe('sync operation validation (R34, N08)', () => {
  it('accepts a well-formed operation', () => {
    const result = validateOps([op()]);
    expect('ops' in result && result.ops).toHaveLength(1);
  });

  it('rejects a table the client is not allowed to write', () => {
    // Calendar caches and account rows are never writable through sync.
    for (const table of ['accounts', 'calendarEvents', 'sessions', 'entities', '../../etc']) {
      const result = validateOps([op({ table })]);
      expect('error' in result).toBe(true);
    }
  });

  it('rejects malformed operations rather than partially applying them', () => {
    expect('error' in validateOps('not a list')).toBe(true);
    expect('error' in validateOps([null])).toBe(true);
    expect('error' in validateOps([op({ opId: '' })])).toBe(true);
    expect('error' in validateOps([op({ entityId: 'x'.repeat(200) })])).toBe(true);
    expect('error' in validateOps([op({ patch: 'nope' })])).toBe(true);
    expect('error' in validateOps([op({ patch: ['a'] })])).toBe(true);
    expect('error' in validateOps([op({ createdAt: 'yesterday' })])).toBe(true);
  });

  it('caps the number of operations in one request', () => {
    const many = Array.from({ length: 501 }, (_, i) => op({ opId: `op_${i}` }));
    expect('error' in validateOps(many)).toBe(true);
  });

  it('defaults a missing base revision rather than failing the batch', () => {
    const result = validateOps([op({ baseRevision: undefined })]);
    expect('ops' in result && result.ops[0]?.baseRevision).toBe(0);
  });
});
