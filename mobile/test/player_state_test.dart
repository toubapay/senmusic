import 'package:flutter_test/flutter_test.dart';
import 'package:promusic/models/track.dart';
import 'package:promusic/state/player_state.dart';

const _t1 = Track(id: 't1', title: 'Track 1');
const _t2 = Track(id: 't2', title: 'Track 2');
const _t3 = Track(id: 't3', title: 'Track 3');

void main() {
  // just_audio's AudioPlayer() (constructed inside PlayerState()) talks to
  // platform channels as soon as it's built, which need a binding to exist
  // at all -- plain test() blocks don't set one up the way testWidgets()
  // does. The calls still fail with no real platform behind them, but
  // PlayerState's own try/catch downstream (in _playCurrentIndex) absorbs
  // that; this just gets far enough for the index math to run for real.
  TestWidgetsFlutterBinding.ensureInitialized();

  // _playCurrentIndex's network/platform calls (secure storage, just_audio)
  // fail under flutter_test with no platform channels mocked, but that
  // failure is caught internally and only sets `error` — it never rolls
  // back the queue/index state this test actually cares about. So the
  // index math below is exercised for real, no mocking needed.
  group('PlayerState queue index math', () {
    test('playQueue sets currentTrack/hasNext/hasPrev for the start index', () async {
      final player = PlayerState();
      await player.playQueue([_t1, _t2, _t3], 0);

      expect(player.currentTrack?.id, 't1');
      expect(player.hasNext, isTrue);
      expect(player.hasPrev, isFalse);
    });

    test('next() advances through the queue and stops at the end', () async {
      final player = PlayerState();
      await player.playQueue([_t1, _t2, _t3], 0);

      await player.next();
      expect(player.currentTrack?.id, 't2');
      expect(player.hasNext, isTrue);
      expect(player.hasPrev, isTrue);

      await player.next();
      expect(player.currentTrack?.id, 't3');
      expect(player.hasNext, isFalse);
      expect(player.hasPrev, isTrue);

      // No-op past the end.
      await player.next();
      expect(player.currentTrack?.id, 't3');
    });

    test('prev() steps back and stops at the front', () async {
      final player = PlayerState();
      await player.playQueue([_t1, _t2, _t3], 2);

      await player.prev();
      expect(player.currentTrack?.id, 't2');

      await player.prev();
      expect(player.currentTrack?.id, 't1');
      expect(player.hasPrev, isFalse);

      // No-op before the front.
      await player.prev();
      expect(player.currentTrack?.id, 't1');
    });

    test('playTrack is sugar for a 1-item queue', () async {
      final player = PlayerState();
      await player.playTrack(_t1);

      expect(player.currentTrack?.id, 't1');
      expect(player.hasNext, isFalse);
      expect(player.hasPrev, isFalse);
    });
  });
}
