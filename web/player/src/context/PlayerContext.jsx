import React, { createContext, useContext, useState, useCallback } from "react";

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [track, setTrack] = useState(null); // { id, title, artistNames, access }

  const playTrack = useCallback((t) => setTrack(t), []);

  return (
    <PlayerContext.Provider value={{ track, playTrack }}>
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayerContext = () => useContext(PlayerContext);
