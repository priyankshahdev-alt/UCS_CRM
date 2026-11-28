import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../services/api_service.dart';

/// One line of text Indra found, with its box in original-photo pixels.
class ScanTextLine {
  final int index;
  final String text;
  final Rect box;
  final double? confidence;

  const ScanTextLine({
    required this.index,
    required this.text,
    required this.box,
    this.confidence,
  });

  static ScanTextLine? tryParse(dynamic raw) {
    if (raw is! Map) return null;
    final text = (raw['text'] ?? '').toString().trim();
    if (text.isEmpty) return null;

    final rawBox = raw['box'];
    if (rawBox is! List || rawBox.length < 4) return null;
    final values = <double>[];
    for (final value in rawBox.take(4)) {
      final number = value is num
          ? value.toDouble()
          : double.tryParse(value.toString());
      if (number == null) return null;
      values.add(number);
    }

    final confidence = raw['conf'];
    return ScanTextLine(
      index: raw['index'] is int ? raw['index'] as int : 0,
      text: text,
      box: Rect.fromLTRB(values[0], values[1], values[2], values[3]),
      confidence: confidence is num ? confidence.toDouble() : null,
    );
  }
}

class TextScanField {
  final String key;
  final String label;
  final IconData icon;
  final Color color;

  const TextScanField({
    required this.key,
    required this.label,
    required this.icon,
    required this.color,
  });
}

const TextScanField _nameField = TextScanField(
  key: 'name',
  label: 'Name',
  icon: Icons.person_outline,
  color: Color(0xFF2563EB),
);
const TextScanField _dobField = TextScanField(
  key: 'dob',
  label: 'DOB',
  icon: Icons.calendar_today_outlined,
  color: Color(0xFF7C3AED),
);
const TextScanField _genderField = TextScanField(
  key: 'gender',
  label: 'Gender',
  icon: Icons.wc_outlined,
  color: Color(0xFF0891B2),
);
const TextScanField _aadhaarField = TextScanField(
  key: 'aadhaar_number',
  label: 'Aadhaar No.',
  icon: Icons.credit_card_outlined,
  color: Color(0xFF159A68),
);
const TextScanField _addressField = TextScanField(
  key: 'address_line_1',
  label: 'Address',
  icon: Icons.home_outlined,
  color: Color(0xFFD97706),
);
const TextScanField _pinField = TextScanField(
  key: 'pincode',
  label: 'PIN code',
  icon: Icons.local_post_office_outlined,
  color: Color(0xFFDB2777),
);
const TextScanField _udidField = TextScanField(
  key: 'udid_number',
  label: 'UDID No.',
  icon: Icons.badge_outlined,
  color: Color(0xFF4F46E5),
);
const TextScanField _certField = TextScanField(
  key: 'certificate_number',
  label: 'Certificate No.',
  icon: Icons.description_outlined,
  color: Color(0xFF0D9488),
);
const TextScanField _disabilityTypeField = TextScanField(
  key: 'disability_type',
  label: 'Disability Type',
  icon: Icons.accessibility_new_outlined,
  color: Color(0xFFEA580C),
);
const TextScanField _disabilityPctField = TextScanField(
  key: 'disability_percentage',
  label: 'Disability %',
  icon: Icons.percent_outlined,
  color: Color(0xFFBE123C),
);

/// What the operator confirmed in the preview. [values] already includes the
/// auto-detected fields; boxes the operator tapped override them.
class DocumentTextScanResult {
  final Map<String, String> values;
  final int lineCount;

  const DocumentTextScanResult({
    required this.values,
    required this.lineCount,
  });
}

/// Full-screen "scan preview" shown immediately after a document photo is
/// captured/uploaded, before it is attached to the beneficiary form.
class DocumentTextScanPage extends StatefulWidget {
  final Uint8List imageBytes;
  final String title;
  final String docType;
  final String side;

  const DocumentTextScanPage({
    super.key,
    required this.imageBytes,
    required this.title,
    required this.docType,
    this.side = 'all',
  });

  @override
  State<DocumentTextScanPage> createState() => _DocumentTextScanPageState();
}

class _DocumentTextScanPageState extends State<DocumentTextScanPage> {
  ui.Image? _image;
  bool _decoding = true;
  bool _scanning = true;
  bool _submitting = false;
  String? _error;

  List<ScanTextLine> _lines = [];
  Map<String, dynamic> _fields = {};
  Map<String, Set<int>> _assignments = {};
  int? _selectedIndex;
  String? _activeField;

