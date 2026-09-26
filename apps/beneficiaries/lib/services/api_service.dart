import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/config/api_config.dart';

class ApiService {
  static String baseUrl = Config.apiBaseUrl;

  static Future<Map<String, String>> _headers() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('volunteer_token');
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  static Future<Map<String, dynamic>> get(String path,
      {Map<String, String>? queryParams, Duration timeout = const Duration(seconds: 15)}) async {
    var uri = Uri.parse('$baseUrl$path');
    if (queryParams != null) {
      uri = uri.replace(queryParameters: queryParams);
    }
    final res = await http.get(uri, headers: await _headers()).timeout(timeout);
    return _handleResponse(res);
  }

  static Future<List<dynamic>> getList(String path,
      {Map<String, String>? queryParams, Duration timeout = const Duration(seconds: 15)}) async {
    var uri = Uri.parse('$baseUrl$path');
    if (queryParams != null) {
      uri = uri.replace(queryParameters: queryParams);
    }
    final res = await http.get(uri, headers: await _headers()).timeout(timeout);
    if (res.statusCode != 200 && res.statusCode != 201) {
      throw Exception(_tryDecode(res.body)['message'] ?? 'Server error (${res.statusCode})');
    }
    return jsonDecode(res.body) as List<dynamic>;
  }

  static Future<Map<String, dynamic>> post(String path,
      {Map<String, dynamic>? body, Duration timeout = const Duration(seconds: 15)}) async {
    final res = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    ).timeout(timeout);
    return _handleResponse(res);
  }

  /// Sends a card photo (base64) to the backend which reads the details with
  /// Gemini vision and returns the fields scraped from it (name/dob/gender/
  /// address_line_1/aadhaar_number). `side` picks the extraction scope:
  /// 'front', 'back', or 'all' (default). The photo is sent once and never
  /// persisted on the device.
  static Future<Map<String, dynamic>> parseAadhaarPhoto(String base64,
      {String side = 'all'}) async {
    return post('/beneficiaries/aadhaar/parse-photo',
        body: {'image': base64, 'side': side}, timeout: const Duration(seconds: 60));
  }

  static Future<Map<String, dynamic>> patch(String path, {Map<String, dynamic>? body}) async {
    final res = await http.patch(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    ).timeout(const Duration(seconds: 15));
    return _handleResponse(res);
  }

  static Future<Map<String, dynamic>> put(String path, {Map<String, dynamic>? body}) async {
    final res = await http.put(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    ).timeout(const Duration(seconds: 15));
    return _handleResponse(res);
  }

  static Map<String, dynamic> _handleResponse(http.Response res) {
    final body = _tryDecode(res.body);
    if (res.statusCode != 200 && res.statusCode != 201) {
      final message = body['message'] ?? 'Server error (${res.statusCode})';
      final detail = body['detail'];
      throw Exception(
        detail != null && detail.toString().isNotEmpty
            ? '$message ($detail)'
            : message,
      );
    }
    return body;
  }

  /// Decode a JSON body; if the server replied with HTML (404/502 error page
  /// etc.), return an empty map so callers get a readable error instead of a
  /// `FormatException: ... <!DOCTYPE html>` crash.
  static Map<String, dynamic> _tryDecode(String raw) {
    try {
      final decoded = jsonDecode(raw);
      return decoded is Map<String, dynamic>
          ? decoded
          : (decoded is Map ? Map<String, dynamic>.from(decoded) : <String, dynamic>{});
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  static Future<void> saveToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('volunteer_token', token);
  }

  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('volunteer_token');
  }

  static Future<void> clearAuth() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('volunteer_token');
    await prefs.remove('volunteer_data');
  }

  static Future<void> saveVolunteerData(Map<String, dynamic> data) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('volunteer_data', jsonEncode(data));
  }

  static Future<Map<String, dynamic>?> getVolunteerData() async {
    final prefs = await SharedPreferences.getInstance();
    final str = prefs.getString('volunteer_data');
    if (str == null) return null;
    return jsonDecode(str);
  }

  static Future<bool> isLoggedIn() async {
    final token = await getToken();
    return token != null && token.isNotEmpty;
  }
}
