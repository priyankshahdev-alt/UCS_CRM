import 'dart:convert';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../services/api_service.dart';
import '../services/image_overlay_helper.dart';
import '../services/location_service.dart';

class PunchPage extends StatefulWidget {
  final Map<String, dynamic> worker;
  final String action; // 'punch_in' | 'punch_out' | 'done'

  const PunchPage({
    super.key,
    required this.worker,
    required this.action,
  });

  @override
  State<PunchPage> createState() => _PunchPageState();
}

class _PunchPageState extends State<PunchPage> {
  bool _locating = true;
  double? _lat;
  double? _lng;
  String? _placeName;
  File? _selfie;
  bool _submitting = false;
  String? _localError;

  @override
  void initState() {
    super.initState();
    _resolveLocation();
  }

  Future<void> _resolveLocation() async {
    final pos = await LocationService.getCurrentLocation();

    if (!mounted) return;

    String? place;

    if (pos != null) {
      place = await LocationService.getPlaceName(
        pos.latitude,
        pos.longitude,
      );
    }

    if (!mounted) return;

    setState(() {
      _lat = pos?.latitude;
      _lng = pos?.longitude;
      _placeName = place;
      _locating = false;
      _localError = pos == null
          ? 'Could not determine location. Enable GPS or connect to WiFi.'
          : null;
    });
  }

