import { sessionHeading } from '../lib/derive';

// A session's heading: its branch — a salted hash since 0.3.2, labelled
// "Branch (hashed)" with the upload note as a tooltip (QA-0928-05) — or, with
// no branch, its short session id labelled "Session".
export default function SessionHeading({ session, idChars = 12, className = '' }) {
  const h = sessionHeading(session, idChars);
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 min-w-0 max-w-full ${className}`} title={h.title || undefined}>
      <span className="font-sans text-[10px] font-normal uppercase tracking-wide text-[var(--muted)] shrink-0">{h.kind}</span>
      <span className="font-mono truncate">{h.text}</span>
    </span>
  );
}
