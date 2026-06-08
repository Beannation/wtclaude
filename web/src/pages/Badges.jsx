import { useDashboard } from '../lib/useDashboard';
import EmptyState from '../components/EmptyState';
import { LinkPrompt } from './Overview';

const ALL_BADGES = [
  { type: 'first_session', label: 'First Steps', description: 'Tracked your first session' },
  { type: '100k_club', label: '100K Club', description: 'Tracked 100,000 tokens' },
  { type: 'million_club', label: 'Million Club', description: 'Tracked 1,000,000 tokens' },
  { type: '10m_club', label: '10M Club', description: 'Tracked 10,000,000 tokens' },
  { type: 'week_streak', label: 'Week Warrior', description: '7 consecutive days tracked' },
  { type: 'month_streak', label: 'Month Master', description: '30 consecutive days tracked' },
  { type: 'efficient_day', label: 'Cache Champion', description: '50%+ cache hit rate in a day' },
  { type: 'model_mixer', label: 'Model Mixer', description: 'Used 2+ models in one session' },
];

export default function Badges() {
  const { data, loading, error, linked } = useDashboard();
  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <EmptyState title="Couldn't load badges" body={error} />;

  const earnedTypes = new Set((data.badges || []).map((b) => b.badge_type));
  const earned = ALL_BADGES.filter((b) => earnedTypes.has(b.type));

  return (
    <div>
      <h2 className="text-2xl font-bold text-[var(--text-strong)] mb-2">Badges</h2>
      <p className="text-[var(--muted)] mb-6">{earned.length}/{ALL_BADGES.length} earned</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {ALL_BADGES.map((badge) => {
          const isEarned = earnedTypes.has(badge.type);
          return (
            <div key={badge.type}
              className={`rounded-xl p-5 text-center transition-all border ${
                isEarned ? 'bg-[var(--card)] border-[var(--accent)]/40' : 'bg-[var(--card)] border-[var(--border)] opacity-40'}`}>
              <div className="text-2xl mb-3" aria-hidden="true">{isEarned ? '★' : '☆'}</div>
              <p className={`font-semibold text-sm mb-1 ${isEarned ? 'text-[var(--text-strong)]' : 'text-[var(--muted)]'}`}>{badge.label}</p>
              <p className="text-xs text-[var(--faint)]">{badge.description}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-8 bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 text-center">
        <p className="text-[var(--muted)] text-sm">
          Badges are computed locally from your session data. Run <code className="text-[var(--accent)]">wtclaude badges</code> in your terminal to check.
        </p>
      </div>
    </div>
  );
}
