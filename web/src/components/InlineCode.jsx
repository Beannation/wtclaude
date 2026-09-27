// Render a plain string, turning `backtick` spans into inline <code>. The caveat
// strings are shared verbatim with the CLI (web-parity.test.js pins that), so the
// markup is applied here, at render time, rather than in the strings.
export default function InlineCode({ text }) {
  return String(text)
    .split(/`([^`]+)`/)
    .map((seg, i) =>
      i % 2 ? (
        <code key={i} className="font-mono text-[var(--text)]">
          {seg}
        </code>
      ) : (
        seg
      ),
    );
}
