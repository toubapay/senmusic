import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../models/track.dart';
import '../state/player_state.dart';
import '../widgets/add_to_playlist_sheet.dart';
import '../widgets/track_tile.dart';

class PlaylistDetailScreen extends StatefulWidget {
  const PlaylistDetailScreen({super.key, required this.playlistId});
  final String playlistId;

  @override
  State<PlaylistDetailScreen> createState() => _PlaylistDetailScreenState();
}

class _PlaylistDetailScreenState extends State<PlaylistDetailScreen> {
  Map<String, dynamic>? _playlist;
  List<Track>? _tracks;
  Set<String> _likedIds = {};
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    ApiClient.instance.getLikedTrackIds().then(
      (ids) => setState(() => _likedIds = ids.toSet()),
    );
  }

  Future<void> _load() async {
    try {
      final p = await ApiClient.instance.getPlaylist(widget.playlistId);
      setState(() {
        _playlist = p;
        _tracks = (p['tracks'] as List<dynamic>)
            .map((t) => Track.fromDetail(t as Map<String, dynamic>))
            .toList();
      });
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<void> _toggleLike(Track track) async {
    final liked = _likedIds.contains(track.id);
    setState(
      () => liked ? _likedIds.remove(track.id) : _likedIds.add(track.id),
    );
    try {
      if (liked) {
        await ApiClient.instance.unlikeTrack(track.id);
      } else {
        await ApiClient.instance.likeTrack(track.id);
      }
    } catch (_) {
      setState(
        () => liked ? _likedIds.add(track.id) : _likedIds.remove(track.id),
      );
    }
  }

  Future<void> _removeTrack(String trackId) async {
    await ApiClient.instance.removePlaylistTrack(widget.playlistId, trackId);
    _load();
  }

  Future<void> _move(int index, int direction) async {
    final tracks = _tracks!;
    final targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= tracks.length) return;
    final afterIndex = direction == -1 ? targetIndex - 1 : targetIndex;
    final afterTrackId = afterIndex < 0 ? null : tracks[afterIndex].id;
    await ApiClient.instance.reorderPlaylistTrack(
      widget.playlistId,
      tracks[index].id,
      afterTrackId,
    );
    _load();
  }

  Future<void> _delete() async {
    await ApiClient.instance.deletePlaylist(widget.playlistId);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Scaffold(
        body: Center(
          child: Text(_error!, style: const TextStyle(color: Colors.redAccent)),
        ),
      );
    }
    if (_playlist == null || _tracks == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final isOwner = _playlist!['isOwner'] == true;
    final tracks = _tracks!;

    return Scaffold(
      appBar: AppBar(
        title: Text(_playlist!['title'] as String? ?? ''),
        actions: [
          if (isOwner)
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: _delete,
            ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                icon: const Icon(Icons.play_arrow),
                label: const Text('Tout lire'),
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF1DB954),
                  foregroundColor: Colors.black,
                ),
                onPressed: tracks.isEmpty
                    ? null
                    : () => context.read<PlayerState>().playQueue(
                        tracks,
                        0,
                        source: 'playlist',
                      ),
              ),
            ),
          ),
          Expanded(
            child: tracks.isEmpty
                ? const Center(
                    child: Text(
                      'Playlist vide.',
                      style: TextStyle(color: Colors.white54),
                    ),
                  )
                : ListView.builder(
                    itemCount: tracks.length,
                    itemBuilder: (context, i) => TrackTile(
                      track: tracks[i],
                      queueTracks: tracks,
                      queueSource: 'playlist',
                      isLiked: _likedIds.contains(tracks[i].id),
                      onToggleLike: () => _toggleLike(tracks[i]),
                      onAddToPlaylist: () =>
                          showAddToPlaylistSheet(context, tracks[i]),
                      onMoveUp: isOwner ? () => _move(i, -1) : null,
                      onMoveDown: isOwner ? () => _move(i, 1) : null,
                      onRemove: isOwner
                          ? () => _removeTrack(tracks[i].id)
                          : null,
                      canMoveUp: i > 0,
                      canMoveDown: i < tracks.length - 1,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}
