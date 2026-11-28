import 'package:shared_preferences/shared_preferences.dart';

import '../../services/backend_switcher.dart';

class Config {
  static String get bootstrapBaseUrl => BackendSwitcher.apiBaseUrl;

  static String apiBaseUrl = BackendSwitcher.apiBaseUrl;
  static String socketUrl = BackendSwitcher.socketUrl;

  static void applySelectedBackend() {
    apiBaseUrl = BackendSwitcher.apiBaseUrl;
    socketUrl = BackendSwitcher.socketUrl;
  }

  static const String appName = 'Beneficiaries';
  static const String appBrand = 'BEING SEVAK';

  /// Public Indra OCR proxy. The Node backend sends the key; the app only uses
  /// this URL for the read-only /api/status health check, so no secret is ever
  /// stored in the app binary.
  static const String ocrProxyUrl =
      'https://ucs-ocr-proxy.priyankshah-dev.workers.dev';
}
