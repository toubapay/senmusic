import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../models/track.dart';
import '../state/player_state.dart';
import '../widgets/add_to_playlist_sheet.dart';
import '../widgets/track_tile.dart';

class LikedSongsScreen extends StatefulWidget {
  const LikedSongsScreen({super.key});

  @override
  State<LikedSongsScreen> createState() => _LikedSongsScreenState();
}

class _LikedSongsScreenState extends State<LikedSongsScreen> {
  List<Track>? _tracks;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await ApiClient.instance.getLikedTracks();
      setState(() {
        _tracks = (r['tracks'] as List<dynamic>)
            .map((t) => Track.fromDetail(t as Map<String, dynamic>))
            .toList();
      });
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<void> _unlike(Track track) async {
    await ApiClient.instance.unlikeTrack(track.id);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Titres likés')),
      body: _error != null
          ? Center(
              child: Text(
                _error!,
                style: const TextStyle(color: Colors.redAccent),
              ),
            )
          : _tracks == null
          ? const Center(child: CircularProgressIndicator())
          : Column(
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
                      onPressed: _tracks!.isEmpty
                          ? null
                          : () => context.read<PlayerState>().playQueue(
                              _tracks!,
                              0,
                              source: 'liked_songs',
                            ),
                    ),
                  ),
                ),
                Expanded(
                  child: _tracks!.isEmpty
                      ? const Center(
                          child: Text(
                            'Aucun titre liké pour l\'instant.',
                            style: TextStyle(color: Colors.white54),
                          ),
                        )
                      : ListView.builder(
                          itemCount: _tracks!.length,
                          itemBuilder: (context, i) => TrackTile(
                            track: _tracks![i],
                            queueTracks: _tracks,
                            queueSource: 'liked_songs',
                            isLiked: true,
                            onToggleLike: () => _unlike(_tracks![i]),
                            onAddToPlaylist: () =>
                                showAddToPlaylistSheet(context, _tracks![i]),
                          ),
                        ),
                ),
              ],
            ),
    );
  }
}
