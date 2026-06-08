import { IS_MOCK } from '../lib/config';

// Legal line lifted VERBATIM from the GTM-owned marketing site
// (site/src/components/Footer.astro). Build lane does not author copy.
const LEGAL = 'WTClaude is an independent, open-source project. Not affiliated with, endorsed by, or sponsored by Anthropic, PBC. Claude is a trademark of Anthropic, PBC.';

export default function Footer() {
  return (
    <footer className="border-t border-[var(--border)] mt-12">
      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-xs text-[var(--faint)] leading-relaxed max-w-2xl">{LEGAL}</p>
        <div className="flex items-center gap-3 text-xs text-[var(--faint)]">
          {IS_MOCK && (
            <span className="rounded-md border border-[var(--border)] px-2 py-1" title="Showing local demo fixtures — not your real usage. Live data turns on once cloud sync (SEC Phase C) is deployed.">
              Demo data
            </span>
          )}
          <span className="font-mono">MIT License</span>
        </div>
      </div>
    </footer>
  );
}
