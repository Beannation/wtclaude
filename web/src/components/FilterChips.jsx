// Multi-criteria filter chips (A5). Each group toggles a single active value;
// clicking the active chip clears it. `facets` is the distinct-values map from
// derive.facets(); `value` is the active filter object; `onChange` sets it.

const GROUPS = [
  { key: 'branch', label: 'Branch' },
  { key: 'cost_center', label: 'Cost center' },
  { key: 'model', label: 'Model' },
  { key: 'device_id', label: 'Device' },
];

export default function FilterChips({ facets, value, onChange }) {
  function toggle(groupKey, v) {
    onChange({ ...value, [groupKey]: value[groupKey] === v ? undefined : v });
  }
  const anyActive = Object.values(value).some(Boolean);

  return (
    <div className="space-y-2 mb-4">
      {GROUPS.map((g) => {
        const opts = facets[g.key] || [];
        if (opts.length <= 1) return null;
        return (
          <div key={g.key} className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[var(--faint)] uppercase tracking-wide w-24 shrink-0">{g.label}</span>
            {opts.map((v) => {
              const active = value[g.key] === v;
              const display = g.key === 'device_id' ? (facets.deviceLabels?.[v] || v) : v;
              return (
                <button
                  key={v}
                  onClick={() => toggle(g.key, v)}
                  aria-pressed={active}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    active
                      ? 'bg-[var(--accent-dim)] border-[var(--accent)] text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--faint)]'
                  }`}
                >
                  {display}
                </button>
              );
            })}
          </div>
        );
      })}
      {anyActive && (
        <button onClick={() => onChange({})} className="text-xs text-[var(--muted)] underline hover:text-[var(--text)]">
          Clear filters
        </button>
      )}
    </div>
  );
}