  @override
  void initState() {
    super.initState();
    _decodeImage();
    _scan();
  }

  Future<void> _decodeImage() async {
    final completer = Completer<ui.Image>();
    try {
      ui.decodeImageFromList(widget.imageBytes, completer.complete);
      final image = await completer.future.timeout(const Duration(seconds: 10));
      if (!mounted) return;
      setState(() {
        _image = image;
        _decoding = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _decoding = false);
    }
  }

  Future<void> _scan() async {
    try {
      final response = await ApiService.scanDocumentPreview(
        base64Encode(widget.imageBytes),
        docType: widget.docType,
        side: widget.side,
      );
      if (!mounted) return;

      final lines = (response['lines'] is List)
          ? (response['lines'] as List)
              .map(ScanTextLine.tryParse)
              .whereType<ScanTextLine>()
              .toList()
          : <ScanTextLine>[];

      setState(() {
        _fields = Map<String, dynamic>.from(response);
        _lines = lines;
        _scanning = false;
        if (lines.isEmpty) {
          _error = 'No text boxes were detected. You can still attach the photo and fill the fields by hand.';
        }
        _seedAssignments();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _scanning = false;
        _error = 'Indra OCR could not read this photo: ${e.toString().replaceFirst('Exception: ', '')}';
      });
    }
  }

  List<TextScanField> get _fieldDefs {
    if (widget.docType == 'aadhaar') {
      return const [
        _nameField,
        _dobField,
        _genderField,
        _aadhaarField,
        _addressField,
        _pinField,
      ];
    }
    if (widget.docType == 'udid') {
      return const [
        _nameField,
        _dobField,
        _genderField,
        _udidField,
        _certField,
        _addressField,
        _pinField,
        _disabilityTypeField,
        _disabilityPctField,
      ];
    }
    if (widget.docType == 'disability') {
      return const [
        _nameField,
        _dobField,
        _genderField,
        _certField,
        _addressField,
        _pinField,
        _disabilityTypeField,
        _disabilityPctField,
      ];
    }
    return const [
      _nameField,
      _dobField,
      _genderField,
      _aadhaarField,
      _udidField,
      _certField,
      _addressField,
      _pinField,
      _disabilityTypeField,
      _disabilityPctField,
    ];
  }

  TextScanField _field(String key) => _fieldDefs.firstWhere(
        (field) => field.key == key,
        orElse: () => _nameField,
      );

  /// Pre-highlight boxes that match the values Indra already extracted, so
  /// the operator only corrects mistakes instead of starting from zero.
  void _seedAssignments() {
    final candidates = <Map<String, dynamic>>[];

    for (final field in _fieldDefs) {
      final value = (_fields[field.key] ?? '').toString().trim();
      if (value.isEmpty) continue;
      final wanted = _normalize(value);
      for (final line in _lines) {
        final score = _matchScore(wanted, _normalize(line.text));
        if (score >= 25) {
          candidates.add({
            'field': field.key,
            'line': line.index,
            'score': score,
          });
        }
      }
    }

    candidates.sort((a, b) => (b['score'] as int).compareTo(a['score'] as int));

    final usedLines = <int>{};
    final perField = <String, int>{};
    for (final candidate in candidates) {
      final key = candidate['field'] as String;
      final index = candidate['line'] as int;
      if (usedLines.contains(index)) continue;
      final limit = key == 'address_line_1' ? 4 : 1;
      if ((perField[key] ?? 0) >= limit) continue;

      _assignments.putIfAbsent(key, () => <int>{}).add(index);
      usedLines.add(index);
      perField[key] = (perField[key] ?? 0) + 1;
    }
  }

  String _normalize(String value) =>
      value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9/]+'), '');

  int _matchScore(String wanted, String actual) {
    if (wanted.isEmpty || actual.isEmpty) return 0;
    if (wanted == actual) return 100;
    if (wanted.contains(actual) || actual.contains(wanted)) return 80;

    final a = wanted.split(RegExp(r'[^a-z0-9/]+')).where((s) => s.length > 1).toSet();
    final b = actual.split(RegExp(r'[^a-z0-9/]+')).where((s) => s.length > 1).toSet();
    if (a.isEmpty || b.isEmpty) return 0;
    final shorter = a.length < b.length ? a.length : b.length;
    return (60 * a.intersection(b).length / shorter).round();
  }

