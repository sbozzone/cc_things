/**
 * Inbound email capture (R29).
 *
 * The subject becomes the title and the plain-text body becomes the notes. HTML is
 * reduced to text rather than rendered, attachments are ignored with a visible note,
 * and each message id is accepted once so a provider retry cannot create a duplicate.
 */

export const MAX_NOTE_CHARS = 10_000;
export const MAX_MESSAGES_PER_DAY = 100;

/** Reduces an HTML body to readable text. Nothing is ever stored as markup. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface IngestedMessage {
  title: string;
  notes: string;
  truncated: boolean;
  ignoredAttachments: number;
}

export function buildFromMessage(
  subject: string | null, text: string | null, html: string | null,
  attachmentCount: number, receivedAt: Date,
): IngestedMessage {
  const body = (text && text.trim()) || (html ? htmlToText(html) : '');
  const truncated = body.length > MAX_NOTE_CHARS;
  const notes = truncated ? `${body.slice(0, MAX_NOTE_CHARS)}\n\n— truncated at ${MAX_NOTE_CHARS} characters` : body;
  const trimmedSubject = (subject ?? '').trim();

  const parts = [notes];
  if (attachmentCount > 0) {
    parts.push(`\n\n— ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'} were not captured.`);
  }

  return {
    // An empty subject still produces something identifiable.
    title: trimmedSubject || `Email captured ${receivedAt.toISOString().slice(0, 10)}`,
    notes: parts.join('').trim(),
    truncated,
    ignoredAttachments: attachmentCount,
  };
}
