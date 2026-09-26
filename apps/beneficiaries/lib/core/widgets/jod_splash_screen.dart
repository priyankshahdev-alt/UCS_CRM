import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// JOD splash — the official JOD logo (assets/images/jod_splash_logo.png) is
/// revealed with a short entrance animation and then held still so the app can
/// crossfade into the login/home screen.
///
/// Timeline ~2.3s:
///   0.00   white background with a faint brand glow
///   0.20   the logo scales up from 0.82 and lifts gently into place
///   0.45   the logo fades fully in
///   0.90   a subtle "settle" pop (0.985 → 1.0) on the composition
///   1.80   a soft green growth halo breathes once behind the wordmark
///   2.30   [onFinished] fires so the parent can crossfade away
class JodSplashScreen extends StatefulWidget {
  const JodSplashScreen({super.key, required this.onFinished});

  final VoidCallback onFinished;

  @override
  State<JodSplashScreen> createState() => _JodSplashScreenState();
}

class _JodSplashScreenState extends State<JodSplashScreen>
    with SingleTickerProviderStateMixin {
  static const Duration _kTotal = Duration(milliseconds: 2300);
  static const double _kTotalSeconds = 2.3;

  late final AnimationController _controller;
  bool _notified = false;

  // Seconds → normalized 0..1 fraction of the parent controller. Interval
  // values are parent-relative, not absolute time.
  double _fx(double seconds) =>
      (seconds / _kTotalSeconds).clamp(0.0, 1.0).toDouble();

  // Fade + lift-in of the logo.
  late final Animation<double> _fade = CurvedAnimation(
    parent: _controller,
    curve: Interval(_fx(0.20), _fx(0.75), curve: Curves.easeInOut),
  );
  late final Animation<double> _scale = CurvedAnimation(
    parent: _controller,
    curve: Interval(_fx(0.20), _fx(0.80), curve: Curves.easeOutCubic),
  );
  late final Animation<double> _rise = CurvedAnimation(
    parent: _controller,
    curve: Interval(_fx(0.20), _fx(0.80), curve: Curves.easeOutCubic),
  );

  // A single soft green "growth" halo pulse behind the wordmark.
  late final Animation<double> _halo = CurvedAnimation(
    parent: _controller,
    curve: Interval(_fx(1.00), _fx(1.80), curve: Curves.easeInOut),
  );

  // 0.985 → 1.0 settle at the very end.
  late final Animation<double> _settle = CurvedAnimation(
    parent: _controller,
    curve: Interval(_fx(1.80), _fx(2.10), curve: Curves.easeOut),
  );

  static const Color _kGreen = AppColors.successGreen;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: _kTotal)
      ..addStatusListener(_onStatus)
      ..forward();
  }

  void _onStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed && !_notified) {
      _notified = true;
      widget.onFinished();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final u = (MediaQuery.of(context).size.width / 390.0).clamp(0.8, 1.35);

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final scale = (0.82 + 0.18 * _scale.value) *
            (0.985 + 0.015 * _settle.value);

        return Container(
          color: Colors.white,
          alignment: Alignment.center,
          child: Stack(
            alignment: Alignment.center,
            children: [
              // Faint brand glow behind the composition, breathing once.
              if (_halo.value > 0.001)
                Container(
                  width: 320 * u,
                  height: 320 * u,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        _kGreen.withValues(alpha: 0.10 * _halo.value),
                        _kGreen.withValues(alpha: 0),
                      ],
                    ),
                  ),
                ),
              // The JOD logo itself (raster content shipped inside the SVG).
              Opacity(
                opacity: _fade.value,
                child: Transform.translate(
                  offset: Offset(0, 20 * (1 - _rise.value) * u),
                  child: Transform.scale(
                    scale: scale,
                    child: SizedBox(
                      width: 250 * u,
                      height: 250 * u,
                      child: child,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
      child: Image.asset(
        'assets/images/jod_splash_logo.png',
        fit: BoxFit.contain,
      ),
    );
  }
}