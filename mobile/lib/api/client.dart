/// API client for the ProMusic mobile app.
///
/// Base URL is compile-time configurable (Vite's import.meta.env.
/// VITE_API_BASE_URL equivalent): flutter run --dart-define=API_BASE_URL=...
/// Defaults to the same placeholder every other piece in this repo uses.
library;

import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

const String _apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://api.yourdomain.sn',
);

class ApiException implements Exception {
  final int status;
  final String error;
  ApiException(this.status, this.error);
  @override
  String toString() => error;
}

class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  final _storage = const FlutterSecureStorage();
  static const _tokenKey = 'token';

  String? _cachedToken;

  Future<String?> getToken() async {
    return _cachedToken ??= await _storage.read(key: _tokenKey);
  }

  Future<void> setToken(String token) async {
    _cachedToken = token;
    await _storage.write(key: _tokenKey, value: token);
  }

  Future<void> clearToken() async {
    _cachedToken = null;
    await _storage.delete(key: _tokenKey);
  }

  Future<Map<String, String>> authHeaders() async {
    final token = await getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ${token ?? ''}',
    };
  }

  Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('$_apiBaseUrl$path');
    final headers = await authHeaders();
    late http.Response res;
    switch (method) {
      case 'GET':
        res = await http.get(uri, headers: headers);
      case 'POST':
        res = await http.post(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
      case 'PATCH':
        res = await http.patch(
          uri,
          headers: headers,
          body: body != null ? jsonEncode(body) : null,
        );
      case 'DELETE':
        res = await http.delete(uri, headers: headers);
      default:
        throw ArgumentError('unsupported method $method');
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.statusCode == 204 || res.body.isEmpty) return null;
      return jsonDecode(res.body);
    }

    String error = 'http_${res.statusCode}';
    try {
      final payload = jsonDecode(res.body) as Map<String, dynamic>;
      error = payload['error'] as String? ?? error;
    } catch (_) {
      /* non-JSON error body */
    }
    throw ApiException(res.statusCode, error);
  }

  // ------------------------------------------------------------
  // Search / browse
  // ------------------------------------------------------------
  Future<Map<String, dynamic>> search(String q, {int limit = 10}) => _request(
    'GET',
    '/v1/search?q=${Uri.encodeQueryComponent(q)}&limit=$limit',
  ).then((r) => r as Map<String, dynamic>);

  Future<List<dynamic>> searchByGenre(String genre, {int limit = 20}) =>
      _request(
        'GET',
        '/v1/search/genre/${Uri.encodeComponent(genre)}?limit=$limit',
      ).then((r) => (r as Map<String, dynamic>)['tracks'] as List<dynamic>);

  Future<Map<String, dynamic>> getTrack(String trackId) => _request(
    'GET',
    '/v1/tracks/${Uri.encodeComponent(trackId)}',
  ).then((r) => r as Map<String, dynamic>);

  // ------------------------------------------------------------
  // Streaming
  // ------------------------------------------------------------
  String streamUrl(String trackId) =>
      '$_apiBaseUrl/v1/tracks/$trackId/stream/master.m3u8';

  // just_audio needs this only on the master-playlist request itself —
  // variant playlists/segments carry their own token/signature in the URL.
  Future<Map<String, String>> streamHeaders() async {
    final token = await getToken();
    return {'Authorization': 'Bearer ${token ?? ''}'};
  }

  // ------------------------------------------------------------
  // Play tracking
  // ------------------------------------------------------------
  Future<String> startPlay(String trackId, String source, String device) =>
      _request(
        'POST',
        '/v1/plays',
        body: {'trackId': trackId, 'source': source, 'device': device},
      ).then((r) => (r as Map<String, dynamic>)['playId'] as String);

  Future<bool> heartbeatPlay(String playId, int msPlayed) => _request(
    'PATCH',
    '/v1/plays/$playId',
    body: {'msPlayed': msPlayed},
  ).then((r) => (r as Map<String, dynamic>)['counted'] as bool);

  // ------------------------------------------------------------
  // Subscriptions
  // ------------------------------------------------------------
  Future<Map<String, dynamic>> getSubscription() => _request(
    'GET',
    '/v1/subscriptions/me',
  ).then((r) => r as Map<String, dynamic>);

  Future<Map<String, dynamic>> checkout(String planCode) => _request(
    'POST',
    '/v1/subscriptions/checkout',
    body: {'planCode': planCode},
  ).then((r) => r as Map<String, dynamic>);

  // ------------------------------------------------------------
  // Offline downloads (server side — see OfflineManager for the client half)
  // ------------------------------------------------------------
  Future<Map<String, dynamic>> authorizeDownload(String trackId) => _request(
    'POST',
    '/v1/offline/downloads',
    body: {'trackId': trackId},
  ).then((r) => r as Map<String, dynamic>);

  Future<Map<String, dynamic>> getLicenses() => _request(
    'GET',
    '/v1/offline/licenses',
  ).then((r) => r as Map<String, dynamic>);

  Future<void> deleteDownload(String trackId) => _request(
    'DELETE',
    '/v1/offline/downloads/${Uri.encodeComponent(trackId)}',
  );
}
