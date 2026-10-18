# ToDone iPhone interface review — v0.8.0

Reviewed and implemented October 17–18, 2026. Primary target: iPhone 15 Safari,
393 × 852 CSS pixels. Design review was completed and communicated before edits.

## Direction

A quiet, tactile task notebook: generous task text, restrained chrome, one clear
completion control, thumb-reachable navigation, and predictable sheets. Existing
palette choices remain intact, including warm Cream & Sage and its charcoal dark
variant. No backend, data schema, task rules, sync rules, or dependencies changed.
ToDone already has a standalone PWA manifest, icons, and offline service worker.

## Five highest-impact opportunities

1. **Navigation and hierarchy.** The previous phone header crowded a list button,
   decorative badge, heading, search, undo, and add into one line. Give the heading
   its own line and move My Day, Inbox, Upcoming, Lists, and Inbox capture into a
   labeled bottom bar. Keep contextual Add a task available inside each writable
   list, including empty lists.
2. **Readable lists.** Completion, My Day glyph, reorder handle, and selection circle
   competed with task text. Use one completion control in browse mode, explicit
   Select and Arrange modes, 17px titles, quieter metadata, and inset separators.
   Preserve automatic Errands grouping/order and every existing sort option.
3. **Task sheets and checklists.** A top-aligned desktop dialog and title autofocus
   made inspection open the keyboard. Use a bounded bottom sheet, sticky Done bar,
   grouped properties, and intentional text focus. Checklist glyphs stay 22px inside
   44px targets; long checklist text wraps, with distinct reorder/delete controls.
4. **Coherent phone typography and surfaces.** Use the platform system font, 34px
   page headings, 30px project/area titles, readable secondary text, and at least
   16px editable fields. Keep the established theme tokens and desktop layout.
5. **Platform finish.** Account for all safe-area edges, visual-viewport changes,
   bottom navigation and toast positioning, reduced motion, browser theme colors,
   nested focus restoration, and print isolation for portaled overlays. Keep zoom.

## Incremental implementation and refinements

- Mobile shell and Lists navigation; palette-aware browser chrome.
- Browse/Select/Arrange list modes and consolidated View options.
- Keyboard-aware task/picker sheets and checklist ergonomics.
- Independent review plus browser QA corrected touch-action precedence, Tailwind
  translate behavior on checklist handles, backward focus trapping, project title
  font sizing, empty-list contextual creation, and portal-overlay print visibility.
- Mobile CSS is imported after global CSS in the root layout; no new UI library.
- Development indicator disabled so it cannot intercept the My Day tab during QA.

## Browser verification

Tested with isolated local-only sample tasks, not the user's production task data.

| Check | Result |
| --- | --- |
| 393 × 852 light and dark list layout | Reviewed screenshots; no page horizontal overflow |
| 375 × 667 checklist-heavy task | Long text wraps; sheet scrolls; Done stays reachable |
| 393 × 500 reduced-height date sheet | Bounded to visible space; no internal horizontal overflow |
| 852 × 393 landscape | Existing split layout; no page horizontal overflow |
| 1280 × 900 desktop | Existing sidebar, header, inline actions retained |
| Bottom navigation and Lists | Correct destinations and sheet dismissal |
| Quick capture and contextual add | Inbox capture and My Day creation verified separately |
| Task inspection | Done receives focus; title does not autofocus |
| Title edit then nested Due sheet | Title persisted; date sheet opens without text focus |
| Nested keyboard focus | Shift+Tab remains inside parent task dialog |
| Checklist | Creation, completion, long-text edit, compact artwork, aligned handles |
| Select / Arrange | Multi-selection toolbar, keyboard reorder, pointer drag reorder verified |
| Saved tag view | Untagged combination saved and reopened from More lists, unpinned |
| Theme chrome | Both theme-color metadata entries match the active palette background |
| Reload | Local sample tasks, checklist state, order, and appearance retained |

Screenshots: `todone-iphone-light.jpg`, `todone-iphone-dark.jpg`,
`todone-iphone-checklist.jpg`, and `todone-desktop.jpg` in this chat's local
visualizations directory.

### Limits

Release verification: 229 tests passed across 26 files; TypeScript and the optimized
Next.js production build passed. All audited token pairs pass the existing WCAG AA
contrast checks across four palettes in both themes.

Browser checks use a Chromium-based responsive preview on Windows, not Mobile
Safari or a physical iPhone. Real keyboard animation, Dynamic Island/home-indicator
insets, installed PWA launch, and VoiceOver should receive a device smoke test.
The 393 × 500 check validates reduced-space geometry, not a real iOS keyboard.
One development-only hook-dependency warning appeared during live code replacement;
the fresh-page checks produced no new warning. Print DOM/rules and regression tests
were checked; physical printing and Safari Share → Print were not exercised.
