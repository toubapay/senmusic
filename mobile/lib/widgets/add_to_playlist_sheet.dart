import 'package:flutter/material.dart';

import '../api/client.dart';
import '../models/track.dart';

Future<void> showAddToPlaylistSheet(BuildContext context, Track track) {
  return showModalBottomSheet(
    context: context,
    backgroundColor: const Color(0xFF181818),
    builder: (context) => _AddToPlaylistSheet(track: track),
  );
}

class _AddToPlaylistSheet extends StatefulWidget {
  const _AddToPlaylistSheet({required this.track});
  final Track track;

  @override
  State<_AddToPlaylistSheet> createState() => _AddToPlaylistSheetState();
}

class _AddToPlaylistSheetState extends State<_AddToPlaylistSheet> {
  List<dynamic>? _playlists;
  String? _error;
  final Set<String> _addedTo = {};

  @override
  void initState() {
    super.initState();
    ApiClient.instance
        .listMyPlaylists()
        .then((p) => setState(() => _playlists = p))
        .catchError((e) => setState(() => _error = e.toString()));
  }

  Future<void> _add(String playlistId) async {
    try {
      await ApiClient.instance.addPlaylistTrack(playlistId, widget.track.id);
      setState(() => _addedTo.add(playlistId));
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Ajouter « ${widget.track.title} » à…',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Colors.redAccent),
                ),
              ),
            if (_playlists == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(16),
                child: CircularProgressIndicator(),
              ),
            if (_playlists != null && _playlists!.isEmpty)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Aucune playlist — créez-en une d\'abord.'),
              ),
            if (_playlists != null)
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final p in _playlists!)
                      ListTile(
                        title: Text(p['title'] as String? ?? ''),
                        trailing: _addedTo.contains(p['id'])
                            ? const Icon(Icons.check, color: Color(0xFF1DB954))
                            : null,
                        onTap: () => _add(p['id'] as String),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
