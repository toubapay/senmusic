/// PlayTracking — reports listening time to the backend.
/// Ported from mobile's original React Native usePlayTracking.js; same rules:
///   - a play session opens when playback actually starts (not on screen open)
///   - msPlayed accumulates only while audio is playing (seeking doesn't inflate it)
///   - heartbeat PATCH every 10s while playing, plus a final flush on
///     pause / track end / dispose, so the >= 30s "counted" flip is never lost
library;

import 'dart:async';

import '../api/client.dart';

const _heartbeatInterval = Duration(seconds: 10);

class PlayTracking {
  PlayTracking(this.trackId, {this.source = 'mobile-player'});

  final String trackId;
  final String source;

  String? _playId;
  double _msPlayed = 0;
  DateTime? _lastTick;
  Timer? _timer;

  Future<void> _flush() async {
    final playId = _playId;
    if (playId == null) return;
    try {
      await ApiClient.instance.heartbeatPlay(playId, _msPlayed.round());
    } catch (_) {
      // Non-fatal: a missed heartbeat just means a slightly undercounted play.
    }
  }

  void _tick() {
    final now = DateTime.now();
    final last = _lastTick;
    if (last != null) {
      _msPlayed += now.difference(last).inMilliseconds;
    }
    _lastTick = now;
  }

  Future<void> onPlaying() async {
    _lastTick = DateTime.now();

    if (_playId == null) {
      try {
        _playId = await ApiClient.instance.startPlay(trackId, source, 'mobile');
      } catch (_) {
        /* retry on next onPlaying */
      }
    }

    _timer?.cancel();
    _timer = Timer.periodic(_heartbeatInterval, (_) {
      _tick();
      _flush();
    });
  }

  Future<void> onPaused() async {
    _tick();
    _lastTick = null;
    _timer?.cancel();
    await _flush();
  }

  Future<void> onEnded() async {
    await onPaused();
    _playId = null; // next play of the same track = new session
    _msPlayed = 0;
  }

  /// Call when the player screen/track changes so a final heartbeat isn't lost.
  Future<void> dispose() async {
    _tick();
    _timer?.cancel();
    await _flush();
  }
}
