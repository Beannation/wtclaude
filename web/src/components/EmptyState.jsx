// Honest empty state — explains WHY there's no data and how to get some, rather
// than rendering a blank panel or fabricating numbers.
export default function EmptyState({ title, body, command, note }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center">
      {title && <h3 className="text-[var(--text-strong)] font-semibold mb-2">{title}</h3>}
      {body && <p className="text-[var(--muted)] text-sm max-w-md mx-auto mb-3">{body}</p>}
      {command && (
        <code className="inline-block bg-[var(--bg)] text-[var(--accent)] px-4 py-2 rounded-lg text-sm">{command}</code>
      )}
      {note && <p className="text-[var(--faint)] text-xs mt-3 max-w-md mx-auto">{note}</p>}
    </div>
  );
}
