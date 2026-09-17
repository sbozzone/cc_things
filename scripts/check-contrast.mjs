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
  bg: '#f7f8fb', surface: '#ffffff', surface2: '#eef1f7', sidebar: '#f5f7fa',
  text: '#1a1d29', muted: '#575e6f', faint: '#6a6860',
  accent: '#9b3f00', accentFill: '#fa4616', accentFillContrast: '#241006',
  accentSoft: '#fff0e5', accentContrast: '#241006', selected: '#f4dfd1',
  inbox: '#4a6fb5',
  today: '#fa4616', upcoming: '#bd431d', anytime: '#0c877a', someday: '#97790f',
  logbook: '#1d874a', danger: '#b3261e', dangerSoft: '#fdeae7',
  chipWarmBg: '#fbf0da', chipWarmFg: '#7f5307',
  chipDangerBg: '#fdeae7', chipDangerFg: '#9d2a1d',
  chipCoolBg: '#e4f3f1', chipCoolFg: '#09655b',
  chipNeutralBg: '#eef1f7', chipNeutralFg: '#575e6f',
  borderStrong: '#c6ccdb', control: '#817a70',
};
const dark = {
  bg: '#0f1115', surface: '#171a20', surface2: '#1f232b', sidebar: '#0b0d11',
  text: '#eceef3', muted: '#a2a8b6', faint: '#7a808b',
  accent: '#ff9c62', accentFill: '#fa4616', accentFillContrast: '#241006',
  accentSoft: '#3b2217', accentContrast: '#241006', selected: '#4a2b1c',
  inbox: '#86a9e6',
  today: '#fa4616', upcoming: '#f5906a', anytime: '#4ec9b8', someday: '#d6b455',
  logbook: '#5fc783', danger: '#f58a80', dangerSoft: '#3a211e',
  chipWarmBg: '#382d16', chipWarmFg: '#f0c471',
  chipDangerBg: '#3d211d', chipDangerFg: '#f8a79c',
  chipCoolBg: '#11322f', chipCoolFg: '#6fd8c7',
  chipNeutralBg: '#22262f', chipNeutralFg: '#a2a8b6',
  borderStrong: '#3e434f', control: '#7d8088',
};

const sageLight = {
  ...light,
  bg: '#f7f3e8', surface: '#fffdf7', surface2: '#ece9dc', sidebar: '#f2efe4',
  text: '#20241f', muted: '#525d52', faint: '#666b61',
  accent: '#47664a', accentSoft: '#e4ecdf', selected: '#dce8d8',
  accentFill: '#47664a', accentFillContrast: '#ffffff',
  inbox: '#526b8c', today: '#8c630c', upcoming: '#a7462e', anytime: '#3d7061',
  someday: '#7b6a19', logbook: '#4b7047', chipNeutralBg: '#ece9dc', chipNeutralFg: '#525d52',
  borderStrong: '#b9b3a2', control: '#77796f',
};
const sageDark = {
  ...dark,
  bg: '#131510', surface: '#1b1e18', surface2: '#24281f', sidebar: '#10120e',
  text: '#f0f1e9', muted: '#adb5a5', faint: '#899083',
  accent: '#a7caa6', accentSoft: '#263525', accentContrast: '#142016', selected: '#30422e',
  accentFill: '#a7caa6', accentFillContrast: '#142016',
  inbox: '#96afd0', today: '#e1bd68', upcoming: '#ee987c', anytime: '#80c1ad',
  someday: '#d2bd67', logbook: '#8cc78b', chipNeutralBg: '#24281f', chipNeutralFg: '#adb5a5',
  borderStrong: '#4b5144', control: '#858a7e',
};
const brightLight = {
  ...light,
  accent: '#2159d6', accentSoft: '#e6eefd', selected: '#dbe7fd',
  accentFill: '#2159d6', accentFillContrast: '#ffffff',
  inbox: '#4a6fb5', today: '#b57500', upcoming: '#cf4f2a', anytime: '#0c877a',
  someday: '#97790f', logbook: '#1d874a',
};
const brightDark = {
  ...dark,
  accent: '#7aa2ff', accentSoft: '#1b2540', accentContrast: '#0b0f1c', selected: '#23304d',
  accentFill: '#7aa2ff', accentFillContrast: '#0b0f1c',
  inbox: '#86a9e6', today: '#f0b64a', upcoming: '#f5906a', anytime: '#4ec9b8',
  someday: '#d6b455', logbook: '#5fc783',
};
const whiteLight = {
  ...light,
  bg: '#ffffff', surface: '#ffffff', surface2: '#f3f4f6', sidebar: '#ffffff',
  chipNeutralBg: '#f1f3f5', chipNeutralFg: '#575e6f',
  borderStrong: '#b8bec8', control: '#747b86',
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
  ['button label on signature fill', t.accentFillContrast, t.accentFill, 4.5],
  ['signature fill on page', t.accentFill, t.bg, 3],
  ['signature fill on surface', t.accentFill, t.surface, 3],
  ['warm pill', t.chipWarmFg, t.chipWarmBg, 4.5],
  ['danger pill', t.chipDangerFg, t.chipDangerBg, 4.5],
  ['cool pill', t.chipCoolFg, t.chipCoolBg, 4.5],
  ['neutral pill', t.chipNeutralFg, t.chipNeutralBg, 4.5],
  ['danger text on danger-soft', t.danger, t.dangerSoft, 4.5],
  ['body text on selected row', t.text, t.selected, 4.5],
  // Icons and bars are UI components: 3:1.
  ['Inbox icon', t.inbox, t.sidebar, 3],
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
for (const [name, theme] of [
  ['ORANGE LIGHT', light], ['ORANGE DARK', dark],
  ['SAGE LIGHT', sageLight], ['SAGE DARK', sageDark],
  ['BRIGHT LIGHT', brightLight], ['BRIGHT DARK', brightDark],
  ['WHITE LIGHT', whiteLight], ['WHITE DARK', dark],
]) {
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