  String? _fieldForLine(int index) {
    for (final entry in _assignments.entries) {
      if (entry.value.contains(index)) return entry.key;
    }
    return null;
  }

  String _valueForField(String key) {
    final indices = (_assignments[key] ?? <int>{}).toList()..sort();
    if (indices.isEmpty) return '';
    return indices
        .map((index) => _lines.firstWhere(
              (line) => line.index == index,
              orElse: () => const ScanTextLine(index: -1, text: '', box: Rect.zero),
            ))
        .map((line) => line.text.trim())
        .where((text) => text.isNotEmpty)
        .join(' ');
  }

  Map<String, String> _resultValues() {
    final values = <String, String>{};
    for (final field in _fieldDefs) {
      final value = _valueForField(field.key);
      if (value.isNotEmpty) values[field.key] = value;
    }
    return values;
  }

  void _onLineTap(int index) {
    final target = _activeField;
    if (target != null) {
      _assign(index, target);
      return;
    }
    setState(() {
      _selectedIndex = _selectedIndex == index ? null : index;
    });
  }

  void _assign(int lineIndex, String key) {
    final updated = <String, Set<int>>{
      for (final entry in _assignments.entries)
        entry.key: Set<int>.from(entry.value),
    };
    for (final set in updated.values) {
      set.remove(lineIndex);
    }
    updated.putIfAbsent(key, () => <int>{}).add(lineIndex);
    updated.removeWhere((_, set) => set.isEmpty);

    setState(() {
      _assignments = updated;
      _selectedIndex = null;
      _activeField = null;
    });
  }

  void _unassign(String key) {
    setState(() {
      _assignments.remove(key);
    });
  }

  void _finish() {
    if (_submitting || _scanning) return;
    setState(() => _submitting = true);
    Navigator.pop(
      context,
      DocumentTextScanResult(
        values: _resultValues(),
        lineCount: _lines.length,
      ),
    );
  }

