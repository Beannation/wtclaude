import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function fetchSummary(anonymousId, days = 7) {
  const response = await fetch(`${supabaseUrl}/functions/v1/get-summary?days=${days}`, {
    headers: {
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'x-anonymous-id': anonymousId,
    },
  });
  if (!response.ok) throw new Error('Failed to fetch summary');
  return response.json();
}

export async function fetchLeaderboard(period = 'weekly') {
  const response = await fetch(`${supabaseUrl}/functions/v1/get-leaderboard?period=${period}`, {
    headers: {
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
  });
  if (!response.ok) throw new Error('Failed to fetch leaderboard');
  return response.json();
}

export async function fetchSessionTurns(anonymousId, sessionId) {
  const { data } = await supabase
    .from('turns')
    .select('*')
    .eq('session_id', sessionId)
    .order('turn_number', { ascending: true });
  return data || [];
}
