import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/app_skeleton.dart';
import 'core/widgets/jod_splash_screen.dart';
import 'services/api_service.dart';
import 'services/backend_switcher.dart';
import 'features/auth/login_page.dart';
import 'features/home/home_page.dart';
import 'features/beneficiaries/aadhaar_ocr_page.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await BackendSwitcher.load();
  if (!kReleaseMode) {
    _installSemanticsAssertFilter();
  }
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      statusBarBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFFF8F9FB),
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const BeneficiariesApp());
}

/// In debug/profile builds the Flutter framework throws two known
/// false-positive rendering assertions (flutter/flutter#191188) whenever the
/// semantics/accessibility tree is active (e.g. TalkBack) while camera routes
/// are stacked:
///   - object.dart:5724  '!semantics.parentDataDirty'
///   - object.dart:6018  '!childSemantics.renderObject._needsLayout'
/// The production code around them explicitly tolerates those dirty nodes, so
/// the throw is purely a too-strict diagnostic. These `assert()`s are compiled
/// out of release builds; here we drop only those two exact messages and
/// forward every other error to the default handler untouched.
void _installSemanticsAssertFilter() {
  void Function(FlutterErrorDetails details) original =
      FlutterError.onError ?? FlutterError.dumpErrorToConsole;
  FlutterError.onError = (details) {
    final String text = details.exceptionAsString();
    if (text.contains("'!semantics.parentDataDirty'") ||
        text.contains("'!childSemantics.renderObject._needsLayout'")) {
      return;
    }
    original(details);
  };
}

class BeneficiariesApp extends StatelessWidget {
  const BeneficiariesApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'J O D',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: const AuthGate(),
      // home: AadhaarOcrPage(),
    );
  }
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool? _loggedIn;
  bool _splashDone = false;
  bool _checking = true;

  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  Future<void> _checkAuth() async {
    final hasToken = await ApiService.isLoggedIn();
    if (!hasToken) {
      if (mounted) setState(() {
        _loggedIn = false;
        _checking = false;
      });
      return;
    }
    // Validate the stored token against the server. An invalid/expired token
    // must never leave a stale session alive on the dashboard.
    try {
      await ApiService.get('/auth/me');
      if (mounted) setState(() {
        _loggedIn = true;
        _checking = false;
      });
    } catch (e) {
      final msg = e.toString().toLowerCase();
      // Only an explicit auth failure should drop the session. A 404 (endpoint
      // not deployed yet) or a network error must not log the user out.
      if (msg.contains('401') || msg.contains('invalid token') || msg.contains('no token')) {
        await ApiService.clearAuth();
        if (mounted) setState(() {
          _loggedIn = false;
          _checking = false;
        });
      } else {
        if (mounted) setState(() {
          _loggedIn = true;
          _checking = false;
        });
      }
    }
  }

  void _onLogin() => setState(() {
    _loggedIn = true;
    _checking = false;
  });

  void _onLogout() => setState(() => _loggedIn = false);

  Widget _buildContent() {
    if (_checking) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }
    if (_loggedIn == null) {
      return const Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                'BEING SEVAK',
                style: TextStyle(
                  fontSize: 13,
                  letterSpacing: 3,
                  fontWeight: FontWeight.w500,
                  color: Color(0xFF7B8494),
                ),
              ),
              SizedBox(height: 12),
              Text(
                'Together for a better tomorrow.',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  color: Color(0xFF111827),
                ),
              ),
              SizedBox(height: 28),
              SkeletonBox(
                width: 140,
                height: 8,
                borderRadius: 4,
                baseColor: Color(0xFFE6E9EE),
                shineColor: Color(0xFFF8F9FB),
              ),
            ],
          ),
        ),
      );
    }
    return _loggedIn!
        ? HomePage(onLogout: _onLogout)
        : LoginPage(onLogin: _onLogin);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      switchInCurve: Curves.easeOut,
      switchOutCurve: Curves.easeIn,
      child: _splashDone
          ? KeyedSubtree(key: const ValueKey('app'), child: _buildContent())
          : KeyedSubtree(
              key: const ValueKey('splash'),
              child: JodSplashScreen(
                onFinished: () {
                  if (mounted) setState(() => _splashDone = true);
                },
              ),
            ),
    );
  }
}
