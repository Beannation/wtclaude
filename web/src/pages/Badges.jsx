import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const ALL_BADGES = [
  { type: 'first_session', label: 'First Steps', description: 'Tracked your first session', icon: '1' },
  { type: '100k_club', label: '100K Club', description: 'Tracked 100,000 tokens', icon: '2' },
  { type: 'million_club', label: 'Million Club', description: 'Tracked 1,000,000 tokens', icon: '3' },
  { type: '10m_club', label: '10M Club', description: 'Tracked 10,000,000 tokens', icon: '4' },
  { type: 'week_streak', label: 'Week Warrior', description: '7 consecutive days tracked', icon: '5' },
  { type: 'month_streak', label: 'Month Master', description: '30 consecutive days tracked', icon: '6' },
  { type: 'efficient_day', label: 'Cache Champion', description: '50%+ cache hit rate in a day', icon: '7' },
  { type: 'model_mixer', label: 'Model Mixer', description: 'Used 2+ models in one session', icon: '8' },
];

export default function Badges() {
  const [earnedTypes, setEarnedTypes] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadBadges(); }, []);

  async function loadBadges() {
    const anonymousId = localStorage.getItem('wtclaude_anonymous_id');
    if (!anonymousId) { setLoading(false); return; }

    const { data: user } = await supabase
      .from('users').select('id').eq('anonymous_id', anonymousId).single();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('badges')
      .select('badge_type')
      .eq('user_id', user.id);

    setEarnedTypes(new Set((data || []).map(b => b.badge_type)));
    setLoading(false);
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  const earned = ALL_BADGES.filter(b => earnedTypes.has(b.type));

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Badges</h2>
      <p className="text-gray-500 mb-6">{earned.length}/{ALL_BADGES.length} earned</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {ALL_BADGES.map(badge => {
          const isEarned = earnedTypes.has(badge.type);
          return (
            <div
              key={badge.type}
              className={`rounded-xl p-5 text-center transition-all ${
                isEarned
                  ? 'bg-gray-900 border-2 border-green-400/30'
                  : 'bg-gray-900/50 border border-gray-800 opacity-40'
              }`}
            >
              <div className={`text-3xl mb-3 ${isEarned ? '' : 'grayscale'}`}>
                {badge.icon}
              </div>
              <p className={`font-semibold text-sm mb-1 ${isEarned ? 'text-white' : 'text-gray-500'}`}>
                {badge.label}
              </p>
              <p className="text-xs text-gray-500">{badge.description}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-8 bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
        <p className="text-gray-400 text-sm">
          Badges are computed locally from your session data.
          Run <code className="text-green-400">wtclaude badges</code> in your terminal to check.
        </p>
      </div>
    </div>
  );
}