  void _cancel() {
    if (_submitting) return;
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        titleSpacing: 16,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const Text(
              'Tap detected text, then choose what it is',
              style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.close),
            tooltip: 'Cancel scan',
            onPressed: _cancel,
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _imageCard(),
                    const SizedBox(height: 16),
                    if (_error != null) _errorCard(),
                    if (_error != null) const SizedBox(height: 12),
                    _fieldsCard(),
                    const SizedBox(height: 16),
                    _detectedTextCard(),
                  ],
                ),
              ),
            ),
            _bottomBar(),
          ],
        ),
      ),
    );
  }

  Widget _imageCard() {
    final image = _image;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: image == null
          ? AspectRatio(
              aspectRatio: 1.4,
              child: Center(
                child: _decoding
                    ? const CircularProgressIndicator()
                    : const Text(
                        'Photo preview unavailable',
                        style: TextStyle(color: AppColors.textSecondary),
                      ),
              ),
            )
          : LayoutBuilder(
              builder: (context, constraints) {
                final displayWidth = constraints.maxWidth;
                final displayHeight =
                    displayWidth * image.height.toDouble() / image.width.toDouble();
                return SizedBox(
                  width: displayWidth,
                  height: displayHeight,
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Image.memory(
                            widget.imageBytes,
                            width: displayWidth,
                            height: displayHeight,
                            fit: BoxFit.fill,
                            gaplessPlayback: true,
                          ),
                        ),
                      ),
                      for (final line in _lines)
                        _lineBox(line, displayWidth, displayHeight, image),
                      if (_scanning)
                        Positioned.fill(
                          child: Container(
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha:0.38),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                CircularProgressIndicator(color: Colors.white),
                                SizedBox(height: 12),
                                Text(
                                  'Scanning text…',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                );
              },
            ),
    );
  }

  Widget _lineBox(ScanTextLine line, double displayWidth, double displayHeight, ui.Image image) {
    final scaleX = displayWidth / image.width.toDouble();
    final scaleY = displayHeight / image.height.toDouble();
    final left = line.box.left * scaleX;
    final top = line.box.top * scaleY;
    final width = math.max(30.0, line.box.width * scaleX);
    final height = math.max(24.0, line.box.height * scaleY);

    final assignedKey = _fieldForLine(line.index);
    final selected = _selectedIndex == line.index;
    final color = assignedKey == null ? AppColors.primaryBlue : _field(assignedKey).color;
    final label = assignedKey == null
        ? line.text
        : '${_field(assignedKey).label}: ${line.text}';

    return Positioned(
      left: left,
      top: top,
      width: width,
      height: height,
      child: GestureDetector(
        onTap: () => _onLineTap(line.index),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          decoration: BoxDecoration(
            color: color.withValues(alpha:selected ? 0.34 : 0.16),
            border: Border.all(
              color: selected ? Colors.white : color,
              width: selected ? 2.5 : 1.5,
            ),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Align(
            alignment: Alignment.bottomLeft,
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: width),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
                decoration: BoxDecoration(
                  color: color.withValues(alpha:0.94),
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(3),
                    topRight: Radius.circular(3),
                  ),
                ),
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _errorCard() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha:0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.warning.withValues(alpha:0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, color: AppColors.warning, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _error ?? '',
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _fieldsCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Match text to fields',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          const Text(
            'Tap a highlighted line, then tap its field. Tap a field first to assign several lines (e.g. address).',
            style: TextStyle(fontSize: 11, color: AppColors.textSecondary, height: 1.4),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final field in _fieldDefs) _fieldChip(field),
            ],
          ),
          if (_assignments.isNotEmpty) ...[
            const SizedBox(height: 14),
            const Divider(height: 1, color: AppColors.divider),
            const SizedBox(height: 10),
            for (final field in _fieldDefs)
              if (_assignments.containsKey(field.key))
                _summaryRow(field),
          ],
        ],
      ),
    );
  }

  Widget _fieldChip(TextScanField field) {
    final active = _activeField == field.key;
    final assigned = _assignments.containsKey(field.key);
    final labelColor = active ? Colors.white : (assigned ? field.color : AppColors.textPrimary);
    return FilterChip(
      avatar: Icon(
        field.icon,
        size: 14,
        color: active ? Colors.white : field.color,
      ),
      label: Text(field.label),
      labelStyle: TextStyle(
        fontSize: 11.5,
        fontWeight: assigned ? FontWeight.w700 : FontWeight.w500,
        color: labelColor,
      ),
      selected: active || assigned,
      backgroundColor: AppColors.surfaceSoft,
      selectedColor: active ? field.color : field.color.withValues(alpha:0.14),
      checkmarkColor: Colors.white,
      showCheckmark: assigned && !active,
      side: BorderSide(color: active ? field.color : AppColors.border),
      onSelected: (_) {
        if (_selectedIndex != null) {
          _assign(_selectedIndex!, field.key);
          return;
        }
        setState(() {
          _activeField = active ? null : field.key;
        });
      },
    );
  }

  Widget _summaryRow(TextScanField field) {
    final value = _valueForField(field.key);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            margin: const EdgeInsets.only(top: 5),
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: field.color,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: RichText(
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              text: TextSpan(
                style: const TextStyle(fontSize: 12, color: AppColors.textPrimary),
                children: [
                  TextSpan(
                    text: '${field.label}: ',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  TextSpan(text: value),
                ],
              ),
            ),
          ),
          InkWell(
            onTap: () => _unassign(field.key),
            borderRadius: BorderRadius.circular(12),
            child: const Padding(
              padding: EdgeInsets.all(4),
              child: Icon(Icons.close, size: 15, color: AppColors.textSecondary),
            ),
          ),
        ],
      ),
    );
  }

  Widget _detectedTextCard() {
    if (_lines.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Detected text (${_lines.length})',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final line in _lines)
                ActionChip(
                  avatar: CircleAvatar(
                    backgroundColor: _fieldForLine(line.index) == null
                        ? AppColors.primaryBlueSoft
                        : _field(_fieldForLine(line.index)!).color.withValues(alpha:0.18),
                    radius: 8,
                    child: Text(
                      '${line.index + 1}',
                      style: const TextStyle(fontSize: 8, color: AppColors.textPrimary),
                    ),
                  ),
                  label: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 190),
                    child: Text(
                      line.text,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 10.5),
                    ),
                  ),
                  onPressed: () => _onLineTap(line.index),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _bottomBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.divider)),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: _submitting ? null : _cancel,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 44),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Cancel', style: TextStyle(fontSize: 12.5)),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: FilledButton.icon(
              onPressed: (_scanning || _submitting) ? null : _finish,
              icon: const Icon(Icons.check_circle_outline, size: 17),
              label: Text(
                _lines.isEmpty ? 'Attach anyway' : 'Use these details',
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 44),
                backgroundColor: AppColors.primaryBlue,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
