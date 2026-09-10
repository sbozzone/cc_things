import { describe, expect, it } from 'vitest';
import { buildFromMessage, htmlToText, MAX_NOTE_CHARS } from '../email';

const received = new Date('2026-09-08T12:00:00Z');

describe('email capture (R29)', () => {
  it('uses the subject as the title and the plain body as notes', () => {
    const message = buildFromMessage('Order drawer slides', 'From the hardware shop', null, 0, received);
    expect(message.title).toBe('Order drawer slides');
    expect(message.notes).toBe('From the hardware shop');
  });

  it('reduces HTML to text and never keeps markup', () => {
    const html = '<div>Hello <b>there</b><script>alert(1)</script><br>second line</div>';
    const message = buildFromMessage('Hi', null, html, 0, received);
    expect(message.notes).toContain('Hello there');
    expect(message.notes).toContain('second line');
    expect(message.notes).not.toContain('<');
    expect(message.notes).not.toContain('alert(1)');
  });

  it('names an empty subject with the received date', () => {
    expect(buildFromMessage('   ', 'body', null, 0, received).title).toBe('Email captured 2026-09-08');
    expect(buildFromMessage(null, 'body', null, 0, received).title).toBe('Email captured 2026-09-08');
  });

  it('flags truncation on the created task', () => {
    const message = buildFromMessage('Long', 'x'.repeat(MAX_NOTE_CHARS + 500), null, 0, received);
    expect(message.truncated).toBe(true);
    expect(message.notes).toContain('truncated');
    expect(message.notes.length).toBeLessThan(MAX_NOTE_CHARS + 200);
  });

  it('ignores attachments with a visible note', () => {
    const message = buildFromMessage('Receipt', 'see attached', null, 2, received);
    expect(message.ignoredAttachments).toBe(2);
    expect(message.notes).toContain('2 attachments were not captured');
  });

  it('preserves source links in the body', () => {
    const message = buildFromMessage('Link', null, '<p>See <a href="https://example.com">this</a></p>', 0, received);
    expect(message.notes).toContain('See this');
    expect(htmlToText('<a href="https://example.com">https://example.com</a>')).toBe('https://example.com');
  });
});
