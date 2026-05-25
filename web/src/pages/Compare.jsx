import { formatCost, formatTokens } from '../lib/format';

export default function Compare() {
  // In v1, comparison data comes from local CLI, not the cloud
  // This page explains how to run the comparison locally

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Accurate vs JSONL</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <h3 className="text-red-400 text-sm uppercase tracking-wide font-semibold mb-4">
          Why your current tracker is wrong
        </h3>
        <p className="text-gray-400 mb-4">
          Claude Code's JSONL logs record input tokens as 0 in 75% of entries.
          Output tokens exclude thinking/reasoning tokens. Every community tool
          reads these broken logs.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[#0a0a14] rounded-lg p-4 text-center">
            <p className="text-xs text-gray-500 uppercase mb-2">JSONL says</p>
            <p className="text-xl font-mono font-bold text-gray-500 line-through">225K</p>
          </div>
          <div className="bg-[#0a0a14] rounded-lg p-4 text-center">
            <p className="text-xs text-gray-500 uppercase mb-2">Actual</p>
            <p className="text-xl font-mono font-bold text-green-400">10.4M</p>
          </div>
          <div className="bg-[#0a0a14] rounded-lg p-4 text-center">
            <p className="text-xs text-gray-500 uppercase mb-2">Gap</p>
            <p className="text-xl font-mono font-bold text-red-400">46x</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-white font-semibold mb-3">Check your own numbers</h3>
        <p className="text-gray-400 mb-4">
          Run this command in your terminal to see the accuracy gap in your own data:
        </p>
        <code className="block bg-black text-green-400 px-4 py-3 rounded-lg text-sm mb-4">
          wtclaude compare
        </code>
        <p className="text-gray-500 text-sm">
          Add <code className="text-green-400">--share</code> to save a shareable comparison card to your Desktop.
        </p>
      </div>
    </div>
  );
}
