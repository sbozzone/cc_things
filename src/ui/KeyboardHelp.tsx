'use client';

/**
 * Keyboard reference (spec §9, keyboard behaviour). Everything here has an equivalent
 * menu or button, so nothing depends on knowing a shortcut — or on a drag gesture.
 */
const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Anywhere',
    rows: [
      ['⌘/Ctrl + K, or /', 'Search'],
      ['N', 'Add a task to the current list'],
      ['Shift + N', 'Quick capture to Inbox'],
      ['⌘/Ctrl + Z', 'Undo'],
      ['⌘/Ctrl + Shift + Z', 'Redo'],
      ['1 – 6', 'Jump to Inbox, Today, Upcoming, Anytime, Someday, Logbook'],
      ['?', 'Open this reference'],
      ['Escape', 'Close the editor, popover or selection'],
    ],
  },
  {
    title: 'On a task row',
    rows: [
      ['↑ / ↓', 'Move between rows'],
      ['Enter', 'Open or close the editor'],
      ['Space', 'Add to or remove from the selection'],
      ['Shift + click', 'Select a range'],
      ['⌘/Ctrl + click', 'Add one row to the selection'],
      ['⌘/Ctrl + Enter', 'Complete or reopen'],
      ['⌘/Ctrl + Backspace', 'Move to Trash'],
      ['Alt + ↑ / ↓', 'Move the task up or down'],
      ['T / E / A / S', 'Schedule Today, This Evening, Anytime, Someday'],
    ],
  },
  {
    title: 'In the editor',
    rows: [
      ['Enter', 'Close the editor'],
      ['Shift + Enter', 'New line in the title'],
      ['Enter in a checklist row', 'Add the next row'],
      ['Backspace in an empty row', 'Delete that checklist row'],
      ['Paste multiple lines', 'One checklist row per line'],
    ],
  },
];

export function KeyboardHelp() {
  return (
    <div className="py-2">
      {GROUPS.map((group) => (
        <section key={group.title} className="mb-4">
          <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-faint">{group.title}</h3>
          <table className="w-full text-[13.5px]">
            <tbody>
              {group.rows.map(([keys, description]) => (
                <tr key={keys} className="border-b border-line last:border-b-0">
                  <th scope="row" className="w-[45%] py-1.5 pr-3 text-left font-normal text-muted">
                    <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[12.5px]">{keys}</kbd>
                  </th>
                  <td className="py-1.5">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="text-[12.5px] text-muted">
        Typing while focus is outside a text field starts a search. That can be turned off under General.
        Normal text entry, assistive-technology keys and reserved browser shortcuts are never intercepted.
      </p>
    </div>
  );
}
