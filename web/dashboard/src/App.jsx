import React from "react";
import { NavLink, Routes, Route } from "react-router-dom";
import UploadForm from "./components/UploadForm";
import Tracks from "./pages/Tracks";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <span className="logo">ProMusic — Espace artiste</span>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : undefined)}>
            Publier
          </NavLink>
          <NavLink to="/tracks" className={({ isActive }) => (isActive ? "active" : undefined)}>
            Mes titres
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : undefined)}>
            Session
          </NavLink>
        </nav>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<UploadForm />} />
          <Route path="/tracks" element={<Tracks />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
