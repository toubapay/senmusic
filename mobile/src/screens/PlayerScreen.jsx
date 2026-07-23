/**
 * PlayerScreen — full-screen now-playing UI.
 *
 * Uses react-native-video (ExoPlayer on Android, AVPlayer on iOS — both
 * handle HLS + adaptive bitrate natively, so low-bandwidth users on 3G
 * automatically get the 64k rendition without any extra code).
 *
 * Install:
 *   npm i react-native-video @react-native-community/slider
 *
 * For background audio + lock-screen controls, add react-native-track-player
 * later; this screen keeps to the core playback loop.
 */

import React, { useMemo, useRef, useState, useCallback } from "react";
import {
  View, Text, Image, Pressable, ActivityIndicator, StyleSheet,
} from "react-native";
import Video from "react-native-video";
import Slider from "@react-native-community/slider";
import { streamUrl, streamHeaders } from "../api/client";
import { usePlayTracking } from "../hooks/usePlayTracking";

export default function PlayerScreen({ route, navigation }) {
  // track = { id, title, coverUrl, artists: [{name}], durationMs, access }
  const { track } = route.params;

  const videoRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [position, setPosition] = useState(0); // seconds
  const [duration, setDuration] = useState((track.durationMs ?? 0) / 1000);
  const [premiumWall, setPremiumWall] = useState(false);

  const { onPlaying, onPaused, onEnded } = usePlayTracking(track.id);

  const source = useMemo(
    () => ({
      uri: streamUrl(track.id),
      headers: streamHeaders(), // auth for the master playlist request
      type: "m3u8",
    }),
    [track.id]
  );

  // ------------------------------------------------------------
  // Player events
  // ------------------------------------------------------------
  const handleLoad = useCallback((meta) => {
    setDuration(meta.duration);
    setBuffering(false);
    onPlaying();
  }, [onPlaying]);

  const handleProgress = useCallback((p) => {
    setPosition(p.currentTime);
  }, []);

  const handleEnd = useCallback(() => {
    onEnded();
    setPaused(true);
    setPosition(0);
    videoRef.current?.seek(0);
    // → hand off to your queue: navigation/state "play next track"
  }, [onEnded]);

  const handleError = useCallback((e) => {
    // 403 premium_required arrives here as an HTTP error on the master request
    const status = e?.error?.errorCode ?? "";
    if (String(e?.error?.errorString ?? "").includes("403") || status === "403") {
      setPremiumWall(true);
    }
    setBuffering(false);
  }, []);

  const togglePlay = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      next ? onPaused() : onPlaying();
      return next;
    });
  }, [onPaused, onPlaying]);

  const seekTo = useCallback((seconds) => {
    videoRef.current?.seek(seconds);
    setPosition(seconds);
  }, []);

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  const artistNames = track.artists?.map((a) => a.name).join(", ") ?? "";

  return (
    <View style={s.container}>
      {/* Audio-only: Video component stays invisible but drives playback */}
      <Video
        ref={videoRef}
        source={source}
        paused={paused}
        audioOnly
        playInBackground
        ignoreSilentSwitch="ignore"
        progressUpdateInterval={1000}
        onLoad={handleLoad}
        onProgress={handleProgress}
        onEnd={handleEnd}
        onError={handleError}
        onBuffer={({ isBuffering }) => setBuffering(isBuffering)}
        style={s.hidden}
      />

      <Image source={{ uri: track.coverUrl }} style={s.cover} />

      <View style={s.meta}>
        <Text style={s.title} numberOfLines={1}>{track.title}</Text>
        <Text style={s.artist} numberOfLines={1}>{artistNames}</Text>
      </View>

      <Slider
        style={s.slider}
        minimumValue={0}
        maximumValue={duration || 1}
        value={position}
        onSlidingComplete={seekTo}
        minimumTrackTintColor="#1DB954"
        maximumTrackTintColor="#404040"
        thumbTintColor="#ffffff"
      />
      <View style={s.timeRow}>
        <Text style={s.time}>{fmt(position)}</Text>
        <Text style={s.time}>{fmt(duration)}</Text>
      </View>

      <View style={s.controls}>
        <Pressable onPress={() => seekTo(Math.max(0, position - 10))}>
          <Text style={s.secondaryBtn}>−10s</Text>
        </Pressable>

        <Pressable style={s.playBtn} onPress={togglePlay} disabled={buffering}>
          {buffering
            ? <ActivityIndicator color="#000" />
            : <Text style={s.playIcon}>{paused ? "▶" : "❚❚"}</Text>}
        </Pressable>

        <Pressable onPress={() => seekTo(Math.min(duration, position + 10))}>
          <Text style={s.secondaryBtn}>+10s</Text>
        </Pressable>
      </View>

      {premiumWall && (
        <View style={s.paywall}>
          <Text style={s.paywallTitle}>Titre réservé aux abonnés</Text>
          <Text style={s.paywallBody}>
            Abonnez-vous pour écouter ce titre en illimité et en haute qualité.
          </Text>
          <Pressable
            style={s.paywallBtn}
            onPress={() => navigation.navigate("Subscribe")}
          >
            <Text style={s.paywallBtnText}>S'abonner — Wave / Orange Money</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const fmt = (sec) => {
  const m = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#121212", padding: 24, justifyContent: "center" },
  hidden: { width: 0, height: 0 },
  cover: { width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: "#282828" },
  meta: { marginTop: 24 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700" },
  artist: { color: "#b3b3b3", fontSize: 16, marginTop: 4 },
  slider: { marginTop: 24, width: "100%" },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  time: { color: "#b3b3b3", fontSize: 12 },
  controls: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-evenly", marginTop: 24,
  },
  secondaryBtn: { color: "#fff", fontSize: 16, padding: 12 },
  playBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "#1DB954",
    alignItems: "center", justifyContent: "center",
  },
  playIcon: { fontSize: 26, color: "#000" },
  paywall: {
    position: "absolute", left: 24, right: 24, bottom: 40,
    backgroundColor: "#1e1e1e", borderRadius: 16, padding: 20,
  },
  paywallTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  paywallBody: { color: "#b3b3b3", marginTop: 8 },
  paywallBtn: {
    marginTop: 16, backgroundColor: "#1DB954", borderRadius: 24,
    paddingVertical: 12, alignItems: "center",
  },
  paywallBtnText: { color: "#000", fontWeight: "700" },
});
