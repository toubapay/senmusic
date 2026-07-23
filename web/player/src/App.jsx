import React from "react";
import { NavLink, Routes, Route } from "react-router-dom";
import { PlayerProvider } from "./context/PlayerContext";
import BottomPlayer from "./components/BottomPlayer";
import Home from "./pages/Home";
import Subscribe from "./pages/Subscribe";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <PlayerProvider>
      <div className="app">
        <header className="header">
          <span className="logo">ProMusic</span>
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : undefined)}>
              Accueil
            </NavLink>
            <NavLink to="/subscribe" className={({ isActive }) => (isActive ? "active" : undefined)}>
              Abonnement
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : undefined)}>
              Session
            </NavLink>
          </nav>
        </header>

        <main className="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/subscribe" element={<Subscribe />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>

        <BottomPlayer />
      </div>
    </PlayerProvider>
  );
}
