// The dashboard's pages, in nav order. Shared by the header nav and the 404
// page (QA-0928-101). Settings sits with the header controls, not in the nav
// row (QA-0928-100).
export const NAV_ITEMS = [
  { to: '/', label: 'Overview', end: true, data: true },
  { to: '/timeline', label: 'Timeline', data: true },
  { to: '/sessions', label: 'Sessions', data: true },
  { to: '/devices', label: 'Devices', data: true },
  { to: '/compare', label: 'Compare' },
  { to: '/compare-models', label: 'Compare Models', data: true },
  { to: '/context-waste', label: 'Context Waste', data: true },
  { to: '/whatif', label: 'What If', data: true },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/badges', label: 'Badges' },
];

export const SETTINGS_ITEM = { to: '/settings', label: 'Settings' };

// React Router serves '/sessions/' and '/Settings' as the same pages (its
// matching ignores a trailing slash and case), so these helpers compare the
// same way (RC 0.3.2): a raw === lost the tab title and the window selector.
export function normalizePath(pathname) {
  return (String(pathname || '').replace(/\/+$/, '') || '/').toLowerCase();
}

// The page name for a path ('' when it is not a dashboard page).
export function pageLabel(pathname) {
  const p = normalizePath(pathname);
  const all = [...NAV_ITEMS, SETTINGS_ITEM];
  const hit = all.find((i) => i.to === p);
  return hit ? hit.label : '';
}

// Pages that read the windowed get-dashboard payload (they show the window
// selector).
export function isDataRoute(pathname) {
  const p = normalizePath(pathname);
  return NAV_ITEMS.some((i) => i.data && i.to === p);
}
