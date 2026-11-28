import 'package:shared_preferences/shared_preferences.dart';

class BackendSwitcher {
  static const List<Map<String, String>> options = [
    {
      'id': 'tunnel',
      'label': 'Tunnel (ngrok - works on any network)',
      'url': 'https://win-13itdvn82hk.tail703dea.ts.net',
    },
    {
      'id': 'local',
      'label': 'Main server (same WiFi only)',
      'url': 'http://192.168.1.100:5000',
    },
  ];

  static const String defaultId = 'tunnel';
  static const String prefsKey = 'app_backend_url';

  static String _url = _urlFor(defaultId);

  static String _urlFor(String id) {
    for (final o in options) {
      if (o['id'] == id) return o['url']!;
    }
    return options.first['url']!;
  }

  static String get baseUrl => _url;

  static String get apiBaseUrl => _url.endsWith('/api') ? _url : '$_url/api';

  static String get socketUrl =>
      _url.endsWith('/api') ? _url.substring(0, _url.length - 4) : _url;

  static String get currentId {
    for (final o in options) {
      if (o['url'] == _url) return o['id']!;
    }
    return 'custom';
  }

  static Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(prefsKey);
      if (saved != null && saved.isNotEmpty) _url = saved;
    } catch (_) {}
  }

  static Future<void> set(String idOrUrl) async {
    _url = idOrUrl.startsWith('http') ? idOrUrl : _urlFor(idOrUrl);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(prefsKey, _url);
    } catch (_) {}
  }
}
