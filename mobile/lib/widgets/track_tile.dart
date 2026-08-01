import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/track.dart';
import '../state/player_state.dart';

/// queueTracks/queueSource are optional — when given, tapping starts a
/// multi-track queue positioned at this tile instead of a 1-item queue,
/// so next/prev traverse the whole list (a playlist, liked songs, etc).
/// onToggleLike/onAddToPlaylist/onMoveUp/onMoveDown/onRemove are all
/// optional too; their icons only render when a handler is passed, so
/// existing callers (HomeScreen's search/genre results, DownloadsScreen)
/// are visually and behaviorally unchanged unless explicitly wired up.
class TrackTile extends StatelessWidget {
  const TrackTile({
    super.key,
    required this.track,
    this.offline = false,
    this.queueTracks,
    this.queueSource,
    this.isLiked = false,
    this.onToggleLike,
    this.onAddToPlaylist,
    this.onMoveUp,
    this.onMoveDown,
    this.onRemove,
    this.canMoveUp = true,
    this.canMoveDown = true,
  });

  final Track track;
  final bool offline;
  final List<Track>? queueTracks;
  final String? queueSource;
  final bool isLiked;
  final VoidCallback? onToggleLike;
  final VoidCallback? onAddToPlaylist;
  final VoidCallback? onMoveUp;
  final VoidCallback? onMoveDown;
  final VoidCallback? onRemove;
  final bool canMoveUp;
  final bool canMoveDown;

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
      trailing: _hasActions
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (onToggleLike != null)
                  IconButton(
                    icon: Icon(
                      isLiked ? Icons.favorite : Icons.favorite_border,
                      color: isLiked ? const Color(0xFF1DB954) : null,
                      size: 20,
                    ),
                    onPressed: onToggleLike,
                  ),
                if (onAddToPlaylist != null)
                  IconButton(
                    icon: const Icon(Icons.playlist_add, size: 20),
                    onPressed: onAddToPlaylist,
                  ),
                if (onMoveUp != null || onMoveDown != null)
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (onMoveUp != null)
                        IconButton(
                          icon: const Icon(Icons.keyboard_arrow_up, size: 18),
                          onPressed: canMoveUp ? onMoveUp : null,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(
                            minWidth: 28,
                            minHeight: 24,
                          ),
                        ),
                      if (onMoveDown != null)
                        IconButton(
                          icon: const Icon(Icons.keyboard_arrow_down, size: 18),
                          onPressed: canMoveDown ? onMoveDown : null,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(
                            minWidth: 28,
                            minHeight: 24,
                          ),
                        ),
                    ],
                  ),
                if (onRemove != null)
                  IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    onPressed: onRemove,
                  ),
              ],
            )
          : null,
      onTap: () {
        final player = context.read<PlayerState>();
        if (queueTracks != null) {
          final idx = queueTracks!.indexWhere((t) => t.id == track.id);
          player.playQueue(
            queueTracks!,
            idx == -1 ? 0 : idx,
            source: queueSource ?? 'mobile-player',
          );
        } else {
          player.playTrack(
            track,
            offline: offline,
            source: queueSource ?? 'mobile-player',
          );
        }
      },
    );
  }

  bool get _hasActions =>
      onToggleLike != null ||
      onAddToPlaylist != null ||
      onMoveUp != null ||
      onMoveDown != null ||
      onRemove != null;
}
