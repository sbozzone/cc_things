import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * Inline icons. Every icon is decorative: the control around it always carries the
 * accessible name, so nothing here is announced twice.
 */
function Icon({ children, size = 16, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const InboxIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 13h4l1.5 3h7L17 13h4" /><path d="M4.6 6.6 3 13v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5l-1.6-6.4A2 2 0 0 0 17.5 5h-11a2 2 0 0 0-1.9 1.6z" /></Icon>
);
export const StarIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" /></Icon>
);
export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Icon>
);
export const LayersIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="M3 13l9 5 9-5" /></Icon>
);
export const ArchiveBoxIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></Icon>
);
export const BookIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" /><path d="M8 3v18" /></Icon>
);
export const TrashIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13M10 11v6M14 11v6" /></Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 12h2M10 12h10M4 17h8M16 17h4" />
    <circle cx="16" cy="7" r="2.1" /><circle cx="8" cy="12" r="2.1" /><circle cx="14" cy="17" r="2.1" />
  </Icon>
);
export const FolderIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon>
);
export const TagIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9z" /><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none" /></Icon>
);
export const FlagIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 21V4M5 5h11l-2 3.5L16 12H5" /></Icon>
);
export const RepeatIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 10a6 6 0 0 1 6-6h7M17 4l-2.5-2.5M17 4l-2.5 2.5" /><path d="M20 14a6 6 0 0 1-6 6H7M7 20l2.5 2.5M7 20l2.5-2.5" /></Icon>
);
export const NoteIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 4h14v16H5z" /><path d="M8 9h8M8 13h8M8 17h5" /></Icon>
);
export const ChecklistIcon = (p: IconProps) => (
  <Icon {...p}><path d="m3 7 2 2 3-3M3 15l2 2 3-3M12 8h9M12 16h9" /></Icon>
);
export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>
);
export const MoveIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 7h9M4 12h6M4 17h9" /><path d="m16 9 3 3-3 3M19 12h-6" /></Icon>
);
export const ClockIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>
);
export const CloudIcon = (p: IconProps) => (
  <Icon {...p}><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 10.5 3.75 3.75 0 0 0 7 18z" /></Icon>
);
export const UndoIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 9h11a5 5 0 0 1 0 10H9" /><path d="m4 9 4-4M4 9l4 4" /></Icon>
);
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 4 2.7 20h18.6z" /><path d="M12 10v4M12 17h.01" /></Icon>
);
export const EveningIcon = (p: IconProps) => (
  <Icon {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Icon>
);
