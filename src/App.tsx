import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import SportsBettingDashboard from './pages/SportsBettingDashboard';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/betting" element={<SportsBettingDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
