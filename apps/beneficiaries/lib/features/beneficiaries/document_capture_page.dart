import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../core/lucide_icons.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/app_snackbar.dart';
import '../../services/scan_effect.dart';
import 'camera_capture_page.dart';

enum _DocMode { original, crop, auto }

/// Captures a document photo and lets the operator pick how to process it:
///
///  - **Original**: the untouched photo (no auto-crop).
///  - **Crop**: manual crop rectangle, then whitened like a scan.
///  - **Auto scan**: automatic edge detection + perspective straighten + whiten.
///
/// Nothing is cropped automatically — the operator chooses. Pops with
/// `{ base64, name }` where base64 is the chosen JPEG.
class DocumentCapturePage extends StatefulWidget {
  const DocumentCapturePage({super.key});

  @override
  State<DocumentCapturePage> createState() => _DocumentCapturePageState();
}

class _DocumentCapturePageState extends State<DocumentCapturePage> {
  Uint8List? _original;
  Uint8List? _autoScan;
  _DocMode _mode = _DocMode.original;
  Rect _cropRect = const Rect.fromLTRB(0.08, 0.08, 0.92, 0.92);
  bool _processing = false;
  bool _applying = false;

  Future<void> _openCamera() async {
    setState(() => _processing = true);
    try {
      final Uint8List? bytes = await Navigator.push<Uint8List>(
        context,
        MaterialPageRoute(
          builder: (_) => const CameraCapturePage(
            hint: 'Place the document on a flat surface with good lighting',
            captureLabel: 'Capture',
          ),
        ),
      );
      if (bytes == null) return;
      if (!mounted) return;
      setState(() {
        _original = bytes;
        _autoScan = null;
        _mode = _DocMode.original;
      });
    } catch (e) {
      if (!mounted) return;
      showAppSnackbar(
        context,
        'Could not open the camera: ${e.toString().replaceFirst('Exception: ', '')}',
        error: true,
      );
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  void _selectMode(_DocMode mode) {
    setState(() => _mode = mode);
    if (mode == _DocMode.auto && _autoScan == null && _original != null) {
      final bytes = _original!;
      compute(scanDocument, bytes).then((scanned) {
        if (!mounted) return;
        setState(() => _autoScan = scanned);
      }).catchError((Object _) {
        if (!mounted) return;
        showAppSnackbar(context, 'Auto scan failed — try Crop or Original', error: true);
      });
    }
  }

  List<double> _cropNorm() => [
        _cropRect.left,
        _cropRect.top,
        _cropRect.right,
        _cropRect.bottom,
      ];

  Future<void> _confirm() async {
    final original = _original;
    if (original == null || _applying) return;
    setState(() => _applying = true);
    try {
      Uint8List chosen = original;
      switch (_mode) {
        case _DocMode.original:
          break;
        case _DocMode.auto:
          chosen = _autoScan ?? await compute(scanDocument, original);
          break;
        case _DocMode.crop:
          chosen = await compute(_cropJob, <Object>[original, _cropNorm()]);
          break;
      }
      if (!mounted) return;
      Navigator.pop(context, {
        'base64': base64Encode(chosen),
        'name': 'scanned_document.jpg',
      });
    } catch (e) {
      if (!mounted) return;
      showAppSnackbar(
        context,
        'Processing failed: ${e.toString().replaceFirst('Exception: ', '')}',
        error: true,
      );
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  Future<void> _retake() async {
    setState(() {
      _original = null;
      _autoScan = null;
      _mode = _DocMode.original;
    });
    await _openCamera();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('Capture Document'),
      ),
      body: _processing
          ? const Center(
              child: SkeletonBox(
                width: 160,
                height: 12,
                borderRadius: 6,
                baseColor: Colors.white24,
                shineColor: Colors.white,
              ),
            )
          : _original == null
              ? _buildEmptyState()
              : _buildEditor(),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(LucideIcons.camera, size: 64, color: Colors.white54),
          const SizedBox(height: 20),
          const Text(
            'Place the document on a flat surface with good lighting, then capture.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white70, fontSize: 14),
          ),
          const SizedBox(height: 28),
          ElevatedButton.icon(
            onPressed: _openCamera,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.secondary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
            ),
            icon: Icon(LucideIcons.scanLine, size: 20),
            label: const Text('Capture Document'),
          ),
        ],
      ),
    );
  }

  Widget _buildImageArea(Uint8List original) {
    switch (_mode) {
      case _DocMode.original:
        return InteractiveViewer(
          child: Center(child: Image.memory(original, fit: BoxFit.contain)),
        );
      case _DocMode.crop:
        return _CropEditor(
          imageBytes: original,
          rect: _cropRect,
          onChanged: (r) => setState(() => _cropRect = r),
        );
      case _DocMode.auto:
        final scanned = _autoScan;
        if (scanned == null) {
          return const Center(
            child: CircularProgressIndicator(color: Colors.white),
          );
        }
        return InteractiveViewer(
          child: Center(child: Image.memory(scanned, fit: BoxFit.contain)),
        );
    }
  }

  Widget _buildEditor() {
    final original = _original!;
    return SafeArea(
      child: Column(
        children: [
          Expanded(child: _buildImageArea(original)),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
            child: SegmentedButton<_DocMode>(
              segments: const [
                ButtonSegment(
                  value: _DocMode.original,
                  label: Text('Original'),
                  icon: Icon(Icons.photo_outlined, size: 18),
                ),
                ButtonSegment(
                  value: _DocMode.crop,
                  label: Text('Crop'),
                  icon: Icon(Icons.crop, size: 18),
                ),
                ButtonSegment(
                  value: _DocMode.auto,
                  label: Text('Auto scan'),
                  icon: Icon(Icons.auto_fix_high, size: 18),
                ),
              ],
              selected: {_mode},
              onSelectionChanged: (s) => _selectMode(s.first),
              showSelectedIcon: false,
              style: ButtonStyle(
                backgroundColor: WidgetStateProperty.resolveWith(
                  (states) =>
                      states.contains(WidgetState.selected)
                          ? AppTheme.secondary
                          : Colors.white12,
                ),
                foregroundColor: WidgetStateProperty.all(Colors.white),
                side: WidgetStateProperty.all(
                  const BorderSide(color: Colors.white24),
                ),
                shape: WidgetStateProperty.all(
                  RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                padding: WidgetStateProperty.all(
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                ),
              ),
            ),
          ),
          if (_mode == _DocMode.crop)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                'Drag to move the frame, pull the corners to resize.',
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: Row(
              children: [
                const Expanded(child: SizedBox()),
                OutlinedButton.icon(
                  onPressed: _applying ? null : _retake,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: Colors.white54),
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                  ),
                  icon: const Icon(LucideIcons.refreshCw, size: 18),
                  label: const Text('Retake'),
                ),
                const SizedBox(width: 12),
                ElevatedButton.icon(
                  onPressed: _applying ? null : _confirm,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.secondary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                  ),
                  icon: _applying
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(LucideIcons.check, size: 18),
                  label: Text(_applying ? 'Processing…' : 'Use photo'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Computes the cropped + whitened result for the [cropJob] compute() call.
Uint8List _cropJob(Object message) {
  final args = message as List<Object?>;
  return cropAndWhiten(args[0] as Uint8List, (args[1] as List).cast<double>());
}

/// Interactive manual-crop editor. The image is laid out to exactly fill a box
/// that matches its aspect ratio (no letterbox), so the on-screen rect maps 1:1
/// onto normalized image coordinates. Drag inside to move, drag a corner handle
/// to resize. Reports changes via [onChanged] as a normalized Rect (0..1).
class _CropEditor extends StatefulWidget {
  const _CropEditor({
    required this.imageBytes,
    required this.rect,
    required this.onChanged,
  });

  final Uint8List imageBytes;
  final Rect rect;
  final ValueChanged<Rect> onChanged;

  @override
  State<_CropEditor> createState() => _CropEditorState();
}

class _CropEditorState extends State<_CropEditor> {
  static const double _handleRadius = 12;
  static const double _minNorm = 0.05;

  ui.Size? _imgSize;
  bool _decodingSize = false;

  // Drag state (all in full-area coordinates).
  _DragTarget? _drag;
  Rect _dragStartRect = Rect.zero;
  Offset _dragStartPos = Offset.zero;

  @override
  void initState() {
    super.initState();
    _measure();
  }

  Future<void> _measure() async {
    if (_imgSize != null || _decodingSize) return;
    _decodingSize = true;
    try {
      final codec = await ui.instantiateImageCodec(widget.imageBytes);
      final frame = await codec.getNextFrame();
      final size = ui.Size(
        frame.image.width.toDouble(),
        frame.image.height.toDouble(),
      );
      frame.image.dispose();
      codec.dispose();
      if (!mounted) return;
      setState(() => _imgSize = size);
    } catch (_) {
      if (!mounted) return;
      setState(() {});
    } finally {
      _decodingSize = false;
    }
  }

  void _emit(Rect norm) {
    if (norm == widget.rect) return;
    widget.onChanged(norm);
  }

  void _onPanStart(DragStartDetails d, Rect frame, Offset origin) {
    final pos = d.localPosition;
    final disp = _toDisplay(widget.rect, frame, origin);
    final target = _hitTarget(pos, disp);
    _drag = target;
    _dragStartRect = disp;
    _dragStartPos = pos;
  }

  void _onPanUpdate(DragUpdateDetails d, Rect frame, Offset origin) {
    final target = _drag;
    if (target == null) return;
    final delta = d.localPosition - _dragStartPos;
    final newDisp = _applyDrag(target, _dragStartRect, delta, frame);
    _emit(_toNorm(newDisp, frame, origin));
  }

  void _onPanEnd(DragEndDetails d) {
    _drag = null;
  }

  Rect _toDisplay(Rect norm, Rect frame, Offset origin) {
    return Rect.fromLTRB(
      origin.dx + norm.left * frame.width,
      origin.dy + norm.top * frame.height,
      origin.dx + norm.right * frame.width,
      origin.dy + norm.bottom * frame.height,
    );
  }

  Rect _toNorm(Rect disp, Rect frame, Offset origin) {
    final left = ((disp.left - origin.dx) / frame.width).clamp(0.0, 1.0).toDouble();
    final top = ((disp.top - origin.dy) / frame.height).clamp(0.0, 1.0).toDouble();
    final right = ((disp.right - origin.dx) / frame.width).clamp(0.0, 1.0).toDouble();
    final bottom = ((disp.bottom - origin.dy) / frame.height).clamp(0.0, 1.0).toDouble();
    return Rect.fromLTRB(left, top, right, bottom);
  }

  _DragTarget _hitTarget(Offset pos, Rect disp) {
    if ((pos - disp.topLeft).distance <= _handleRadius) return _DragTarget.topLeft;
    if ((pos - disp.topRight).distance <= _handleRadius) return _DragTarget.topRight;
    if ((pos - disp.bottomLeft).distance <= _handleRadius) return _DragTarget.bottomLeft;
    if ((pos - disp.bottomRight).distance <= _handleRadius) return _DragTarget.bottomRight;
    if (disp.contains(pos)) return _DragTarget.move;
    return _DragTarget.none;
  }

  Rect _applyDrag(_DragTarget target, Rect start, Offset delta, Rect frame) {
    final minW = _minNorm * frame.width;
    final minH = _minNorm * frame.height;
    double numClamp(double v, double lo, double hi) =>
        v.clamp(lo, hi).toDouble();
    switch (target) {
      case _DragTarget.topLeft:
        return Rect.fromLTRB(
          numClamp(start.left + delta.dx, frame.left, start.right - minW),
          numClamp(start.top + delta.dy, frame.top, start.bottom - minH),
          start.right,
          start.bottom,
        );
      case _DragTarget.topRight:
        return Rect.fromLTRB(
          start.left,
          numClamp(start.top + delta.dy, frame.top, start.bottom - minH),
          numClamp(start.right + delta.dx, start.left + minW, frame.right),
          start.bottom,
        );
      case _DragTarget.bottomLeft:
        return Rect.fromLTRB(
          numClamp(start.left + delta.dx, frame.left, start.right - minW),
          start.top,
          start.right,
          numClamp(start.bottom + delta.dy, start.top + minH, frame.bottom),
        );
      case _DragTarget.bottomRight:
        return Rect.fromLTRB(
          start.left,
          start.top,
          numClamp(start.right + delta.dx, start.left + minW, frame.right),
          numClamp(start.bottom + delta.dy, start.top + minH, frame.bottom),
        );
      case _DragTarget.move:
        return Rect.fromLTWH(
          numClamp(start.left + delta.dx, frame.left, frame.right - start.width),
          numClamp(start.top + delta.dy, frame.top, frame.bottom - start.height),
          start.width,
          start.height,
        );
      case _DragTarget.none:
        return start;
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = _imgSize;
    if (size == null) {
      return const Center(
        child: CircularProgressIndicator(color: Colors.white),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final area = Size(constraints.maxWidth, constraints.maxHeight);
        final scale = size.width > 0 && size.height > 0
            ? (area.width / size.width < area.height / size.height
                ? area.width / size.width
                : area.height / size.height)
            : 1.0;
        final box = Size(size.width * scale, size.height * scale);
        final origin = Offset(
          (area.width - box.width) / 2,
          (area.height - box.height) / 2,
        );
        final frame = Rect.fromLTWH(origin.dx, origin.dy, box.width, box.height);
        final disp = _toDisplay(widget.rect, frame, origin);

        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onPanStart: (d) => _onPanStart(d, frame, origin),
          onPanUpdate: (d) => _onPanUpdate(d, frame, origin),
          onPanEnd: _onPanEnd,
          child: Stack(
            children: [
              Positioned.fromRect(
                rect: frame,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: Image.memory(
                    widget.imageBytes,
                    fit: BoxFit.fill,
                    gaplessPlayback: true,
                  ),
                ),
              ),
              Positioned.fill(
                child: CustomPaint(
                  painter: _CropOverlayPainter(
                    rect: disp,
                    handleRadius: _handleRadius,
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

enum _DragTarget { move, topLeft, topRight, bottomLeft, bottomRight, none }

class _CropOverlayPainter extends CustomPainter {
  _CropOverlayPainter({required this.rect, required this.handleRadius});

  final Rect rect;
  final double handleRadius;

  @override
  void paint(Canvas canvas, Size size) {
    final mask = Paint()..color = const Color(0x99000000);
    // Dim everything outside the crop rect.
    canvas.drawRect(Rect.fromLTRB(0, 0, size.width, rect.top), mask);
    canvas.drawRect(Rect.fromLTRB(0, rect.bottom, size.width, size.height), mask);
    canvas.drawRect(Rect.fromLTRB(0, rect.top, rect.left, rect.bottom), mask);
    canvas.drawRect(Rect.fromLTRB(rect.right, rect.top, size.width, rect.bottom), mask);

    final border = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = Colors.white;
    canvas.drawRect(rect, border);

    final handleFill = Paint()..color = AppTheme.secondary;
    final handleOutline = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = Colors.white;
    for (final corner in [
      rect.topLeft,
      rect.topRight,
      rect.bottomLeft,
      rect.bottomRight,
    ]) {
      canvas.drawCircle(corner, handleRadius, handleOutline);
      canvas.drawCircle(corner, handleRadius - 3, handleFill);
    }
  }

  @override
  bool shouldRepaint(covariant _CropOverlayPainter oldDelegate) =>
      oldDelegate.rect != rect || oldDelegate.handleRadius != handleRadius;
}