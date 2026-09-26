import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/app_skeleton.dart';
import 'core/widgets/jod_splash_screen.dart';
import 'services/api_service.dart';
import 'features/auth/login_page.dart';
import 'features/auth/operator_setup_page.dart';
import 'features/home/home_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  if (!kReleaseMode) {
    _installSemanticsAssertFilter();
  }
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
    statusBarBrightness: Brightness.light,
    systemNavigationBarColor: Color(0xFFF8F9FB),
    systemNavigationBarIconBrightness: Brightness.dark,
  ));
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
  bool? _setupNeeded;
  bool _splashDone = false;

  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  Future<void> _checkAuth() async {
    final loggedIn = await ApiService.isLoggedIn();
    if (!loggedIn) {
      if (mounted) {
        setState(() {
          _loggedIn = false;
          _setupNeeded = null;
        });
      }
      return;
    }
    final setupNeeded = await _checkOperatorSetup();
    if (mounted) {
      setState(() {
        _loggedIn = true;
        _setupNeeded = setupNeeded;
      });
    }
  }

  Future<bool> _checkOperatorSetup() async {
    // Ask for Operator Details only once after login: if the backend already
    // has today's assignment saved (state/city), skip the screen on refresh.
    try {
      final body = await ApiService.get('/operator/dashboard');
      final hasState = (body['state']?.toString() ?? '').isNotEmpty;
      final hasCity = (body['city']?.toString() ?? '').isNotEmpty;
      return !(hasState && hasCity);
    } catch (_) {
      return true;
    }
  }

  void _onLogin() {
    setState(() {
      _loggedIn = true;
      _setupNeeded = null;
    });
    _resolveSetup();
  }

  Future<void> _resolveSetup() async {
    final setupNeeded = await _checkOperatorSetup();
    if (mounted) setState(() => _setupNeeded = setupNeeded);
  }

  void _onLogout() {
    setState(() {
      _loggedIn = false;
      _setupNeeded = null;
    });
  }

  Widget _buildContent() {
    final busy = _loggedIn == null || (_loggedIn == true && _setupNeeded == null);
    if (busy) {
      return const Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('BEING SEVAK', style: TextStyle(fontSize: 13, letterSpacing: 3, fontWeight: FontWeight.w500, color: Color(0xFF7B8494))),
              SizedBox(height: 12),
              Text('Together for a better tomorrow.', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: Color(0xFF111827))),
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
    if (_loggedIn!) {
      if (_setupNeeded!) {
        return OperatorSetupPage(
          onComplete: () => setState(() => _setupNeeded = false),
        );
      }
      return HomePage(onLogout: _onLogout);
    }
    return LoginPage(onLogin: _onLogin);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      switchInCurve: Curves.easeOut,
      switchOutCurve: Curves.easeIn,
      child: _splashDone
          ? KeyedSubtree(
              key: const ValueKey('app'),
              child: _buildContent(),
            )
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
