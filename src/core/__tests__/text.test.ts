import { describe, expect, it } from 'vitest';
import { capitalizeNewTitle } from '../text';

describe('new title capitalization', () => {
  it('capitalizes an ordinary lowercase title', () => {
    expect(capitalizeNewTitle('  call the dentist  ')).toBe('Call the dentist');
  });

  it('preserves intentional casing, acronyms, digits, and punctuation', () => {
    expect(capitalizeNewTitle('iPhone backup')).toBe('iPhone backup');
    expect(capitalizeNewTitle('API review')).toBe('API review');
    expect(capitalizeNewTitle('2nd floor repairs')).toBe('2nd floor repairs');
    expect(capitalizeNewTitle('“call later”')).toBe('“call later”');
  });
});
