import 'package:flutter/foundation.dart';

import '../api/client.dart';

/// No login/signup route exists yet (see CLAUDE.md), so this is where a
/// session JWT gets in — paste one issued elsewhere (e.g. the API test
/// console's token generator), same as web/player and web/dashboard's
/// Settings pages.
class AuthState extends ChangeNotifier {
  String? _token;
  bool _loaded = false;

  String? get token => _token;
  bool get isSignedIn => _token != null && _token!.isNotEmpty;
  bool get loaded => _loaded;

  Future<void> load() async {
    _token = await ApiClient.instance.getToken();
    _loaded = true;
    notifyListeners();
  }

  Future<void> setToken(String token) async {
    await ApiClient.instance.setToken(token);
    _token = token;
    notifyListeners();
  }

  Future<void> signOut() async {
    await ApiClient.instance.clearToken();
    _token = null;
    notifyListeners();
  }
}
