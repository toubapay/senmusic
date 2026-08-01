import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../screens/player_screen.dart';
import '../state/player_state.dart';

/// Persistent bottom bar, shown whenever a track is loaded — same role as
/// web/player's BottomPlayer.jsx.
class MiniPlayer extends StatelessWidget {
  const MiniPlayer({super.key});

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerState>();
    final track = player.currentTrack;
    if (track == null) return const SizedBox.shrink();

    return Material(
      color: const Color(0xFF181818),
      child: InkWell(
        onTap: () => Navigator.of(
          context,
        ).push(MaterialPageRoute(builder: (_) => const PlayerScreen())),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      track.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    Text(
                      track.artistNames ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              if (player.premiumWall)
                const Text(
                  'Abonnés uniquement',
                  style: TextStyle(fontSize: 12, color: Colors.white70),
                )
              else if (player.error != null)
                const Icon(Icons.error_outline, color: Colors.redAccent)
              else
                IconButton(
                  icon: Icon(
                    player.playing
                        ? Icons.pause_circle_filled
                        : Icons.play_circle_filled,
                    color: const Color(0xFF1DB954),
                    size: 36,
                  ),
                  onPressed: player.togglePlay,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
