import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import SportsBettingDashboard from './pages/SportsBettingDashboard';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/betting" replace />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/betting" element={<SportsBettingDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
