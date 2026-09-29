import { Link, useLocation } from 'react-router-dom';
import { NAV_ITEMS, SETTINGS_ITEM } from '../lib/routes';

// Unknown paths render inside the layout (QA-0928-101) — they used to be a
// completely blank page through the SPA rewrite.
export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-[var(--text-strong)]">Page not found</h2>
      <p className="text-[var(--muted)]">
        There is no dashboard page at <code className="font-mono text-[var(--text)] break-all">{pathname}</code>. The pages are:
      </p>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[...NAV_ITEMS, SETTINGS_ITEM].map((i) => (
          <li key={i.to}>
            <Link to={i.to} className="text-[var(--indigo)] hover:underline">{i.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