  Future<void> _captureSelfie() async {
    try {
      final cameras = await availableCameras();

      if (cameras.isEmpty) {
        _snack('No camera available');
        return;
      }

      final camera = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );

      final controller = CameraController(
        camera,
        ResolutionPreset.medium,
        enableAudio: false,
      );

      await controller.initialize();

      if (!mounted) {
        await controller.dispose();
        return;
      }

      final file = await Navigator.of(context).push<File>(
        MaterialPageRoute(
          fullscreenDialog: true,
          builder: (_) => _SelfieCapture(
            controller: controller,
          ),
        ),
      );

      await controller.dispose();

      if (!mounted) return;

      if (file != null) {
        setState(() => _selfie = file);
      }
    } catch (_) {
      _snack('Could not open camera');
    }
  }

  Future<void> _submit() async {
    if (_selfie == null) {
      _snack('Capture a selfie first');
      return;
    }

    if (_lat == null || _lng == null) {
      _snack('Location not available. Please retry.');
      return;
    }

    setState(() => _submitting = true);

    try {
      final dateTime = DateFormat(
        'dd MMM yyyy, hh:mm a',
      ).format(DateTime.now());

      final place = _placeName ?? 'Unknown location';

      final coords =
          '${_lat!.toStringAsFixed(6)}, ${_lng!.toStringAsFixed(6)}';

      final stampedFile = await SelfieStamp.apply(
        source: _selfie!,
        dateTime: dateTime,
        place: place,
        coordinates: coords,
      );

      final fileToSend = stampedFile ?? _selfie!;

      final bytes = await fileToSend.readAsBytes();
      final base64Selfie = base64Encode(bytes);

      await ApiService.hrSelfiePunch(
        workerId: (widget.worker['id'] ?? '').toString(),
        type: widget.action,
        selfieBase64: base64Selfie,
        mimeType: 'image/jpeg',
        latitude: _lat!,
        longitude: _lng!,
      );

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            widget.action == 'punch_in'
                ? 'Punch-in recorded'
                : 'Punch-out recorded',
          ),
          backgroundColor: const Color(0xFF16A34A),
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.all(16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      );

      Navigator.of(context).pop();
    } catch (e) {
      _snack(e.toString());
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  void _snack(String msg) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: const Color(0xFFDC2626),
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final name = (widget.worker['name'] ?? 'Unknown').toString();
    final loginId = (widget.worker['login_id'] ?? '').toString();

    final bool isPunchIn = widget.action == 'punch_in';

    final actionLabel = isPunchIn ? 'Punch In' : 'Punch Out';

    final initial = name.trim().isEmpty
        ? '?'
        : name.trim()[0].toUpperCase();

    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF7F8FA),
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        titleSpacing: 20,
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.arrow_back_rounded),
          color: const Color(0xFF111827),
        ),
        title: Text(
          actionLabel,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            color: Color(0xFF111827),
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: isPunchIn
                    ? const Color(0xFFEFF6FF)
                    : const Color(0xFFF0FDF4),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isPunchIn
                      ? const Color(0xFFDBEAFE)
                      : const Color(0xFFDCFCE7),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: isPunchIn
                          ? const Color(0xFF2563EB)
                          : const Color(0xFF16A34A),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Icon(
                      isPunchIn
                          ? Icons.login_rounded
                          : Icons.logout_rounded,
                      color: Colors.white,
                      size: 24,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isPunchIn
                              ? 'Ready to punch in'
                              : 'Ready to punch out',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: isPunchIn
                                ? const Color(0xFF1D4ED8)
                                : const Color(0xFF15803D),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          isPunchIn
                              ? 'Capture a selfie to record attendance'
                              : 'Capture a selfie to complete attendance',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Color(0xFF6B7280),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),

            _SectionCard(
              child: Row(
                children: [
                  Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      color: const Color(0xFFEFF4FF),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Center(
                      child: Text(
                        initial,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF2563EB),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'EMPLOYEE',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.8,
                            color: Color(0xFF9CA3AF),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF111827),
                          ),
                        ),
                        if (loginId.isNotEmpty) ...[
                          const SizedBox(height: 3),
                          Text(
                            loginId,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF6B7280),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),

            _SectionCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          color: _lat == null
                              ? const Color(0xFFFEF2F2)
                              : const Color(0xFFF0FDF4),
                          borderRadius: BorderRadius.circular(13),
                        ),
                        child: Icon(
                          _lat == null
                              ? Icons.location_off_rounded
                              : Icons.location_on_rounded,
                          color: _lat == null
                              ? const Color(0xFFDC2626)
                              : const Color(0xFF16A34A),
                          size: 22,
                        ),
                      ),
                      const SizedBox(width: 12),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Location',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF111827),
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'Required for geo-tagged attendance',
                              style: TextStyle(
                                fontSize: 11,
                                color: Color(0xFF9CA3AF),
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: _resolveLocation,
                        tooltip: 'Refresh location',
                        icon: const Icon(
                          Icons.refresh_rounded,
                          size: 20,
                        ),
                        color: const Color(0xFF6B7280),
                      ),
                    ],
                  ),

                  const SizedBox(height: 14),

                  Container(
                    padding: const EdgeInsets.all(13),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF9FAFB),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: _locating
                        ? const Row(
                            children: [
                              SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Color(0xFF2563EB),
                                ),
                              ),
                              SizedBox(width: 10),
                              Text(
                                'Resolving your location...',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF6B7280),
                                ),
                              ),
                            ],
                          )
                        : _lat != null
                            ? Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment.start,
                                children: [
                                  if (_placeName != null &&
                                      _placeName!.isNotEmpty) ...[
                                    Text(
                                      _placeName!,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                        color: Color(0xFF374151),
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                  ],
                                  Row(
                                    children: [
                                      const Icon(
                                        Icons.gps_fixed_rounded,
                                        size: 14,
                                        color: Color(0xFF16A34A),
                                      ),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: Text(
                                          '${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}',
                                          style: const TextStyle(
                                            fontSize: 11,
                                            color: Color(0xFF6B7280),
                                          ),
                                        ),
                                      ),
                                      const Text(
                                        'GPS READY',
                                        style: TextStyle(
                                          fontSize: 9,
                                          fontWeight: FontWeight.w700,
                                          letterSpacing: 0.5,
                                          color: Color(0xFF16A34A),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              )
                            : Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Icon(
                                    Icons.warning_amber_rounded,
                                    size: 18,
                                    color: Color(0xFFDC2626),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      _localError ??
                                          'Location unavailable',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        height: 1.4,
                                        color: Color(0xFFDC2626),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),

            _SectionCard(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.camera_alt_outlined,
                        size: 20,
                        color: Color(0xFF374151),
                      ),
                      const SizedBox(width: 8),
                      const Expanded(
                        child: Text(
                          'Attendance Selfie',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF111827),
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF3F4F6),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          _selfie == null ? 'REQUIRED' : 'CAPTURED',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.4,
                            color: _selfie == null
                                ? const Color(0xFF6B7280)
                                : const Color(0xFF16A34A),
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 14),

                  if (_selfie != null)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(16),
                      child: AspectRatio(
                        aspectRatio: 4 / 3,
                        child: Image.file(
                          _selfie!,
                          fit: BoxFit.cover,
                        ),
                      ),
                    )
                  else
                    Container(
                      height: 210,
                      decoration: BoxDecoration(
                        color: const Color(0xFFF3F4F6),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: const Color(0xFFE5E7EB),
                        ),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Container(
                            width: 58,
                            height: 58,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: const Icon(
                              Icons.camera_alt_outlined,
                              size: 28,
                              color: Color(0xFF9CA3AF),
                            ),
                          ),
                          const SizedBox(height: 12),
                          const Text(
                            'No selfie captured',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: Color(0xFF6B7280),
                            ),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Take a clear selfie to continue',
                            style: TextStyle(
                              fontSize: 11,
                              color: Color(0xFF9CA3AF),
                            ),
                          ),
                        ],
                      ),
                    ),

                  const SizedBox(height: 14),

                  SizedBox(
                    height: 48,
                    child: OutlinedButton.icon(
                      onPressed: _captureSelfie,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF2563EB),
                        side: const BorderSide(
                          color: Color(0xFFBFDBFE),
                        ),
                        backgroundColor: const Color(0xFFEFF6FF),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(13),
                        ),
                      ),
                      icon: const Icon(
                        Icons.camera_alt_rounded,
                        size: 20,
                      ),
                      label: Text(
                        _selfie == null
                            ? 'Capture Selfie'
                            : 'Retake Selfie',
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            SizedBox(
              height: 54,
              child: FilledButton(
                onPressed: _submitting ? null : _submit,
                style: FilledButton.styleFrom(
                  backgroundColor: isPunchIn
                      ? const Color(0xFF2563EB)
                      : const Color(0xFF16A34A),
                  disabledBackgroundColor: const Color(0xFF9CA3AF),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: _submitting
                    ? const SizedBox(
                        width: 21,
                        height: 21,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: Colors.white,
                        ),
                      )
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            isPunchIn
                                ? Icons.login_rounded
                                : Icons.logout_rounded,
                            size: 19,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'Submit $actionLabel',
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
              ),
            ),

            const SizedBox(height: 12),

            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.verified_user_outlined,
                  size: 14,
                  color: Color(0xFF9CA3AF),
                ),
                SizedBox(width: 5),
                Text(
                  'Selfie + location are securely recorded',
                  style: TextStyle(
                    fontSize: 10.5,
                    color: Color(0xFF9CA3AF),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;

  const _SectionCard({
    required this.child,
    this.padding = const EdgeInsets.all(18),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFE5E7EB),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.025),
            blurRadius: 14,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _SelfieCapture extends StatefulWidget {
  final CameraController controller;

  const _SelfieCapture({
    required this.controller,
  });

  @override
  State<_SelfieCapture> createState() => _SelfieCaptureState();
}

class _SelfieCaptureState extends State<_SelfieCapture> {
  bool _taking = false;

  Future<void> _take() async {
    if (_taking) return;

    setState(() => _taking = true);

    try {
      final file = await widget.controller.takePicture();

      if (mounted) {
        Navigator.of(context).pop(File(file.path));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to capture selfie'),
          ),
        );

        Navigator.of(context).pop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          Center(
            child: CameraPreview(widget.controller),
          ),

          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: 150,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.black.withOpacity(0.65),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ),

          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            height: 230,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.bottomCenter,
                    end: Alignment.topCenter,
                    colors: [
                      Colors.black.withOpacity(0.8),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ),

          Positioned(
            top: 48,
            left: 18,
            right: 18,
            child: Row(
              children: [
                GestureDetector(
                  onTap: () => Navigator.of(context).pop(),
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.45),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: Colors.white.withOpacity(0.15),
                      ),
                    ),
                    child: const Icon(
                      Icons.arrow_back_rounded,
                      color: Colors.white,
                      size: 22,
                    ),
                  ),
                ),

                const Expanded(
                  child: Center(
                    child: Text(
                      'Take Selfie',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),

                const SizedBox(
                  width: 44,
                  height: 44,
                ),
              ],
            ),
          ),

          Center(
            child: IgnorePointer(
              child: Container(
                width: 235,
                height: 310,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(120),
                  border: Border.all(
                    color: Colors.white.withOpacity(0.75),
                    width: 2,
                  ),
                ),
              ),
            ),
          ),

          Positioned(
            bottom: 155,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.45),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  'Position your face inside the frame',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                  ),
                ),
              ),
            ),
          ),

          Positioned(
            bottom: 42,
            left: 0,
            right: 0,
            child: Center(
              child: GestureDetector(
                onTap: _take,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 120),
                  width: 82,
                  height: 82,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: Colors.white.withOpacity(0.45),
                      width: 5,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.35),
                        blurRadius: 15,
                        offset: const Offset(0, 5),
                      ),
                    ],
                  ),
                  padding: const EdgeInsets.all(5),
                  child: Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: const Color(0xFF111827),
                        width: 2.5,
                      ),
                    ),
                    child: _taking
                        ? const Padding(
                            padding: EdgeInsets.all(18),
                            child: CircularProgressIndicator(
                              color: Color(0xFF2563EB),
                              strokeWidth: 3,
                            ),
                          )
                        : const Icon(
                            Icons.camera_alt_rounded,
                            color: Color(0xFF111827),
                            size: 29,
                          ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}