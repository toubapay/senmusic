import 'package:flutter/material.dart';

import '../api/client.dart';
import 'liked_songs_screen.dart';
import 'playlist_detail_screen.dart';

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  List<dynamic>? _playlists;
  int? _likedCount;
  String? _error;
  final _newTitleController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _newTitleController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        ApiClient.instance.listMyPlaylists(),
        ApiClient.instance.getLikedTracks(),
      ]);
      setState(() {
        _playlists = results[0] as List<dynamic>;
        _likedCount =
            ((results[1] as Map<String, dynamic>)['tracks'] as List).length;
      });
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<void> _create() async {
    final title = _newTitleController.text.trim();
    if (title.isEmpty) return;
    try {
      await ApiClient.instance.createPlaylist(title);
      _newTitleController.clear();
      await _load();
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Bibliothèque')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _newTitleController,
                    decoration: const InputDecoration(
                      hintText: 'Nom de la nouvelle playlist…',
                    ),
                  ),
                ),
                IconButton(icon: const Icon(Icons.add), onPressed: _create),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                _error!,
                style: const TextStyle(color: Colors.redAccent),
              ),
            ),
          if (_playlists == null && _error == null)
            const Expanded(child: Center(child: CircularProgressIndicator())),
          if (_playlists != null)
            Expanded(
              child: ListView(
                children: [
                  ListTile(
                    leading: CircleAvatar(
                      backgroundColor: const Color(0xFF5B47E0),
                      child: const Icon(Icons.favorite, size: 18),
                    ),
                    title: const Text('Titres likés'),
                    subtitle: Text(
                      'Playlist • ${_likedCount ?? '…'} titre${_likedCount == 1 ? '' : 's'}',
                    ),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const LikedSongsScreen(),
                      ),
                    ),
                  ),
                  for (final p in _playlists!)
                    ListTile(
                      leading: CircleAvatar(
                        backgroundColor: const Color(0xFF282828),
                        child: Text(
                          ((p['title'] as String?) ?? '?')
                              .substring(0, 1)
                              .toUpperCase(),
                        ),
                      ),
                      title: Text(p['title'] as String? ?? ''),
                      subtitle: Text(
                        'Playlist • ${p['trackCount']} titre${p['trackCount'] == 1 ? '' : 's'}',
                      ),
                      onTap: () => Navigator.of(context)
                          .push(
                            MaterialPageRoute(
                              builder: (_) => PlaylistDetailScreen(
                                playlistId: p['id'] as String,
                              ),
                            ),
                          )
                          .then((_) => _load()),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
