import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/track.dart';
import '../state/player_state.dart';

class TrackTile extends StatelessWidget {
  const TrackTile({super.key, required this.track, this.offline = false});

  final Track track;
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final current = context.watch<PlayerState>().currentTrack;
    final isCurrent = current?.id == track.id;

    return ListTile(
      selected: isCurrent,
      leading: CircleAvatar(
        backgroundColor: const Color(0xFF282828),
        child: Text(
          track.title.isNotEmpty ? track.title[0].toUpperCase() : '?',
          style: const TextStyle(color: Colors.white70),
        ),
      ),
      title: Row(
        children: [
          Flexible(child: Text(track.title, overflow: TextOverflow.ellipsis)),
          if (track.isPremium) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFF1DB954),
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Text(
                'PREMIUM',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  color: Colors.black,
                ),
              ),
            ),
          ],
        ],
      ),
      subtitle: Text(
        track.artistNames?.isNotEmpty == true
            ? track.artistNames!
            : 'Artiste inconnu',
        overflow: TextOverflow.ellipsis,
      ),
      onTap: () =>
          context.read<PlayerState>().playTrack(track, offline: offline),
    );
  }
}
