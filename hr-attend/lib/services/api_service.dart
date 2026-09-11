import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';

class ApiService {
  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('hr_token');
  }

  static Future<void> saveToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('hr_token', token);
  }

  static Future<void> clearToken() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('hr_token');
  }

  static Future<Map<String, dynamic>> getWorkerData() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('hr_worker');
    if (raw == null) return {};
    return Map<String, dynamic>.from(jsonDecode(raw) as Map);
  }

  static Future<void> saveWorkerData(Map<String, dynamic> data) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('hr_worker', jsonEncode(data));
  }

  static Future<Map<String, String>> _headers() async {
    final token = await getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  static Future<http.Response> _post(Uri uri, {Map<String, String>? headers, String? body}) async {
    return http.post(uri, headers: headers, body: body).timeout(const Duration(seconds: 20));
  }

  static Future<http.Response> _get(Uri uri, {Map<String, String>? headers}) async {
    return http.get(uri, headers: headers).timeout(const Duration(seconds: 20));
  }

  static Map<String, dynamic> _decode(http.Response res) {
    final body = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body);
    return body is Map<String, dynamic> ? body : <String, dynamic>{};
  }

  static Future<Map<String, dynamic>> login(String identifier, String password) async {
    final res = await _post(
      Uri.parse('${Config.apiBaseUrl}/auth/worker/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'identifier': identifier, 'password': password}),
    );
    final data = _decode(res);
    if (res.statusCode != 200) {
      throw Exception(data['message'] ?? 'Login failed');
    }
    final token = data['token'];
    if (token == null) {
      throw Exception('No token returned');
    }
    await saveToken(token.toString());
    final user = data['user'];
    if (user is Map<String, dynamic>) {
      user['role'] = data['role'];
      await saveWorkerData(user);
    }
    return data;
  }

  static Future<List<dynamic>> getAllWorkers() async {
    final res = await _get(
      Uri.parse('${Config.apiBaseUrl}/workers?scope=all'),
      headers: await _headers(),
    );
    if (res.statusCode != 200) {
      throw Exception(_decode(res)['message'] ?? 'Failed to load workers');
    }
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    return body is List ? body : <dynamic>[];
  }

  static Future<dynamic> getTodayAll() async {
    final res = await _get(
      Uri.parse('${Config.apiBaseUrl}/attendance/today-all'),
      headers: await _headers(),
    );
    if (res.statusCode != 200) {
      throw Exception(_decode(res)['message'] ?? 'Failed to load today status');
    }
    final body = res.body.isEmpty ? null : jsonDecode(res.body);
    return body is List ? body : <dynamic>[];
  }

  static Future<Map<String, dynamic>> hrSelfiePunch({
    required String workerId,
    required String type,
    required String selfieBase64,
    required String mimeType,
    required double latitude,
    required double longitude,
  }) async {
    final res = await _post(
      Uri.parse('${Config.apiBaseUrl}/attendance/hr-selfie-punch'),
      headers: await _headers(),
      body: jsonEncode({
        'worker_id': workerId,
        'type': type,
        'selfie_base64': selfieBase64,
        'mime_type': mimeType,
        'latitude': latitude,
        'longitude': longitude,
      }),
    );
    final data = _decode(res);
    if (res.statusCode != 200 && res.statusCode != 201) {
      throw Exception(data['message'] ?? 'Punch failed');
    }
    return data;
  }
}
