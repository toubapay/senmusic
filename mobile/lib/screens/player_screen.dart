import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/offline_manager.dart';
import '../state/player_state.dart';

String _fmt(Duration d) {
  final m = d.inMinutes;
  final s = (d.inSeconds % 60).toString().padLeft(2, '0');
  return '$m:$s';
}

class PlayerScreen extends StatelessWidget {
  const PlayerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerState>();
    final track = player.currentTrack;

    if (track == null) {
      return const Scaffold(
        body: Center(child: Text('Aucun titre en lecture')),
      );
    }

    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.download_outlined),
            tooltip: 'Télécharger pour écoute hors ligne',
            onPressed: () async {
              final messenger = ScaffoldMessenger.of(context);
              try {
                await OfflineManager.instance.downloadTrack(track);
                messenger.showSnackBar(
                  const SnackBar(
                    content: Text('Téléchargé pour écoute hors ligne'),
                  ),
                );
              } on PremiumRequiredException {
                messenger.showSnackBar(
                  const SnackBar(
                    content: Text('Abonnement requis pour le téléchargement'),
                  ),
                );
              } catch (e) {
                messenger.showSnackBar(
                  SnackBar(content: Text('Échec du téléchargement : $e')),
                );
              }
            },
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF282828),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.music_note,
                  size: 96,
                  color: Colors.white24,
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              track.title,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
            Text(
              track.artistNames ?? '',
              style: const TextStyle(fontSize: 16, color: Colors.white54),
            ),
            const SizedBox(height: 24),

            if (player.premiumWall)
              _Paywall(
                onSubscribe: () =>
                    Navigator.of(context).pushNamed('/subscribe'),
              )
            else if (player.error != null)
              Text(
                'Lecture impossible (${player.error}).',
                style: const TextStyle(color: Colors.redAccent),
              )
            else ...[
              Slider(
                value: player.position.inMilliseconds
                    .clamp(0, player.duration.inMilliseconds)
                    .toDouble(),
                max: player.duration.inMilliseconds > 0
                    ? player.duration.inMilliseconds.toDouble()
                    : 1,
                activeColor: const Color(0xFF1DB954),
                onChanged: (v) =>
                    player.seekTo(Duration(milliseconds: v.round())),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _fmt(player.position),
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 12,
                      ),
                    ),
                    Text(
                      _fmt(player.duration),
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  IconButton(
                    iconSize: 32,
                    icon: const Icon(Icons.replay_10),
                    onPressed: () => player.seekTo(
                      player.position - const Duration(seconds: 10),
                    ),
                  ),
                  IconButton(
                    iconSize: 64,
                    icon: Icon(
                      player.playing
                          ? Icons.pause_circle_filled
                          : Icons.play_circle_filled,
                      color: const Color(0xFF1DB954),
                    ),
                    onPressed: player.togglePlay,
                  ),
                  IconButton(
                    iconSize: 32,
                    icon: const Icon(Icons.forward_10),
                    onPressed: () => player.seekTo(
                      player.position + const Duration(seconds: 10),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Paywall extends StatelessWidget {
  const _Paywall({required this.onSubscribe});
  final VoidCallback onSubscribe;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E1E),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Titre réservé aux abonnés',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          const Text(
            'Abonnez-vous pour écouter ce titre en illimité et en haute qualité.',
            style: TextStyle(color: Colors.white54),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF1DB954),
                foregroundColor: Colors.black,
              ),
              onPressed: onSubscribe,
              child: const Text("S'abonner — Wave / Orange Money"),
            ),
          ),
        ],
      ),
    );
  }
}
