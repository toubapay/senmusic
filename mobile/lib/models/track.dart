class Track {
  final String id;
  final String title;
  final String? artistNames;
  final String? albumTitle;
  final String? coverUrl;
  final String access; // 'free' | 'premium'
  final int? durationMs;
  final String? genre;

  const Track({
    required this.id,
    required this.title,
    this.artistNames,
    this.albumTitle,
    this.coverUrl,
    this.access = 'free',
    this.durationMs,
    this.genre,
  });

  bool get isPremium => access == 'premium';

  /// From /v1/search or /v1/search/genre/:genre hits — Meilisearch documents
  /// (see lib/meili.js's indexTrack): "artists" is a list of {id, name}.
  factory Track.fromSearchHit(Map<String, dynamic> json) {
    final artists =
        (json['artists'] as List?)
            ?.map((a) => (a as Map<String, dynamic>)['name'] as String?)
            .whereType<String>()
            .join(', ') ??
        '';
    return Track(
      id: json['id'] as String,
      title: json['title'] as String? ?? '',
      artistNames: artists,
      albumTitle: json['albumTitle'] as String?,
      access: json['access'] as String? ?? 'free',
      genre: json['genre'] as String?,
    );
  }

  /// From GET /v1/tracks/:trackId (routes/tracks.js) — "artists" there is
  /// also a list of {id, name}, same shape as the search index.
  factory Track.fromDetail(Map<String, dynamic> json) {
    final artists =
        (json['artists'] as List?)
            ?.map((a) => (a as Map<String, dynamic>)['name'] as String?)
            .whereType<String>()
            .join(', ') ??
        '';
    return Track(
      id: json['id'] as String,
      title: json['title'] as String? ?? '',
      artistNames: artists,
      albumTitle: json['albumTitle'] as String?,
      coverUrl: json['coverUrl'] as String?,
      access: json['access'] as String? ?? 'free',
      durationMs: json['durationMs'] as int?,
      genre: json['genre'] as String?,
    );
  }

  /// From the metadata this app itself stored at download time
  /// (OfflineManager) — see downloadTrack()/listDownloads().
  factory Track.fromOfflineMeta(Map<String, dynamic> json) => Track(
    id: json['id'] as String,
    title: json['title'] as String? ?? '',
    artistNames: json['artistNames'] as String?,
    coverUrl: json['coverUrl'] as String?,
    durationMs: json['durationMs'] as int?,
  );

  Map<String, dynamic> toOfflineMeta({required int downloadedAt}) => {
    'id': id,
    'title': title,
    'artistNames': artistNames,
    'coverUrl': coverUrl,
    'durationMs': durationMs,
    'downloadedAt': downloadedAt,
  };
}
