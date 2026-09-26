import 'dart:convert';

import 'package:dropdown_button2/dropdown_button2.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;

import '../../core/lucide_icons.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/app_snackbar.dart';
import '../../core/widgets/section_header.dart';
import '../../services/api_service.dart';
import 'document_capture_page.dart';
import 'fingerprint_enroll_panel.dart';

// Squeezes a captured Aadhaar photo down to at most 1600px on the long edge so
// the OCR request is small and fast (and never bumps into server/gateway
// payload limits). Runs on a background isolate via compute().
String _compactAadhaarJpeg(String base64) {
  try {
    final decoded = img.decodeImage(base64Decode(base64));
    if (decoded == null) return base64;
    final longest = decoded.width > decoded.height ? decoded.width : decoded.height;
    final scale = longest > 1600 ? 1600 / longest : 1.0;
    final resized = img.copyResize(
      decoded,
      width: (decoded.width * scale).round(),
      height: (decoded.height * scale).round(),
    );
    return base64Encode(img.encodeJpg(resized, quality: 85));
  } catch (_) {
    return base64;
  }
}

enum _DocType { aadhaar, udid, disability }

class _PendingDoc {
  final _DocType type;
  final String label;
  final bool required;
  String? base64;
  String? name;

  _PendingDoc({required this.type, required this.label, required this.required});
}

class AddBeneficiaryPage extends StatefulWidget {
  const AddBeneficiaryPage({super.key});

  @override
  State<AddBeneficiaryPage> createState() => _AddBeneficiaryPageState();
}

class _AddBeneficiaryPageState extends State<AddBeneficiaryPage> {
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _mobileController = TextEditingController();
  final _occupationController = TextEditingController();
  final _neededController = TextEditingController();
  final _addressController = TextEditingController();
  final _pincodeController = TextEditingController();
  final _aadhaarController = TextEditingController();
  final _disabilityPctController = TextEditingController();

  final List<_PendingDoc> _docs = [
    _PendingDoc(type: _DocType.aadhaar, label: 'Aadhaar Card', required: true),
    _PendingDoc(type: _DocType.udid, label: 'UDID Card', required: false),
    _PendingDoc(
        type: _DocType.disability,
        label: 'Disability Certificate',
        required: false),
  ];

  final List<Map<String, dynamic>> _ngos = [];
  String? _selectedNgoId;

  String? _gender;
  DateTime? _dob;
  bool _loading = false;
  Map<String, dynamic>? _created;
  List<CapturedFingerprint> _captured = [];
  bool _fingersReady = false;

  static const int requiredFingers = 3;

  static const List<String> _disabilityTypes = [
    'Locomotor / Orthopedic',
    'Visual Impairment',
    'Hearing Impairment',
    'Speech & Language',
    'Intellectual Disability',
    'Mental Illness',
    'Multiple Disabilities',
    'Cerebral Palsy',
    'Autism Spectrum Disorder',
    'Dwarfism',
    'Leprosy Cured',
    'Other',
  ];

  String? _disabilityType;

  @override
  void initState() {
    super.initState();
    _loadNgos();
  }

  @override
  void dispose() {
    _fullNameController.dispose();
    _mobileController.dispose();
    _occupationController.dispose();
    _neededController.dispose();
    _addressController.dispose();
    _pincodeController.dispose();
    _aadhaarController.dispose();
    _disabilityPctController.dispose();
    super.dispose();
  }

  // NGOs for the dropdown. The operator picks which organization the new
  // member belongs to. Maps each element so a raw List<dynamic> from the
  // server never trips a List<Map<String, dynamic>> cast.
  Future<void> _loadNgos() async {
    try {
      final list = await ApiService.getList('/ngos/options');
      if (!mounted) return;
      setState(() {
        _ngos
          ..clear()
          ..addAll(list.map((e) => Map<String, dynamic>.from(e)));
      });
    } catch (_) {
      // Dropdown stays empty — operator can still register without an NGO.
    }
  }

