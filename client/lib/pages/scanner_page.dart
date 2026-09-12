import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:geolocator/geolocator.dart';
import '../widgets/skeleton_loader.dart';

class ScannerPage extends StatefulWidget {
  const ScannerPage({super.key});

  @override
  State<ScannerPage> createState() => _ScannerPageState();
}

class _ScannerPageState extends State<ScannerPage>
    with SingleTickerProviderStateMixin {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  bool _detected = false;
  late final AnimationController _scanAnim;
  late final Animation<double> _scanLine;

  Position? _cachedPosition;

  @override
  void initState() {
    super.initState();
    _scanAnim = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
    _scanLine = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _scanAnim, curve: Curves.easeInOut),
    );
    _controller.addListener(_onControllerUpdate);
    _prefetchLocation();
  }

  Future<void> _prefetchLocation() async {
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      ).timeout(const Duration(seconds: 8));
      _cachedPosition = pos;
    } catch (_) {}
  }

  void _onControllerUpdate() {
    if (_controller.value.isInitialized && _controller.value.isRunning) {
      _controller.setZoomScale(0.35);
      _controller.removeListener(_onControllerUpdate);
    }
  }

  @override
  void dispose() {
    _scanAnim.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_detected || capture.barcodes.isEmpty) return;
    _detected = true;

    final raw = capture.barcodes.first.rawValue ?? '';
    Map<String, dynamic> map;
    try {
      map = Map<String, dynamic>.from(jsonDecode(raw));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Invalid QR code format')),
        );
      }
      _detected = false;
      return;
    }

    final code = map['code']?.toString();
    if (code == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Invalid QR code data')),
        );
      }
      _detected = false;
      return;
    }

    HapticFeedback.vibrate();
    await _completeWithCode(code);
  }

  Future<void> _completeWithCode(String code) async {
    Position? pos = _cachedPosition;
    if (pos == null) {
      try {
        pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
          ),
        ).timeout(const Duration(seconds: 8));
      } catch (_) {}
    }
    if (!mounted) return;
    if (pos == null) {
      _detected = false;
      _controller.start();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not get location. Make sure GPS is enabled.'),
          duration: Duration(seconds: 3),
        ),
      );
      return;
    }
    Navigator.pop(context, {
      'code': code,
      'lat': pos.latitude,
      'lng': pos.longitude,
      'punch_method': 'scan',
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            MobileScanner(
              controller: _controller,
              onDetect: _onDetect,
              placeholderBuilder: (context, child) => const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SkeletonLoader(
                      child: SkeletonBlock(width: 48, height: 48, borderRadius: 24, color: Colors.white24),
                    ),
                    SizedBox(height: 16),
                    Text('Starting camera...', style: TextStyle(color: Colors.white70)),
                  ],
                ),
              ),
              errorBuilder: (context, error, child) => const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.error_outline, color: Colors.white70, size: 48),
                      SizedBox(height: 16),
                      Text('Camera unavailable', style: TextStyle(color: Colors.white70)),
                    ],
                  ),
                ),
              ),
            ),
            Positioned.fill(child: _ScanOverlay(scanLine: _scanLine)),
            Positioned(
              top: 48,
              left: 16,
              child: GestureDetector(
                onTap: () => Navigator.pop(context),
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Icon(Icons.arrow_back, color: Colors.white, size: 22),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScanOverlay extends StatelessWidget {
  final Animation<double> scanLine;
  const _ScanOverlay({required this.scanLine});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final height = constraints.maxHeight;
        if (width <= 0 || height <= 0) return const SizedBox();

        final scanSize = width * 0.7;
        final left = (width - scanSize) / 2;
        final top = (height - scanSize) / 2;
        final scanRect = Rect.fromLTWH(left, top, scanSize, scanSize);

        return AnimatedBuilder(
          animation: scanLine,
          builder: (_, child) => CustomPaint(
            painter: _OverlayPainter(
              scanRect: scanRect,
              scanLineValue: scanLine.value,
            ),
            child: child,
          ),
          child: Column(
            children: [
              const Spacer(),
              Padding(
                padding: EdgeInsets.only(bottom: height * 0.22),
                child: const Text(
                  'Align QR code within the frame',
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    letterSpacing: 0.3,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _OverlayPainter extends CustomPainter {
  final Rect scanRect;
  final double scanLineValue;

  _OverlayPainter({required this.scanRect, this.scanLineValue = 0});

  @override
  void paint(Canvas canvas, Size size) {
    final overlayPaint = Paint()..color = Colors.black.withValues(alpha: 0.55);
    final path = Path()
      ..fillType = PathFillType.evenOdd
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height))
      ..addRRect(RRect.fromRectAndRadius(scanRect, const Radius.circular(12)));
    canvas.drawPath(path, overlayPaint);

    final lineY = scanRect.top + scanRect.height * scanLineValue;
    final linePaint = Paint()
      ..color = const Color(0xFF2563eb).withValues(alpha: 0.6)
      ..strokeWidth = 2.0;
    canvas.drawLine(
      Offset(scanRect.left + 4, lineY),
      Offset(scanRect.right - 4, lineY),
      linePaint,
    );

    final cornerPaint = Paint()
      ..color = const Color(0xFF2563eb)
      ..strokeWidth = 3.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    const cornerLen = 22.0;
    final r = scanRect;

    canvas.drawLine(r.topLeft, Offset(r.left + cornerLen, r.top), cornerPaint);
    canvas.drawLine(r.topLeft, Offset(r.left, r.top + cornerLen), cornerPaint);
    canvas.drawLine(r.topRight, Offset(r.right - cornerLen, r.top), cornerPaint);
    canvas.drawLine(r.topRight, Offset(r.right, r.top + cornerLen), cornerPaint);
    canvas.drawLine(r.bottomLeft, Offset(r.left + cornerLen, r.bottom), cornerPaint);
    canvas.drawLine(r.bottomLeft, Offset(r.left, r.bottom - cornerLen), cornerPaint);
    canvas.drawLine(r.bottomRight, Offset(r.right - cornerLen, r.bottom), cornerPaint);
    canvas.drawLine(r.bottomRight, Offset(r.right, r.bottom - cornerLen), cornerPaint);
  }

  @override
  bool shouldRepaint(covariant _OverlayPainter oldDelegate) =>
      scanRect != oldDelegate.scanRect ||
      scanLineValue != oldDelegate.scanLineValue;
}
