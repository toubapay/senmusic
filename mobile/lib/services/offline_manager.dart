/// OfflineManager — the client half of offline downloads.
/// Ported from mobile's original React Native offlineManager.js.
///
/// Storage layout (all inside the app sandbox — invisible to other apps):
///   {ApplicationDocuments}/offline/{trackId}.enc   AES-256-CTR encrypted audio
///   flutter_secure_storage (Keychain/Keystore):    keys + license expiry + metadata
///
/// Enforcement contract with the backend (services/api/routes/offline.js):
///   - every file is useless without its key
///   - keys live only in secure storage, refreshed via GET /v1/offline/licenses
///   - if renewal returns 403, or licenseExpiresAt passes while offline,
///     purgeAllKeys() runs -> files stay but can never be decrypted again
///
/// Call refreshLicenses() on app launch + on network regain.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:encrypt/encrypt.dart' as enc;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import '../api/client.dart';
import '../models/track.dart';

class PremiumRequiredException implements Exception {}

class LicenseExpiredException implements Exception {}

class OfflineManager {
  OfflineManager._();
  static final OfflineManager instance = OfflineManager._();

  final _storage = const FlutterSecureStorage();

  static String _keyKey(String trackId) => 'offline_key:$trackId';
  static String _metaKey(String trackId) => 'offline_meta:$trackId';
  static const _licenseExpiryKey = 'offline_license_expires_at';

  Future<Directory> _offlineDir() async {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory('${docs.path}/offline');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  // ------------------------------------------------------------
  // Download + encrypt
  // ------------------------------------------------------------
  Future<void> downloadTrack(Track track) async {
    // 1. Authorization, signed URL, and the per-(user,track) content key.
    Map<String, dynamic> auth;
    try {
      auth = await ApiClient.instance.authorizeDownload(track.id);
    } on ApiException catch (e) {
      if (e.status == 403) throw PremiumRequiredException();
      rethrow;
    }
    final downloadUrl = auth['downloadUrl'] as String;
    final keyB64 = auth['key'] as String;
    final licenseExpiresAt = auth['licenseExpiresAt'] as String;

    // 2. Download the m4a.
    final res = await http.get(Uri.parse(downloadUrl));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception('download_failed_${res.statusCode}');
    }

    // 3. Encrypt: AES-256-CTR, random 16-byte IV prepended to the file.
    final key = enc.Key.fromBase64(keyB64);
    final iv = enc.IV.fromSecureRandom(16);
    final encrypter = enc.Encrypter(
      enc.AES(key, mode: enc.AESMode.ctr, padding: null),
    );
    final encrypted = encrypter.encryptBytes(res.bodyBytes, iv: iv);

    final dir = await _offlineDir();
    final file = File('${dir.path}/${track.id}.enc');
    await file.writeAsBytes([...iv.bytes, ...encrypted.bytes]);

    // 4. Persist key + metadata + license expiry in secure storage.
    await _storage.write(key: _keyKey(track.id), value: keyB64);
    await _storage.write(
      key: _metaKey(track.id),
      value: jsonEncode(
        track.toOfflineMeta(
          downloadedAt: DateTime.now().millisecondsSinceEpoch,
        ),
      ),
    );
    await _storage.write(key: _licenseExpiryKey, value: licenseExpiresAt);
  }

