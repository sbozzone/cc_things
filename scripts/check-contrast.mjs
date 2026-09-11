// Checks the palette in src/app/globals.css against WCAG 2.1 AA (N05).
// Run with `npm run check:contrast`; it is part of `npm run verify`.
// WCAG 2.1 contrast for the pairs the UI actually renders.
const hex = (h) => {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};
const lum = (h) => {
  const [r, g, b] = hex(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const light = {
  bg: '#f7f6f3', surface: '#ffffff', surface2: '#f2f1ed', sidebar: '#efece6',
  text: '#191917', muted: '#5d5b54', faint: '#6a6860',
  accent: '#3a52d4', accentSoft: '#e8ebfc', accentContrast: '#ffffff', selected: '#dde3fb',
  today: '#b57500', upcoming: '#cf4f2a', anytime: '#0c877a', someday: '#97790f',
  logbook: '#1d874a', danger: '#b3261e', dangerSoft: '#fdeae7',
  chipWarmBg: '#fbf0da', chipWarmFg: '#7f5307',
  chipDangerBg: '#fdeae7', chipDangerFg: '#9d2a1d',
  chipCoolBg: '#e4f3f1', chipCoolFg: '#09655b',
  chipNeutralBg: '#efece6', chipNeutralFg: '#5d5b54',
  borderStrong: '#cbc7bc', control: '#84827a',
};
const dark = {
  bg: '#121316', surface: '#1a1c20', surface2: '#23262c', sidebar: '#0d0e11',
  text: '#edeff2', muted: '#a4a9b3', faint: '#7a808b',
  accent: '#8098ff', accentSoft: '#202949', accentContrast: '#0b0f1c', selected: '#26324f',
  today: '#f0b64a', upcoming: '#f5906a', anytime: '#4ec9b8', someday: '#d6b455',
  logbook: '#5fc783', danger: '#f58a80', dangerSoft: '#3a211e',
  chipWarmBg: '#382d16', chipWarmFg: '#f0c471',
  chipDangerBg: '#3d211d', chipDangerFg: '#f8a79c',
  chipCoolBg: '#11322f', chipCoolFg: '#6fd8c7',
  chipNeutralBg: '#262930', chipNeutralFg: '#a4a9b3',
  borderStrong: '#434752', control: '#787b83',
};

// [label, fg, bg, minimum]  — 4.5 for normal text, 3.0 for large text / UI components.
const pairs = (t) => [
  ['body text on page', t.text, t.bg, 4.5],
  ['body text on surface', t.text, t.surface, 4.5],
  ['muted text on page', t.muted, t.bg, 4.5],
  ['muted text on surface', t.muted, t.surface, 4.5],
  ['muted text on sidebar', t.muted, t.sidebar, 4.5],
  ['faint text on page', t.faint, t.bg, 4.5],
  ['faint text on sidebar', t.faint, t.sidebar, 4.5],
  ['accent text on page', t.accent, t.bg, 4.5],
  ['accent text on accent-soft', t.accent, t.accentSoft, 4.5],
  ['accent text on selected row', t.accent, t.selected, 4.5],
  ['button label on accent', t.accentContrast, t.accent, 4.5],
  ['warm pill', t.chipWarmFg, t.chipWarmBg, 4.5],
  ['danger pill', t.chipDangerFg, t.chipDangerBg, 4.5],
  ['cool pill', t.chipCoolFg, t.chipCoolBg, 4.5],
  ['neutral pill', t.chipNeutralFg, t.chipNeutralBg, 4.5],
  ['danger text on danger-soft', t.danger, t.dangerSoft, 4.5],
  ['body text on selected row', t.text, t.selected, 4.5],
  // Icons and bars are UI components: 3:1.
  ['Today icon', t.today, t.sidebar, 3],
  ['Upcoming icon', t.upcoming, t.sidebar, 3],
  ['Anytime icon', t.anytime, t.sidebar, 3],
  ['Someday icon', t.someday, t.sidebar, 3],
  ['Logbook icon', t.logbook, t.sidebar, 3],
  ['checkbox border on page', t.control, t.bg, 3],
  ['checkbox border on surface', t.control, t.surface, 3],
  ['checkbox border on selected row', t.control, t.selected, 3],
  ['focus ring on page', t.accent, t.bg, 3],
];

let failures = 0;
for (const [name, theme] of [['LIGHT', light], ['DARK', dark]]) {
  console.log(`\n${name}`);
  for (const [label, fg, bg, min] of pairs(theme)) {
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failures += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2)}:1 (needs ${min})  ${label}`);
  }
}
console.log(`\n${failures === 0 ? 'All pairs meet WCAG AA.' : `${failures} pair(s) below AA.`}`);
if (failures > 0) process.exit(1);
