import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';

import '../api/client.dart';
import '../models/track.dart';
import '../services/offline_manager.dart';
import '../services/play_tracking.dart';

/// Global now-playing state — a persistent mini-player needs this shared
/// across screens, same role web/player's PlayerContext.jsx plays.
class PlayerState extends ChangeNotifier {
  final AudioPlayer _audioPlayer = AudioPlayer();
  AudioPlayer get audioPlayer => _audioPlayer;

  Track? _currentTrack;
  PlayTracking? _tracking;
  bool _isOfflinePlayback = false;
  bool _premiumWall = false;
  String? _error;
  bool _wasPlaying = false;

  Track? get currentTrack => _currentTrack;
  bool get playing => _audioPlayer.playing;
  Duration get position => _audioPlayer.position;
  Duration get duration => _audioPlayer.duration ?? Duration.zero;
  bool get premiumWall => _premiumWall;
  String? get error => _error;

  PlayerState() {
    // One subscription for the player's lifetime — _tracking always points
    // at whichever track is current, so this doesn't need to be re-wired
    // per playTrack() call (which would leak a subscription each time).
    _audioPlayer.playerStateStream.listen((state) {
      final isPlaying = state.playing;
      if (isPlaying && !_wasPlaying) {
        _tracking?.onPlaying();
      } else if (!isPlaying && _wasPlaying) {
        _tracking?.onPaused();
      }
      _wasPlaying = isPlaying;

      if (state.processingState == ProcessingState.completed) {
        _tracking?.onEnded();
      }
      notifyListeners();
    });
    _audioPlayer.positionStream.listen((_) => notifyListeners());
  }

  Future<void> playTrack(Track track, {bool offline = false}) async {
    await _tracking?.dispose();
    if (_currentTrack != null && _isOfflinePlayback) {
      await OfflineManager.instance.releasePlayable(_currentTrack!.id);
    }

    _currentTrack = track;
    _isOfflinePlayback = offline;
    _premiumWall = false;
    _error = null;
    _wasPlaying = false;
    _tracking = PlayTracking(
      track.id,
      source: offline ? 'offline' : 'mobile-player',
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
