import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Timeline from './pages/Timeline';
import Sessions from './pages/Sessions';
import Devices from './pages/Devices';
import Compare from './pages/Compare';
import WhatIf from './pages/WhatIf';
import Leaderboard from './pages/Leaderboard';
import Badges from './pages/Badges';
import Settings from './pages/Settings';

function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Overview />} />
            <Route path="/timeline" element={<Timeline />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/whatif" element={<WhatIf />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/badges" element={<Badges />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
