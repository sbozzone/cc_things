import { describe, expect, it } from 'vitest';
import { outgoingSyncChange, validateOps } from '../sync';

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

  it('accepts private calendar connection configuration but rejects cache and parser fields', () => {
    const config = {
      id: 'cal_1', ownerId: 'owner', providerId: 'ics', calendarId: 'cal_1', title: 'Work',
      url: 'https://example.com/work.ics', enabled: true,
    };
    expect('ops' in validateOps([op({ table: 'calendarSubscriptions', entityId: 'cal_1', patch: config })])).toBe(true);
    expect('ops' in validateOps([op({ table: 'calendarSubscriptions', patch: { __removed: true } })])).toBe(true);
    for (const field of ['lastRefreshedAt', 'lastError', 'parserVersion', 'configSynced']) {
      expect('error' in validateOps([op({ table: 'calendarSubscriptions', patch: { ...config, [field]: 'local' } })])).toBe(true);
    }
    expect('error' in validateOps([op({ table: 'calendarSubscriptions', patch: { enabled: 'yes' } })])).toBe(true);
  });

  it('sends only calendar config identity with removals and keeps generic task tombstones unchanged', () => {
    const config = { id: 'cal', ownerId: 'owner', providerId: 'ics', calendarId: 'cal', title: 'Work', url: 'https://example.com/work.ics', enabled: true };
    expect(outgoingSyncChange('calendarSubscriptions', 'cal', { ...config, lastRefreshedAt: 'local', configSynced: true }, true))
      .toEqual({ table: 'calendarSubscriptions', id: 'cal', patch: config, remove: true });
    expect(outgoingSyncChange('tasks', 'task', { title: 'Task' }, true))
      .toEqual({ table: 'tasks', id: 'task', patch: {}, remove: true });
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