  // ------------------------------------------------------------
  // Playback — decrypt to a short-lived cache file for the player
  // ------------------------------------------------------------
  Future<String> getPlayableUri(String trackId) async {
    if (!await isLicenseValid()) {
      await purgeAllKeys();
      // UI: "Reconnectez-vous pour réactiver vos téléchargements"
      throw LicenseExpiredException();
    }
    final keyB64 = await _storage.read(key: _keyKey(trackId));
    if (keyB64 == null) throw Exception('no_key_for_track');

    final dir = await _offlineDir();
    final encFile = File('${dir.path}/$trackId.enc');
    final bytes = await encFile.readAsBytes();
    final iv = enc.IV(Uint8List.sublistView(bytes, 0, 16));
    final cipherBytes = Uint8List.sublistView(bytes, 16);

    final key = enc.Key.fromBase64(keyB64);
    final decrypter = enc.Encrypter(
      enc.AES(key, mode: enc.AESMode.ctr, padding: null),
    );
    final plain = decrypter.decryptBytes(enc.Encrypted(cipherBytes), iv: iv);

    final cacheDir = await getTemporaryDirectory();
    final cachePath = '${cacheDir.path}/np-$trackId.m4a';
    await File(cachePath).writeAsBytes(plain);

    // Pass this path to just_audio; call releasePlayable() when the track
    // changes so decrypted audio never accumulates on disk.
    return cachePath;
  }

  Future<void> releasePlayable(String trackId) async {
    final cacheDir = await getTemporaryDirectory();
    final f = File('${cacheDir.path}/np-$trackId.m4a');
    if (await f.exists()) await f.delete();
  }

  // ------------------------------------------------------------
  // License lifecycle
  // ------------------------------------------------------------
  Future<bool> isLicenseValid() async {
    final exp = await _storage.read(key: _licenseExpiryKey);
    if (exp == null) return false;
    final expiry = DateTime.tryParse(exp);
    return expiry != null && expiry.isAfter(DateTime.now());
  }

  /// Call on app launch and whenever connectivity returns.
  Future<({bool active, String? expiresAt})> refreshLicenses() async {
    try {
      final licenses = await ApiClient.instance.getLicenses();
      final expiresAt = licenses['licenseExpiresAt'] as String;
      await _storage.write(key: _licenseExpiryKey, value: expiresAt);
      for (final entry in (licenses['keys'] as List<dynamic>)) {
        final m = entry as Map<String, dynamic>;
        await _storage.write(
          key: _keyKey(m['trackId'] as String),
          value: m['key'] as String,
        );
      }
      return (active: true, expiresAt: expiresAt);
    } on ApiException catch (e) {
      if (e.status == 403) {
        await purgeAllKeys(); // subscription lapsed -> downloads go dark
        return (active: false, expiresAt: null);
      }
      return (
        active: await isLicenseValid(),
        expiresAt: null,
      ); // transient error: keep grace period
    } catch (_) {
      return (
        active: await isLicenseValid(),
        expiresAt: null,
      ); // fully offline: grace period rules
    }
  }

  Future<void> purgeAllKeys() async {
    final all = await _storage.readAll();
    for (final key in all.keys) {
      if (key.startsWith('offline_key:')) await _storage.delete(key: key);
    }
    await _storage.delete(key: _licenseExpiryKey);
    // Encrypted .enc files remain but are now permanently unreadable. If
    // the user resubscribes, GET /v1/offline/licenses returns the same
    // stable keys, and every file works again without re-downloading.
  }

  // ------------------------------------------------------------
  // Library management
  // ------------------------------------------------------------
  Future<List<Track>> listDownloads() async {
    final all = await _storage.readAll();
    final tracks =
        all.entries
            .where((e) => e.key.startsWith('offline_meta:'))
            .map(
              (e) => (
                track: Track.fromOfflineMeta(
                  jsonDecode(e.value) as Map<String, dynamic>,
                ),
                downloadedAt:
                    (jsonDecode(e.value)
                            as Map<String, dynamic>)['downloadedAt']
                        as int,
              ),
            )
            .toList()
          ..sort((a, b) => b.downloadedAt.compareTo(a.downloadedAt));
    return tracks.map((t) => t.track).toList();
  }

  Future<void> removeDownload(String trackId) async {
    try {
      await ApiClient.instance.deleteDownload(
        trackId,
      ); // best-effort server-side slot release
    } catch (_) {
      /* ignore */
    }
    final dir = await _offlineDir();
    final f = File('${dir.path}/$trackId.enc');
    if (await f.exists()) await f.delete();
    await _storage.delete(key: _keyKey(trackId));
    await _storage.delete(key: _metaKey(trackId));
  }
}
