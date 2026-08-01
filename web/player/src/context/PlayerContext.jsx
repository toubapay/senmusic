import React, { createContext, useContext, useState, useCallback } from "react";

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [source, setSource] = useState(null);

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  const hasNext = currentIndex >= 0 && currentIndex < queue.length - 1;
  const hasPrev = currentIndex > 0;

  const playQueue = useCallback((tracks, startIndex = 0, sourceLabel = null) => {
    setQueue(tracks);
    setCurrentIndex(startIndex);
    setSource(sourceLabel);
  }, []);

  // Sugar for the common case — every existing call site (search results,
  // etc.) that doesn't care about "what comes next" keeps working exactly
  // as before, just via a 1-item queue instead of a bare `track` field.
  const playTrack = useCallback(
    (track, sourceLabel = null) => playQueue([track], 0, sourceLabel),
    [playQueue]
  );

  const next = useCallback(() => {
    setCurrentIndex((i) => (i >= 0 && i < queue.length - 1 ? i + 1 : i));
  }, [queue.length]);

  const prev = useCallback(() => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const value = {
    queue, currentIndex, currentTrack, source, hasNext, hasPrev,
    playQueue, playTrack, next, prev,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export const usePlayerContext = () => useContext(PlayerContext);
