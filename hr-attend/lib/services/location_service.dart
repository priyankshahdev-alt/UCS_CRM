import 'dart:async';
import 'dart:convert';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import '../config.dart';

/// Resolves the current device location using GPS only,
/// and reverse geocodes via Geoapify.
class LocationService {
  static Future<Position?> getCurrentLocation({Duration timeout = const Duration(seconds: 15)}) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
        if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return null;
      } else if (perm == LocationPermission.deniedForever) {
        return null;
      }
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(timeout);
    } catch (_) {
      return null;
    }
  }

  /// Reverse geocodes [lat]/[lng] into a full address via Geoapify.
  static Future<String?> getPlaceName(double lat, double lng,
      {Duration timeout = const Duration(seconds: 10)}) async {
    try {
      final uri = Uri.parse(
        'https://api.geoapify.com/v1/geocode/reverse'
        '?lat=$lat&lon=$lng&apiKey=${Config.geoapifyKey}&format=json',
      );
      final res = await http.get(uri).timeout(timeout);
      if (res.statusCode != 200) return null;
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final results = (data['results'] as List?) ?? [];
      if (results.isEmpty) return null;
      final first = results.first as Map<String, dynamic>;
      return first['formatted'] as String?;
    } catch (_) {
      return null;
    }
  }
}