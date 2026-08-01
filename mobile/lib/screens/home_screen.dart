import 'package:flutter/material.dart';

import '../api/client.dart';
import '../models/track.dart';
import '../widgets/add_to_playlist_sheet.dart';
import '../widgets/track_tile.dart';

const _genreChips = [
  'mbalax',
  'afrobeats',
  'hip-hop',
  'coupé-décalé',
  'gospel',
];

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _searchController = TextEditingController();
  List<Track>? _searchResults;
  List<Track>? _genreResults;
  String? _activeGenre;
  String? _error;
  bool _loading = false;

  List<Track>? _recent;
  Set<String> _likedIds = {};

  @override
  void initState() {
    super.initState();
    ApiClient.instance
        .getRecentlyPlayed(limit: 10)
        .then((r) {
          setState(
            () => _recent = (r['tracks'] as List<dynamic>)
                .map((t) => Track.fromDetail(t as Map<String, dynamic>))
                .toList(),
          );
        })
        .catchError((_) {
          setState(() => _recent = []);
        });
    ApiClient.instance
        .getLikedTrackIds()
        .then((ids) => setState(() => _likedIds = ids.toSet()))
        .catchError((_) {});
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

  Future<void> _runSearch(String q) async {
    if (q.trim().length < 2) return;
    setState(() {
      _loading = true;
      _error = null;
      _genreResults = null;
      _activeGenre = null;
    });
    try {
      final r = await ApiClient.instance.search(q.trim());
      final tracks = (r['tracks'] as List<dynamic>)
          .map((t) => Track.fromSearchHit(t as Map<String, dynamic>))
          .toList();
      setState(() => _searchResults = tracks);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _runGenre(String genre) async {
    setState(() {
      _loading = true;
      _error = null;
      _searchResults = null;
      _activeGenre = genre;
    });
    try {
      final hits = await ApiClient.instance.searchByGenre(genre);
      setState(
        () => _genreResults = hits
            .map((t) => Track.fromSearchHit(t as Map<String, dynamic>))
            .toList(),
      );
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Widget _trackTile(Track t, List<Track> queue, String source) => TrackTile(
    track: t,
    queueTracks: queue,
    queueSource: source,
    isLiked: _likedIds.contains(t.id),
    onToggleLike: () => _toggleLike(t),
    onAddToPlaylist: () => showAddToPlaylistSheet(context, t),
  );

  @override
  Widget build(BuildContext context) {
    final results = _searchResults ?? _genreResults;

    return CustomScrollView(
      slivers: [
        if (_recent != null && _recent!.isNotEmpty) ...[
          const SliverPadding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
            sliver: SliverToBoxAdapter(
              child: Text(
                'Repris récemment',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
            ),
          ),
          SliverList.builder(
            itemCount: _recent!.length,
            itemBuilder: (context, i) =>
                _trackTile(_recent![i], _recent!, 'recently_played'),
          ),
        ],
        SliverPadding(
          padding: const EdgeInsets.all(16),
          sliver: SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Chercher un titre, un artiste, un album…',
                    filled: true,
                    fillColor: const Color(0xFF242424),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(24),
                      borderSide: BorderSide.none,
                    ),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                  textInputAction: TextInputAction.search,
                  onSubmitted: _runSearch,
                ),
                const SizedBox(height: 20),
                const Text(
                  'Parcourir par genre',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: _genreChips
                      .map(
                        (g) => ChoiceChip(
                          label: Text(g),
                          selected: _activeGenre == g,
                          onSelected: (_) => _runGenre(g),
                        ),
                      )
                      .toList(),
                ),
                if (_loading)
                  const Padding(
                    padding: EdgeInsets.only(top: 24),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: Colors.redAccent),
                    ),
                  ),
              ],
            ),
          ),
        ),
        if (results != null)
          results.isEmpty
              ? const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'Aucun résultat.',
                      style: TextStyle(color: Colors.white54),
                    ),
                  ),
                )
              : SliverList.builder(
                  itemCount: results.length,
                  itemBuilder: (context, i) => _trackTile(
                    results[i],
                    results,
                    _searchResults != null ? 'search' : 'genre',
                  ),
                ),
      ],
    );
  }
}
