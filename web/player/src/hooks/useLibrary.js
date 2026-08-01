import { useState, useEffect, useCallback } from "react";
import { getLikedTrackIds, likeTrack, unlikeTrack } from "../api/client";

/**
 * Shared "is this liked" Set + optimistic toggle, so the heart icon on
 * TrackRow behaves consistently everywhere a track list renders
 * (Home, Library, playlist/liked-songs detail).
 */
export function useLibrary() {
  const [likedTrackIds, setLikedTrackIds] = useState(new Set());

  const load = useCallback(async () => {
    try {
      const { trackIds } = await getLikedTrackIds();
      setLikedTrackIds(new Set(trackIds));
    } catch {
      /* leave as-is; the heart just won't reflect state until this succeeds */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleLike = useCallback(async (track) => {
    const isLiked = likedTrackIds.has(track.id);
    setLikedTrackIds((prev) => {
      const next = new Set(prev);
      isLiked ? next.delete(track.id) : next.add(track.id);
      return next;
    });
    try {
      await (isLiked ? unlikeTrack(track.id) : likeTrack(track.id));
    } catch {
      // Revert on failure.
      setLikedTrackIds((prev) => {
        const next = new Set(prev);
        isLiked ? next.add(track.id) : next.delete(track.id);
        return next;
      });
    }
  }, [likedTrackIds]);

  return { likedTrackIds, toggleLike, reload: load };
}
