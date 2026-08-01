import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/track.dart';
import '../services/offline_manager.dart';
import '../state/player_state.dart';

/// Mobile-only — web/player has no offline storage to manage. Mirrors
/// the contract documented in offline_manager.dart: license renewal (or
/// its absence) is what actually gates playback, this screen just
/// surfaces that state.
class DownloadsScreen extends StatefulWidget {
  const DownloadsScreen({super.key});

  @override
  State<DownloadsScreen> createState() => _DownloadsScreenState();
}

class _DownloadsScreenState extends State<DownloadsScreen> {
  List<Track>? _downloads;
  bool _licenseActive = true;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    final license = await OfflineManager.instance.refreshLicenses();
    final downloads = await OfflineManager.instance.listDownloads();
    if (!mounted) return;
    setState(() {
      _licenseActive = license.active;
      _downloads = downloads;
      _loading = false;
    });
  }

  Future<void> _remove(Track track) async {
    await OfflineManager.instance.removeDownload(track.id);
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final downloads = _downloads ?? [];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Téléchargements'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _refresh),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (!_licenseActive)
                  Container(
                    width: double.infinity,
                    color: Colors.redAccent.withValues(alpha: 0.15),
                    padding: const EdgeInsets.all(12),
                    child: const Text(
                      'Abonnement expiré — reconnectez-vous pour réactiver vos téléchargements.',
                      style: TextStyle(color: Colors.redAccent, fontSize: 13),
                    ),
                  ),
                Expanded(
                  child: downloads.isEmpty
                      ? const Center(
                          child: Text(
                            'Aucun téléchargement.',
                            style: TextStyle(color: Colors.white54),
                          ),
                        )
                      : ListView.builder(
                          itemCount: downloads.length,
                          itemBuilder: (context, i) {
                            final track = downloads[i];
                            return ListTile(
                              leading: const Icon(
                                Icons.download_done,
                                color: Color(0xFF1DB954),
                              ),
                              title: Text(
                                track.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(
                                track.artistNames ?? '',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              onTap: () => context
                                  .read<PlayerState>()
                                  .playTrack(track, offline: true),
                              trailing: IconButton(
                                icon: const Icon(Icons.delete_outline),
                                onPressed: () => _remove(track),
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }
}
