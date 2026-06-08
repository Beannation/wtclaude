import { useState } from 'react';

// One-click copy. Used for the "resume this session" command (A5) and any
// CLI command surfaced in the dashboard.
export default function CopyCommand({ command, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      onClick={copy}
      className={`inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 font-mono text-xs text-[var(--accent)] hover:border-[var(--accent)] transition-colors ${className}`}
      title={`Copy: ${command}`}
    >
      <span className="truncate max-w-[18rem]">{command}</span>
      <span className="text-[var(--muted)] not-italic shrink-0">{copied ? '✓ copied' : label}</span>
    </button>
  );
}
