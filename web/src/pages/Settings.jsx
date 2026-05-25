import { useState } from 'react';

export default function Settings() {
  const [anonymousId, setAnonymousId] = useState(
    localStorage.getItem('wtclaude_anonymous_id') || ''
  );
  const [saved, setSaved] = useState(false);

  function handleLink() {
    localStorage.setItem('wtclaude_anonymous_id', anonymousId.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Settings</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <h3 className="text-white font-semibold mb-3">Link your account</h3>
        <p className="text-gray-400 text-sm mb-4">
          Enter your anonymous ID to connect this dashboard to your CLI data.
          Find it by running <code className="text-green-400">wtclaude sync --status</code> in your terminal.
        </p>

        <div className="flex gap-3">
          <input
            type="text"
            value={anonymousId}
            onChange={e => setAnonymousId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="flex-1 bg-black border border-gray-700 rounded-lg px-4 py-2 text-white font-mono text-sm focus:outline-none focus:border-green-400"
          />
          <button
            onClick={handleLink}
            className="bg-green-500 hover:bg-green-400 text-black font-semibold px-6 py-2 rounded-lg transition-colors"
          >
            {saved ? 'Saved!' : 'Link'}
          </button>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <h3 className="text-white font-semibold mb-3">CLI Setup</h3>
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-gray-400 mb-2">1. Install and configure the collector:</p>
            <code className="block bg-black text-green-400 px-4 py-2 rounded-lg">npx wtclaude setup</code>
          </div>
          <div>
            <p className="text-gray-400 mb-2">2. Enable cloud sync:</p>
            <code className="block bg-black text-green-400 px-4 py-2 rounded-lg">wtclaude sync --configure</code>
          </div>
          <div>
            <p className="text-gray-400 mb-2">3. After using Claude Code, sync your data:</p>
            <code className="block bg-black text-green-400 px-4 py-2 rounded-lg">wtclaude sync</code>
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-white font-semibold mb-3">Data sharing</h3>
        <p className="text-gray-400 text-sm mb-3">
          Control what data is shared for the leaderboard and community benchmarks.
          Manage in your terminal:
        </p>
        <code className="block bg-black text-green-400 px-4 py-2 rounded-lg text-sm mb-2">wtclaude share --preview</code>
        <code className="block bg-black text-green-400 px-4 py-2 rounded-lg text-sm">wtclaude share --enable</code>
      </div>
    </div>
  );
}
