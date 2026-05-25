import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Overview' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/compare', label: 'Compare' },
  { to: '/whatif', label: 'What If' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/badges', label: 'Badges' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200">
      <header className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-green-400">WTClaude</h1>
          <nav className="flex gap-1 overflow-x-auto">
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
