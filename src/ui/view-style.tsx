import type { ViewKey } from '@/core/selectors';
import {
  ArchiveBoxIcon, BookIcon, CalendarIcon, FlagIcon, FolderIcon, InboxIcon, LayersIcon,
  RepeatIcon, StarIcon, TagIcon, TrashIcon,
} from './icons';

/**
 * Each list's visual identity, in one place so the sidebar icon, the page badge and the
 * accent that tints a page all agree.
 */
export interface ViewStyle {
  icon: React.ReactNode;
  /** A CSS colour value; pages set it as `--view-accent`. */
  accent: string;
}

const BUILT_IN: Record<string, ViewStyle> = {
  inbox: { icon: <InboxIcon size={17} />, accent: 'var(--text-muted)' },
  today: { icon: <StarIcon size={17} />, accent: 'var(--today)' },
  upcoming: { icon: <CalendarIcon size={17} />, accent: 'var(--upcoming)' },
  anytime: { icon: <LayersIcon size={17} />, accent: 'var(--anytime)' },
  someday: { icon: <ArchiveBoxIcon size={17} />, accent: 'var(--someday)' },
  logbook: { icon: <BookIcon size={17} />, accent: 'var(--logbook)' },
  trash: { icon: <TrashIcon size={17} />, accent: 'var(--text-faint)' },
  tomorrow: { icon: <CalendarIcon size={17} />, accent: 'var(--upcoming)' },
  deadlines: { icon: <FlagIcon size={17} />, accent: 'var(--danger)' },
  repeating: { icon: <RepeatIcon size={17} />, accent: 'var(--anytime)' },
  allProjects: { icon: <FolderIcon size={17} />, accent: 'var(--accent)' },
  loggedProjects: { icon: <BookIcon size={17} />, accent: 'var(--logbook)' },
};

export function viewStyle(view: ViewKey): ViewStyle {
  if (view.startsWith('project:')) return { icon: <FolderIcon size={17} />, accent: 'var(--accent)' };
  if (view.startsWith('area:')) return { icon: <LayersIcon size={17} />, accent: 'var(--accent)' };
  if (view.startsWith('tag:')) return { icon: <TagIcon size={17} />, accent: 'var(--accent)' };
  return BUILT_IN[view] ?? { icon: <InboxIcon size={17} />, accent: 'var(--accent)' };
}

/** Sidebar rows use the same hues at a smaller size. */
export function sidebarIcon(view: ViewKey): ViewStyle {
  const style = viewStyle(view);
  return { ...style, icon: <span className="[&>svg]:h-[15px] [&>svg]:w-[15px]">{style.icon}</span> };
}