  // Dropdown items. ngos.id is a UUID string (never an int), so the value is
  // kept as text and de-duplicated so the dropdown never sees a duplicate value.
  List<DropdownItem<String>> _ngoItems() {
    final seen = <String, String>{};
    for (final n in _ngos) {
      final id = n['id']?.toString() ?? '';
      if (id.isEmpty) continue;
      seen.putIfAbsent(id, () => n['name']?.toString() ?? 'NGO');
    }
    return [
      for (final e in seen.entries)
        DropdownItem<String>(
          value: e.key,
          child: Text(e.value, overflow: TextOverflow.ellipsis),
        ),
    ];
  }

  Set<String> _ngoIdSet() => {
        for (final n in _ngos)
          if ((n['id']?.toString() ?? '') case final String id when id.isNotEmpty) id,
      };

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(now.year - 30),
      firstDate: DateTime(1900),
      lastDate: now,
    );
    if (picked != null) setState(() => _dob = picked);
  }

  String _docLabel(_DocType type) => _docs.firstWhere((d) => d.type == type).label;

  // Dotted "Upload document" area: opens a bottom sheet with the choices that
  // are not yet attached, then a doc-capture flow.
  Future<void> _uploadDocument() async {
    if (_loading || _created != null) return;
    final selected = await showModalBottomSheet<_DocType>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(24, 8, 24, 6),
              child: Text(
                'Upload document',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(24, 8, 24, 14),
              child: Text(
                'Choose a document to upload',
                style: TextStyle(fontSize: 13, height: 1.4, color: AppColors.textSecondary),
              ),
            ),
            ..._docs.where((d) => d.base64 == null).map((d) => _docOption(
                  d.type,
                  d.label,
                  d.type == _DocType.aadhaar
                      ? 'Required'
                      : (d.type == _DocType.udid
                          ? 'OR Disability certificate'
                          : 'OR UDID card'),
                  d.type == _DocType.aadhaar
                      ? LucideIcons.userCheck
                      : (d.type == _DocType.udid
                          ? LucideIcons.clipboardCheck
                          : LucideIcons.checkCircle),
                )),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
              child: OutlinedButton(
                onPressed: () => Navigator.of(ctx).pop(),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: const Text('Cancel'),
              ),
            ),
          ],
        ),
      ),
    );
    if (selected == null || !mounted) return;

    final result = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(builder: (_) => const DocumentCapturePage()),
    );
    if (result == null || !mounted) return;
    setState(() {
      final doc = _docs.firstWhere((d) => d.type == selected);
      doc.base64 = result['base64']?.toString();
      doc.name = result['name']?.toString() ?? 'scanned_document.jpg';
    });
    showAppSnackbar(
      context,
      '${_docLabel(selected)} copy attached.',
      success: true,
    );
    // An uploaded Aadhaar card is automatically scraped for every field it
    // shows, so the form fills itself from the attached photo.
    if (selected == _DocType.aadhaar) {
      await _scrapeAadhaarDoc();
    }
  }

  Future<void> _scrapeAadhaarDoc() async {
    final base64 = _docs.firstWhere((d) => d.type == _DocType.aadhaar).base64;
    if (base64 == null || base64.isEmpty) return;
    try {
      // Downscale first so the OCR request is small, fast, and never rejected
      // for being too large. The original photo stays attached to the record.
      final compact = await compute(_compactAadhaarJpeg, base64);
      final fields = await ApiService.parseAadhaarPhoto(compact);
      if (!mounted) return;

      setState(() {
        final name = fields['name']?.toString();
        if (name != null && name.trim().isNotEmpty) {
          _fullNameController.text = name.trim();
        }
        final dob = fields['dob']?.toString();
        if (dob != null && dob.length >= 10) {
          final parts = dob.split('-');
          if (parts.length == 3) {
            final y = int.tryParse(parts[0]);
            final m = int.tryParse(parts[1]);
            final d = int.tryParse(parts[2]);
            if (y != null && m != null && d != null) {
              _dob = DateTime(y, m, d);
            }
          }
        }
        final gender = fields['gender']?.toString();
        if (gender != null && gender.trim().isNotEmpty) {
          _gender = gender;
        }
        final address = fields['address_line_1']?.toString();
        if (address != null && address.trim().isNotEmpty) {
          _addressController.text = address.trim();
        }
        final aadhaar = fields['aadhaar_number']?.toString();
        if (aadhaar != null && aadhaar.trim().isNotEmpty) {
          _aadhaarController.text = aadhaar.trim();
        }
        final pincode = fields['pincode']?.toString();
        if (pincode != null && pincode.trim().isNotEmpty) {
          _pincodeController.text = pincode.replaceAll(RegExp(r'[^0-9]'), '');
        }
      });

      showAppSnackbar(
        context,
        'Aadhaar details auto-filled. Please review before registering.',
        success: true,
      );
    } catch (e) {
      if (mounted) {
        showAppSnackbar(
          context,
          'Aadhaar copy attached, but details could not be read: $e',
          warning: true,
        );
      }
    }
  }

  Widget _docOption(_DocType type, String label, String sub, IconData icon) {
    return ListTile(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: AppColors.primaryBlueSoft,
          borderRadius: BorderRadius.circular(12),
        ),
        alignment: Alignment.center,
        child: Icon(icon, size: 20, color: AppColors.primaryBlue),
      ),
      title: Text(
        label,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
      ),
      subtitle: Text(sub, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
      trailing: const Icon(LucideIcons.chevronRight, color: AppColors.textTertiary),
      onTap: () => Navigator.of(context).pop(type),
    );
  }

  Future<void> _submit() async {
    final aadhaar = _docs.firstWhere((d) => d.type == _DocType.aadhaar);
    final hasUdIdOrDisability = _docs
        .where((d) => d.type == _DocType.udid || d.type == _DocType.disability)
        .any((d) => d.base64 != null);
    if (aadhaar.base64 == null || !hasUdIdOrDisability) {
      showAppSnackbar(
        context,
        'Aadhaar card plus UDID card or Disability certificate are required before registering.',
        warning: true,
      );
      return;
    }
    if (!_fingersReady) {
      showAppSnackbar(
        context,
        'Scan all 3 fingerprints before registering',
        warning: true,
      );
      return;
    }
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _created = null;
    });
    try {
      final body = <String, dynamic>{
        'full_name': _fullNameController.text.trim(),
      };
      if (_mobileController.text.trim().isNotEmpty) body['mobile'] = _mobileController.text.trim();
      if (_dob != null) body['date_of_birth'] = '${_dob!.year.toString().padLeft(4, '0')}-${_dob!.month.toString().padLeft(2, '0')}-${_dob!.day.toString().padLeft(2, '0')}';
      if (_gender != null) body['gender'] = _gender;
      if (_occupationController.text.trim().isNotEmpty) body['occupation'] = _occupationController.text.trim();
      if (_addressController.text.trim().isNotEmpty) body['address_line_1'] = _addressController.text.trim();
      if (_pincodeController.text.trim().isNotEmpty) body['pincode'] = _pincodeController.text.trim();
      if (_aadhaarController.text.trim().isNotEmpty) body['aadhaar_number'] = _aadhaarController.text.trim();
      if (_neededController.text.trim().isNotEmpty) body['needed'] = _neededController.text.trim();
      final disabilityPct = int.tryParse(_disabilityPctController.text.trim());
      if (disabilityPct != null) {
        body['disabilities'] = [
          {
            'disability_type': _disabilityType ?? 'General',
            'disability_percentage': disabilityPct,
            'certificate_available': true,
          },
        ];
      }
      if (_selectedNgoId != null) body['ngo_id'] = _selectedNgoId;

      final result = await ApiService.post('/beneficiaries', body: body);
      final created = Map<String, dynamic>.from(result['beneficiary'] ?? {});
      final code = created['beneficiary_code']?.toString();
      final id = created['id'];

      // Enroll all captured fingerprints against the new beneficiary
      if (code != null) {
        for (final f in _captured) {
          await ApiService.post(
            '/biometrics/enroll',
            body: {'beneficiary_code': code, ...f.toEnrollBody()},
            timeout: const Duration(minutes: 1),
          );
        }
      }

      final serverWarnings = (result['warnings'] as List?)?.cast<String>() ?? const <String>[];
      final failedDocs = <String>[];
      if (id != null) {
        for (final doc in _docs.where((d) => d.base64 != null)) {
          var ok = false;
          for (var attempt = 1; attempt <= 3 && !ok; attempt++) {
            try {
              await ApiService.post(
                '/beneficiaries/$id/documents',
                body: {
                  'document_type': _docTypeId(doc.type),
                  'file_base64': doc.base64,
                  'mime_type': 'image/jpeg',
                  'file_name': doc.name ?? 'scanned_document.jpg',
                },
                timeout: const Duration(minutes: 2),
              );
              ok = true;
            } catch (_) {
              if (attempt < 3) {
                await Future<void>.delayed(Duration(milliseconds: 800 * attempt));
              }
            }
          }
          if (!ok) failedDocs.add(_docLabel(doc.type));
        }
      }

      if (!mounted) return;
      setState(() {
        _loading = false;
        _created = created;
      });
      final headline = code != null
          ? 'Beneficiary registered: $code'
          : 'Beneficiary registered';
      final problems = <String>[
        ...failedDocs.map((d) => 'Could not upload $d'),
        ...serverWarnings,
      ];
      if (problems.isEmpty) {
        showAppSnackbar(context, headline, success: true);
      } else {
        showAppSnackbar(
          context,
          '$headline. ${problems.join('. ')}',
          warning: true,
        );
      }
      // Go straight to the home page after successful registration.
      Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      showAppSnackbar(
        context,
        e.toString().replaceFirst('Exception: ', ''),
        error: true,
      );
    }
  }

  String _docTypeId(_DocType type) {
    switch (type) {
      case _DocType.aadhaar:
        return 'aadhaar_card';
      case _DocType.udid:
        return 'udid_card';
      case _DocType.disability:
        return 'handicap_certificate';
    }
  }

  @override
  Widget build(BuildContext context) {
    final created = _created;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Add Beneficiary'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
          children: [
            const SectionHeader(title: 'Personal Information'),
            const SizedBox(height: 16),

            TextFormField(
              controller: _fullNameController,
              decoration: const InputDecoration(labelText: 'Full Name *'),
              textCapitalization: TextCapitalization.words,
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Full name is required' : null,
              enabled: !_loading && created == null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _mobileController,
              decoration: const InputDecoration(labelText: 'Mobile Number'),
              keyboardType: TextInputType.phone,
              maxLength: 10,
              enabled: !_loading && created == null,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField2<String>(
                    valueListenable: ValueNotifier<String?>(_gender),
                    decoration: const InputDecoration(labelText: 'Gender'),
                    items: ['Male', 'Female', 'Other']
                        .map((g) => DropdownItem<String>(value: g, child: Text(g)))
                        .toList(),
                    onChanged: (v) => setState(() => _gender = v),
                    buttonStyleData: const FormFieldButtonStyleData(
                      height: 52,
                      padding: EdgeInsets.only(left: 12),
                    ),
                    iconStyleData: const IconStyleData(iconSize: 20),
                    dropdownStyleData: const DropdownStyleData(
                      maxHeight: 260,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.all(Radius.circular(12)),
                      ),
                    ),
                    menuItemStyleData: const MenuItemStyleData(
                      padding: EdgeInsets.symmetric(horizontal: 12),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: GestureDetector(
                    onTap: created == null ? _pickDob : null,
                    child: AbsorbPointer(
                      child: TextFormField(
                        readOnly: true,
                        decoration: InputDecoration(
                          labelText: 'Date of Birth',
                          hintText: _dob == null
                              ? 'Select date'
                              : '${_dob!.day}/${_dob!.month}/${_dob!.year}',
                          suffixIcon: const Icon(LucideIcons.calendar, size: 18),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _occupationController,
              decoration: const InputDecoration(labelText: 'Occupation'),
              textCapitalization: TextCapitalization.words,
              enabled: !_loading && created == null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _neededController,
              decoration: const InputDecoration(
                labelText: 'Needed',
                hintText: 'What does the beneficiary need?',
              ),
              textCapitalization: TextCapitalization.sentences,
              maxLines: 2,
              enabled: !_loading && created == null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _addressController,
              decoration: const InputDecoration(labelText: 'Address'),
              textCapitalization: TextCapitalization.words,
              maxLines: 2,
              enabled: !_loading && created == null,
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField2<String>(
              valueListenable: ValueNotifier<String?>(
                _ngoIdSet().contains(_selectedNgoId) ? _selectedNgoId : null,
              ),
              decoration: const InputDecoration(labelText: 'NGO *'),
              hint: const Text('Select NGO'),
              items: _ngoItems(),
              isExpanded: true,
              onChanged:
                  (_loading || created != null) ? null : (v) => setState(() => _selectedNgoId = v),
              validator: (v) => v == null ? 'Please select an NGO' : null,
              buttonStyleData: const FormFieldButtonStyleData(
                height: 52,
                padding: EdgeInsets.only(left: 12),
              ),
              iconStyleData: const IconStyleData(iconSize: 20),
              dropdownStyleData: const DropdownStyleData(
                maxHeight: 300,
                padding: EdgeInsets.symmetric(vertical: 4),
              ),
              menuItemStyleData: const MenuItemStyleData(
                padding: EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _pincodeController,
              decoration: const InputDecoration(labelText: 'Pincode', counterText: ''),
              keyboardType: TextInputType.number,
              maxLength: 6,
              enabled: !_loading && created == null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _aadhaarController,
              decoration: const InputDecoration(labelText: 'Aadhaar Number'),
              keyboardType: TextInputType.number,
              maxLength: 12,
              enabled: !_loading && created == null,
            ),
            const SizedBox(height: 24),

            // Documents — Aadhaar required, UDID or Disability certificate.
            const SectionHeader(title: 'Documents'),
            const SizedBox(height: 16),

            // Dotted upload area → bottom sheet with the not-yet-added choices.
            InkWell(
              onTap: (_loading || created != null) ? null : _uploadDocument,
              borderRadius: BorderRadius.circular(16),
              child: CustomPaint(
                foregroundPainter: const _DottedRoundedRectPainter(
                  color: AppColors.dashedBorder,
                ),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Column(
                    children: [
                      Icon(Icons.upload_rounded,
                          size: 28, color: AppColors.primaryBlue),
                      SizedBox(height: 8),
                      Text(
                        'Upload document',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),

            // Per-document status rows — only show docs that were actually
            // scanned, so "Not scanned" placeholders stay out of the way.
            ..._docs.where((doc) => doc.base64 != null).map((doc) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _docStatusRow(doc),
                )),
            const SizedBox(height: 12),

            DropdownButtonFormField2<String>(
              valueListenable: ValueNotifier<String?>(_disabilityType),
              decoration: const InputDecoration(labelText: 'Disability Type *'),
              hint: const Text('Select disability type'),
              items: _disabilityTypes
                  .map((t) => DropdownItem<String>(
                        value: t,
                        child: Text(t, overflow: TextOverflow.ellipsis),
                      ))
                  .toList(),
              isExpanded: true,
              onChanged: (_loading || created != null)
                  ? null
                  : (v) => setState(() => _disabilityType = v),
              validator: (v) => v == null ? 'Select disability type' : null,
              buttonStyleData: const FormFieldButtonStyleData(
                height: 52,
                padding: EdgeInsets.only(left: 12),
              ),
              iconStyleData: const IconStyleData(iconSize: 20),
              dropdownStyleData: const DropdownStyleData(
                maxHeight: 320,
                padding: EdgeInsets.symmetric(vertical: 4),
              ),
              menuItemStyleData: const MenuItemStyleData(
                padding: EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
            const SizedBox(height: 16),

            TextFormField(
              controller: _disabilityPctController,
              decoration: const InputDecoration(
                labelText: 'Disability Percentage (%) *',
                counterText: '',
              ),
              keyboardType: TextInputType.number,
              maxLength: 3,
              enabled: !_loading && created == null,
              validator: (v) {
                final n = int.tryParse((v ?? '').trim());
                if (n == null || n < 1 || n > 100) {
                  return 'Enter a disability percentage between 1-100';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),

            // Fingerprint enrollment (buffered until registration)
            const SectionHeader(title: 'Fingerprints'),
            const SizedBox(height: 16),
            FingerprintEnrollPanel(
              collectOnly: true,
              onCaptured: (list) => setState(() {
                _captured = list;
                _fingersReady = list.length >= requiredFingers;
              }),
            ),
            const SizedBox(height: 16),

            // Register button enabled only after 3 fingerprints are scanned
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: (_fingersReady && !_loading) ? _submit : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryBlueSoft,
                  foregroundColor: AppColors.addBeneficiaryText,
                  disabledBackgroundColor:
                      AppColors.primaryBlueSoft.withValues(alpha: 0.5),
                  disabledForegroundColor:
                      AppColors.addBeneficiaryText.withValues(alpha: 0.5),
                ),
                icon: _loading
                    ? const SkeletonBox(
                        width: 16,
                        height: 16,
                        borderRadius: 5,
                        baseColor: Color(0x262563EB),
                        shineColor: Color(0xFF2563EB),
                      )
                    : const Icon(LucideIcons.userPlus, size: 18),
                label: Text(
                  _loading
                      ? 'Registering...'
                      : _fingersReady
                          ? 'Register Beneficiary'
                          : 'Register Beneficiary (${_captured.length}/$requiredFingers fingerprints)',
                ),
              ),
            ),
            if (!_fingersReady) ...[
              const SizedBox(height: 8),
              const Text(
                'Register is unlocked only after all 3 fingerprints are scanned.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _docStatusRow(_PendingDoc doc) {
    final attached = doc.base64 != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(
            attached ? LucideIcons.checkCircle : LucideIcons.camera,
            size: 18,
            color: attached ? AppColors.successGreen : AppColors.textTertiary,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  doc.label,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                Text(
                  doc.type == _DocType.udid || doc.type == _DocType.disability
                      ? 'Required only if you skip the other'
                      : (doc.required ? 'Required' : 'Optional'),
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
          Text(
            attached ? 'Scanned' : 'Not scanned',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: attached ? AppColors.successGreen : AppColors.textSecondary,
            ),
          ),
          const SizedBox(width: 6),
          IconButton(
            onPressed: (_loading || _created != null)
                ? null
                : () => setState(() {
                      doc.base64 = null;
                      doc.name = null;
                    }),
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            tooltip: 'Remove ${doc.label}',
            icon: const Icon(Icons.delete_outline,
                size: 20, color: AppColors.textTertiary),
          ),
        ],
      ),
    );
  }
}

class _DottedRoundedRectPainter extends CustomPainter {
  final Color color;

  const _DottedRoundedRectPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    const dotRadius = 2.2;
    const gap = 5.0;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;
    final path = Path()
      ..addRRect(RRect.fromRectAndRadius(
        Offset.zero & size,
        const Radius.circular(16),
      ));
    for (final metric in path.computeMetrics()) {
      var dist = 0.0;
      while (dist < metric.length) {
        final tangent = metric.getTangentForOffset(dist);
        if (tangent != null) {
          canvas.drawCircle(tangent.position, dotRadius, paint);
        }
        dist += dotRadius * 2 + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DottedRoundedRectPainter oldDelegate) =>
      oldDelegate.color != color;
}