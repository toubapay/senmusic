import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';

import '../api/client.dart';
import '../models/track.dart';
import '../services/offline_manager.dart';
import '../services/play_tracking.dart';

/// Global now-playing state — a persistent mini-player needs this shared
/// across screens, same role web/player's PlayerContext.jsx plays. Same
/// queue/currentIndex shape as web: playTrack() is sugar for a 1-item
/// playQueue(), so every existing call site keeps working unchanged.
class PlayerState extends ChangeNotifier {
  final AudioPlayer _audioPlayer = AudioPlayer();
  AudioPlayer get audioPlayer => _audioPlayer;

  List<Track> _queue = [];
  int _currentIndex = -1;
  String? _source;
  PlayTracking? _tracking;
  bool _isOfflinePlayback = false;
  bool _premiumWall = false;
  String? _error;
  bool _wasPlaying = false;

  Track? get currentTrack =>
      (_currentIndex >= 0 && _currentIndex < _queue.length)
      ? _queue[_currentIndex]
      : null;
  bool get hasNext => _currentIndex >= 0 && _currentIndex < _queue.length - 1;
  bool get hasPrev => _currentIndex > 0;
  bool get playing => _audioPlayer.playing;
  Duration get position => _audioPlayer.position;
  Duration get duration => _audioPlayer.duration ?? Duration.zero;
  bool get premiumWall => _premiumWall;
  String? get error => _error;

  PlayerState() {
    // One subscription for the player's lifetime — _tracking always points
    // at whichever track is current, so this doesn't need to be re-wired
    // per playQueue() call (which would leak a subscription each time).
    _audioPlayer.playerStateStream.listen((state) async {
      final isPlaying = state.playing;
      if (isPlaying && !_wasPlaying) {
        _tracking?.onPlaying();
      } else if (!isPlaying && _wasPlaying) {
        _tracking?.onPaused();
      }
      _wasPlaying = isPlaying;

      if (state.processingState == ProcessingState.completed) {
        await _tracking?.onEnded();
        if (hasNext) await next();
      }
      notifyListeners();
    });
    _audioPlayer.positionStream.listen((_) => notifyListeners());
  }

  Future<void> playQueue(
    List<Track> tracks,
    int startIndex, {
    String source = 'mobile-player',
    bool offline = false,
  }) async {
    await _tracking?.dispose();
    if (currentTrack != null && _isOfflinePlayback) {
      await OfflineManager.instance.releasePlayable(currentTrack!.id);
    }

    _queue = tracks;
    _currentIndex = startIndex;
    _source = source;
    _isOfflinePlayback = offline;
    await _playCurrentIndex(offline: offline);
  }

  /// Sugar for the common case — plays a single track with no queue context.
  Future<void> playTrack(
    Track track, {
    bool offline = false,
    String source = 'mobile-player',
  }) => playQueue([track], 0, source: source, offline: offline);

  Future<void> next() async {
    if (!hasNext) return;
    _currentIndex++;
    await _playCurrentIndex(offline: _isOfflinePlayback);
  }

  Future<void> prev() async {
    if (!hasPrev) return;
    _currentIndex--;
    await _playCurrentIndex(offline: _isOfflinePlayback);
  }

  Future<void> _playCurrentIndex({bool offline = false}) async {
    final track = currentTrack;
    if (track == null) return;

    _premiumWall = false;
    _error = null;
    _wasPlaying = false;
    _tracking = PlayTracking(
      track.id,
      source: offline ? 'offline' : (_source ?? 'mobile-player'),
    );
    notifyListeners();

    try {
      if (offline) {
        final path = await OfflineManager.instance.getPlayableUri(track.id);
        await _audioPlayer.setFilePath(path);
      } else {
        final headers = await ApiClient.instance.streamHeaders();
        await _audioPlayer.setAudioSource(
          AudioSource.uri(
            Uri.parse(ApiClient.instance.streamUrl(track.id)),
            headers: headers,
          ),
        );
      }
      await _audioPlayer.play();
    } catch (e) {
      // 403 premium_required arrives here as a platform HTTP error on the
      // master-playlist request — just_audio doesn't expose the status
      // code uniformly across ExoPlayer/AVPlayer, so this is the same
      // string-sniffing compromise the original React Native PlayerScreen
      // made against react-native-video's error object.
      if (e.toString().contains('403')) {
        _premiumWall = true;
      } else {
        _error = e.toString();
      }
      notifyListeners();
    }
  }

  Future<void> togglePlay() async {
    if (_audioPlayer.playing) {
      await _audioPlayer.pause();
    } else {
      await _audioPlayer.play();
    }
  }

  Future<void> seekTo(Duration position) => _audioPlayer.seek(position);

  @override
  void dispose() {
    _tracking?.dispose();
    _audioPlayer.dispose();
    super.dispose();
  }
}
