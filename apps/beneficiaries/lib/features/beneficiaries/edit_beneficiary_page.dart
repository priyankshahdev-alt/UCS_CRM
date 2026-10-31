import 'dart:async';
import 'dart:convert';

import 'package:dropdown_button2/dropdown_button2.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;

import '../../core/lucide_icons.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/app_snackbar.dart';
import '../../core/widgets/section_header.dart';
import '../../core/utils/photo_utils.dart';
import '../../services/api_service.dart';
import 'camera_capture_page.dart';
import 'document_capture_page.dart';
import 'fingerprint_enroll_panel.dart';

String _compactJpeg(String base64) {
  try {
    final decoded = img.decodeImage(base64Decode(base64));
    if (decoded == null) return base64;
    final longest =
        decoded.width > decoded.height ? decoded.width : decoded.height;
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

/// Completes an imported record. The form is the same shape as the registration
/// page, but every field the import left blank is empty and waiting: nothing is
/// required except the name, so the operator can save partial progress and add
/// documents, aadhaar and fingerprints in as many passes as it takes.
class EditBeneficiaryPage extends StatefulWidget {
  final Map<String, dynamic> beneficiary;

  const EditBeneficiaryPage({super.key, required this.beneficiary});

  @override
  State<EditBeneficiaryPage> createState() => _EditBeneficiaryPageState();
}

class _EditBeneficiaryPageState extends State<EditBeneficiaryPage> {
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _mobileController = TextEditingController();
  final _occupationController = TextEditingController();
  final _neededController = TextEditingController();
  final _locationController = TextEditingController();
  final _cityController = TextEditingController();
  final _stateController = TextEditingController();
  final _pincodeController = TextEditingController();
  final _aadhaarController = TextEditingController();
  final _disabilityPctController = TextEditingController();
  final _dobController = TextEditingController();

  final List<Map<String, dynamic>> _ngos = [];
  String? _selectedNgoId;

  String? _gender;
  DateTime? _dob;
  String? _disabilityType;
  bool _loading = false;
  bool _loadingFiles = true;
  String? _loadFilesError;

  /// Data URL of the beneficiary photo, or null when the record has none.
  String? _photo;
  bool _photoBusy = false;

  // Documents already on the server, so an operator does not re-scan a copy
  // that is already filed.
  final Map<String, int> _existingDocCounts = {};
  final List<_PendingDoc> _docs = [
    _PendingDoc(type: _DocType.aadhaar, label: 'Aadhaar Card'),
    _PendingDoc(type: _DocType.udid, label: 'UDID Card'),
    _PendingDoc(type: _DocType.disability, label: 'Disability Certificate'),
  ];

  // Finger positions already enrolled, and their human labels.
  final List<String> _enrolledFingers = [];
  final List<String> _enrolledFingerLabels = [];

  static const String _docAadhaar = 'aadhaar_card';
  static const String _docUdid = 'udid_card';
  static const String _docDisability = 'handicap_certificate';

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

  static const List<String> _genders = [
    'Male',
    'Female',
    'Other',
    'Transgender',
  ];

  static const List<String> _beneficiaryTypes = [
    'Visually Impaired Individuals',
    'Persons with Disabilities (PwD)',
    'Specially Abled Individuals',
    'Underprivileged Children',
    'Underprivileged Women',
    'Senior Citizens',
    'Orphaned Children',
    'Slum-Dwelling Families',
    'Rural and Tribal Communities',
    'Widows and Single Mothers',
    'Homeless Individuals',
    'Needy Families',
    'Students from Low-Income Families',
    'Unemployed Youth',
    'Flood-Affected Families',
    'Daily Wage Workers',
  ];

  String? _beneficiaryType;

  /// Maps a stored value onto one of [options] case-insensitively. Imports
  /// write 'FEMALE'/'TRANSGENDER' while the app writes 'Female', so the raw
  /// value is matched to the option spelling. A value with no match (the
  /// disability type is free text from the sheet, e.g. 'Blindness') is kept as
  /// it is, and [_optionList] makes sure it is offered so the dropdown always
  /// has exactly one item matching its value.
  static String? _normalize(List<String> options, Object? raw) {
    final v = raw?.toString().trim() ?? '';
    if (v.isEmpty) return null;
    for (final o in options) {
      if (o.toLowerCase() == v.toLowerCase()) return o;
    }
    return v;
  }

  static List<String> _optionList(List<String> options, String? current) {
    final out = List<String>.of(options);
    final c = current?.trim() ?? '';
    if (c.isNotEmpty && !out.any((o) => o.toLowerCase() == c.toLowerCase())) {
      out.insert(0, c);
    }
    return out;
  }

  List<String> _genderItems() => _optionList(_genders, _gender);

  List<String> _disabilityItems() => _optionList(_disabilityTypes, _disabilityType);

  List<String> _beneficiaryTypeItems() =>
      _optionList(_beneficiaryTypes, _beneficiaryType);

  String get _code => widget.beneficiary['beneficiary_code']?.toString() ?? '';

  @override
  void initState() {
    super.initState();
    final b = widget.beneficiary;
    _fullNameController.text = b['full_name']?.toString() ?? '';
    _mobileController.text = b['mobile']?.toString() ?? '';
    _occupationController.text = b['occupation']?.toString() ?? '';
    _neededController.text = b['needed']?.toString() ?? '';
    _locationController.text = b['address_line_1']?.toString() ?? '';
    _cityController.text = b['city']?.toString() ?? '';
    _stateController.text = b['state']?.toString() ?? '';
    _pincodeController.text = b['pincode']?.toString() ?? '';
    _aadhaarController.text = b['aadhaar_number']?.toString() ?? '';
    _photo = b['photo']?.toString();
    _gender = _normalize(_genders, b['gender']);
    _beneficiaryType = _normalize(_beneficiaryTypes, b['beneficiary_type']);
    _dob = _parseDob(b['date_of_birth']?.toString());
    if (_dob != null) {
      _dobController.text = _formatDob(_dob!);
    }
    _selectedNgoId = b['ngo_id']?.toString();
    final list = b['disabilities'];
    if (list is List && list.isNotEmpty) {
      final d = list.first;
      if (d is Map) {
        _disabilityType = _normalize(_disabilityTypes, d['disability_type']);
        final pct = d['disability_percentage'];
        if (pct != null) _disabilityPctController.text = pct.toString();
      }
    }
    _loadNgos();
    _loadExistingFiles();
    _prefillArea();
  }

  /// City/state come from the operator's own area (their Operator Details
  /// choice) whenever the record itself does not have them, so the operator
  /// only types them when the beneficiary is from somewhere else.
  Future<void> _prefillArea() async {
    if (_cityController.text.trim().isNotEmpty &&
        _stateController.text.trim().isNotEmpty) {
      return;
    }
    final area = await ApiService.getOperatorArea();
    if (area == null || !mounted) return;
    if (area.city.isEmpty && area.state.isEmpty) return;
    setState(() {
      if (_cityController.text.trim().isEmpty && area.city.isNotEmpty) {
        _cityController.text = area.city;
      }
      if (_stateController.text.trim().isEmpty && area.state.isNotEmpty) {
        _stateController.text = area.state;
      }
    });
  }

  @override
  void dispose() {
    _fullNameController.dispose();
    _mobileController.dispose();
    _occupationController.dispose();
    _neededController.dispose();
    _locationController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _pincodeController.dispose();
    _aadhaarController.dispose();
    _disabilityPctController.dispose();
    _dobController.dispose();
    super.dispose();
  }

  static String _formatDob(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  DateTime? _parseDob(String? v) {
    if (v == null) return null;
    final parts = v.split('-');
    if (parts.length < 3) return null;
    final y = int.tryParse(parts[0]);
    final m = int.tryParse(parts[1]);
    final d = int.tryParse(parts[2]);
    if (y == null || m == null || d == null) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return DateTime(y, m, d);
  }

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
      // Dropdown stays empty; the selected NGO id is preserved from the record.
    }
  }

  /// What is already on file. Best-effort: a failure here only costs the
  /// "already filed" markers, never the ability to fill something in.
  Future<void> _loadExistingFiles() async {
    final id = widget.beneficiary['id'];
    if (id == null) {
      if (mounted) setState(() => _loadingFiles = false);
      return;
    }
    try {
      final results = await Future.wait([
        ApiService.getList('/beneficiaries/$id/documents'),
        ApiService.get('/biometrics/beneficiary/$id'),
      ]);
      if (!mounted) return;
      final docs = results[0] as List<dynamic>;
      final counts = <String, int>{};
      for (final d in docs.whereType<Map>()) {
        final t = d['document_type']?.toString() ?? '';
        if (t.isNotEmpty) counts[t] = (counts[t] ?? 0) + 1;
      }
      final bio = results[1] as Map<String, dynamic>;
      final fingers = (bio['enrolled_fingers'] as List?) ?? const [];
      setState(() {
        _existingDocCounts
          ..clear()
          ..addAll(counts);
        _enrolledFingers
          ..clear()
          ..addAll(fingers
              .whereType<Map>()
              .map((e) => e['finger_position']?.toString() ?? '')
              .where((e) => e.isNotEmpty));
        _enrolledFingerLabels
          ..clear()
          ..addAll(fingers
              .whereType<Map>()
              .map((e) => e['finger_position']?.toString() ?? '')
              .where((e) => e.isNotEmpty)
              .map(_fingerLabel));
        _loadingFiles = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadFilesError =
            e.toString().replaceFirst('Exception: ', '');
        _loadingFiles = false;
      });
    }
  }

  static String _fingerLabel(String position) {
    final parts = position.split('_');
    if (parts.length < 2) return position;
    final side = parts.first == 'LEFT' ? 'Left' : 'Right';
    final finger = parts.sublist(1).join(' ').toLowerCase();
    return '$side $finger';
  }

  String _docTypeId(_DocType type) {
    switch (type) {
      case _DocType.aadhaar:
        return _docAadhaar;
      case _DocType.udid:
        return _docUdid;
      case _DocType.disability:
        return _docDisability;
    }
  }

  int _existingCount(_DocType type) =>
      _existingDocCounts[_docTypeId(type)] ?? 0;

  // ---- Documents ----------------------------------------------------------

  Future<void> _uploadDocument() async {
    if (_loading) return;
    final pending = _docs.where((d) => d.base64 == null).toList();
    if (pending.isEmpty) {
      showAppSnackbar(context, 'All three documents are attached.',
          warning: true);
      return;
    }
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
                'Choose a document to add to this record',
                style: TextStyle(
                    fontSize: 13, height: 1.4, color: AppColors.textSecondary),
              ),
            ),
            ...pending.map((d) => ListTile(
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.primaryBlueSoft,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    alignment: Alignment.center,
                    child: Icon(
                      _existingCount(d.type) > 0
                          ? LucideIcons.checkCircle
                          : LucideIcons.camera,
                      size: 20,
                      color: AppColors.primaryBlue,
                    ),
                  ),
                  title: Text(
                    d.label,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  subtitle: Text(
                    _existingCount(d.type) > 0
                        ? '${_existingCount(d.type)} already on file — add another'
                        : 'Not on file yet',
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.textSecondary),
                  ),
                  trailing: const Icon(LucideIcons.chevronRight,
                      color: AppColors.textTertiary),
                  onTap: () => Navigator.of(context).pop(d.type),
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
    if (selected == _DocType.aadhaar) {
      await _scrapeAadhaarDoc();
    }
  }

  /// A newly attached Aadhaar card fills any field that is still empty, without
  /// overwriting what the operator (or the import) already put in.
  Future<void> _scrapeAadhaarDoc() async {
    final base64 = _docs.firstWhere((d) => d.type == _DocType.aadhaar).base64;
    if (base64 == null || base64.isEmpty) return;
    try {
      final compact = await compute(_compactJpeg, base64);
      final fields = await ApiService.parseAadhaarPhoto(compact);
      if (!mounted) return;
      final filled = <String>[];
      setState(() {
        void fillIfEmpty(String key, TextEditingController c, String? value) {
          if (c.text.trim().isNotEmpty) return;
          final v = value?.trim();
          if (v == null || v.isEmpty) return;
          c.text = v;
          filled.add(key);
        }

        fillIfEmpty('name', _fullNameController, fields['name']?.toString());
        fillIfEmpty('location', _locationController,
            fields['address_line_1']?.toString());
        fillIfEmpty('city', _cityController, fields['city']?.toString());
        fillIfEmpty('state', _stateController, fields['state']?.toString());
        fillIfEmpty('aadhaar', _aadhaarController,
            fields['aadhaar_number']?.toString());
        final pin = fields['pincode']?.toString();
        if (pin != null && pin.trim().isNotEmpty) {
          fillIfEmpty('pincode', _pincodeController,
              pin.replaceAll(RegExp(r'[^0-9]'), ''));
        }
        final dob = fields['dob']?.toString();
        if (_dob == null && dob != null && dob.length >= 10) {
          final parsed = _parseDob(dob.substring(0, 10));
          if (parsed != null) {
            _dob = parsed;
            _dobController.text = _formatDob(parsed);
            filled.add('dob');
          }
        }
        final gender = fields['gender']?.toString();
        if (_gender == null && gender != null && gender.trim().isNotEmpty) {
          _gender = _normalize(_genders, gender);
          filled.add('gender');
        }
      });
      showAppSnackbar(
        context,
        filled.isEmpty
            ? 'Aadhaar attached. Everything it shows is already filled in.'
            : 'Aadhaar filled in: ${filled.join(', ')}. Please review.',
        success: filled.isNotEmpty,
        warning: filled.isEmpty,
      );
    } catch (e) {
      if (mounted) {
        showAppSnackbar(
          context,
          'Aadhaar attached, but details could not be read: $e',
          warning: true,
        );
      }
    }
  }

  // ---- Save ---------------------------------------------------------------

  Future<void> _submit() async {
    if (_loading) return;
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);

    final body = <String, dynamic>{};
    if (_fullNameController.text.trim().isNotEmpty) {
      body['full_name'] = _fullNameController.text.trim();
    }
    if (_mobileController.text.trim().isNotEmpty) {
      body['mobile'] = _mobileController.text.trim();
    }
    if (_dob != null) {
      body['date_of_birth'] =
          '${_dob!.year.toString().padLeft(4, '0')}-${_dob!.month.toString().padLeft(2, '0')}-${_dob!.day.toString().padLeft(2, '0')}';
    }
    if (_gender != null) body['gender'] = _gender;
    if (_beneficiaryType != null) body['beneficiary_type'] = _beneficiaryType;
    if (_occupationController.text.trim().isNotEmpty) {
      body['occupation'] = _occupationController.text.trim();
    }
    if (_locationController.text.trim().isNotEmpty) {
      body['address_line_1'] = _locationController.text.trim();
    }
    if (_cityController.text.trim().isNotEmpty) {
      body['city'] = _cityController.text.trim();
    }
    if (_stateController.text.trim().isNotEmpty) {
      body['state'] = _stateController.text.trim();
    }
    if (_photo != null && _photo!.isNotEmpty) {
      body['photo'] = _photo;
    }
    if (_pincodeController.text.trim().isNotEmpty) {
      body['pincode'] = _pincodeController.text.trim();
    }
    if (_aadhaarController.text.trim().isNotEmpty) {
      body['aadhaar_number'] = _aadhaarController.text.trim();
    }
    if (_neededController.text.trim().isNotEmpty) {
      body['needed'] = _neededController.text.trim();
    }
    if (_selectedNgoId != null) body['ngo_id'] = _selectedNgoId;
    final disabilityPct = int.tryParse(_disabilityPctController.text.trim());
    if (_disabilityType != null && disabilityPct != null) {
      body['disabilities'] = [
        {
          'disability_type': _disabilityType,
          'disability_percentage': disabilityPct,
          'certificate_available':
              _docs.firstWhere((d) => d.type == _DocType.disability).base64 !=
                  null ||
              _existingCount(_DocType.disability) > 0,
        },
      ];
    }

    final id = widget.beneficiary['id'];
    final problems = <String>[];
    Map<String, dynamic> updated = widget.beneficiary;

    try {
      final result = await ApiService.patch('/beneficiaries/$id', body: body);
      updated = Map<String, dynamic>.from(
          result['beneficiary'] ?? widget.beneficiary);

      // Documents go up one at a time, the way the registration page does it.
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
              await Future<void>.delayed(
                  Duration(milliseconds: 800 * attempt));
            }
          }
        }
        if (!ok) problems.add('Could not upload ${doc.label}');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      showAppSnackbar(
          context, e.toString().replaceFirst('Exception: ', ''), error: true);
      return;
    }

    if (!mounted) return;
    setState(() {
      _loading = false;
      for (final doc in _docs) {
        doc.base64 = null;
        doc.name = null;
      }
    });

    if (problems.isEmpty) {
      showAppSnackbar(context, 'Beneficiary updated', success: true);
    } else {
      showAppSnackbar(
          context, 'Saved. ${problems.join('. ')}', warning: true);
    }
    Navigator.of(context).pop(updated);
  }

  // ---- Form ---------------------------------------------------------------

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(now.year - 30),
      firstDate: DateTime(1900),
      lastDate: now,
    );
    if (picked != null) {
      setState(() {
        _dob = picked;
        _dobController.text = _formatDob(picked);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(title: const Text('Complete Record')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
          children: [
            _identityCard(),
            const SizedBox(height: 20),
            const SectionHeader(title: 'Personal Information'),
            const SizedBox(height: 16),
            TextFormField(
              controller: _fullNameController,
              decoration: const InputDecoration(labelText: 'Full Name *'),
              textCapitalization: TextCapitalization.words,
              enabled: !_loading,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Full name is required'
                  : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _mobileController,
              decoration: const InputDecoration(labelText: 'Mobile Number'),
              keyboardType: TextInputType.phone,
              maxLength: 10,
              enabled: !_loading,
            ),
            const SizedBox(height: 16),
            // Stacks on narrow phones so neither field gets squeezed.
            LayoutBuilder(
              builder: (context, box) {
                final genderField = DropdownButtonFormField2<String>(
                  valueListenable: ValueNotifier<String?>(_gender),
                  decoration: const InputDecoration(labelText: 'Gender'),
                  isExpanded: true,
                  items: _genderItems()
                      .map((g) =>
                          DropdownItem<String>(value: g, child: Text(g)))
                      .toList(),
                  onChanged: _loading ? null : (v) => setState(() => _gender = v),
                  buttonStyleData: const FormFieldButtonStyleData(
                    height: 52,
                    padding: EdgeInsets.only(left: 16, right: 8),
                  ),
                  iconStyleData: const IconStyleData(iconSize: 20),
                  dropdownStyleData: const DropdownStyleData(
                    maxHeight: 220,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.all(Radius.circular(12)),
                    ),
                  ),
                  menuItemStyleData: const MenuItemStyleData(
                    padding: EdgeInsets.symmetric(horizontal: 12),
                  ),
                );
                final dobField = GestureDetector(
                  onTap: _loading ? null : _pickDob,
                  child: AbsorbPointer(
                    child: TextFormField(
                      controller: _dobController,
                      readOnly: true,
                      decoration: const InputDecoration(
                        labelText: 'Date of Birth',
                        hintText: 'Select date',
                        suffixIcon: Icon(LucideIcons.calendar, size: 18),
                      ),
                    ),
                  ),
                );
                if (box.maxWidth < 320) {
                  return Column(
                    children: [
                      genderField,
                      const SizedBox(height: 16),
                      dobField,
                    ],
                  );
                }
                return Row(
                  children: [
                    Expanded(child: genderField),
                    const SizedBox(width: 12),
                    Expanded(child: dobField),
                  ],
                );
              },
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField2<String>(
              valueListenable: ValueNotifier<String?>(_beneficiaryType),
              decoration: const InputDecoration(labelText: 'Beneficiary Type'),
              isExpanded: true,
              items: _beneficiaryTypeItems()
                  .map((t) => DropdownItem<String>(
                        value: t,
                        child: Text(t, overflow: TextOverflow.ellipsis),
                      ))
                  .toList(),
              onChanged:
                  _loading ? null : (v) => setState(() => _beneficiaryType = v),
              buttonStyleData: const FormFieldButtonStyleData(
                height: 52,
                padding: EdgeInsets.only(left: 16, right: 8),
              ),
              iconStyleData: const IconStyleData(iconSize: 20),
              dropdownStyleData: const DropdownStyleData(
                maxHeight: 280,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.all(Radius.circular(12)),
                ),
              ),
              menuItemStyleData: const MenuItemStyleData(
                padding: EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _occupationController,
              decoration: const InputDecoration(labelText: 'Occupation'),
              textCapitalization: TextCapitalization.words,
              enabled: !_loading,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _aadhaarController,
              decoration: const InputDecoration(
                labelText: 'Aadhaar Number',
                helperText: 'Scan the Aadhaar card below to fill this in',
              ),
              keyboardType: TextInputType.number,
              maxLength: 12,
              enabled: !_loading,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _locationController,
              decoration: const InputDecoration(labelText: 'Location'),
              textCapitalization: TextCapitalization.words,
              maxLines: 2,
              enabled: !_loading,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _cityController,
                    decoration: const InputDecoration(labelText: 'City'),
                    textCapitalization: TextCapitalization.words,
                    enabled: !_loading,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _stateController,
                    decoration: const InputDecoration(labelText: 'State'),
                    textCapitalization: TextCapitalization.words,
                    enabled: !_loading,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _pincodeController,
              decoration:
                  const InputDecoration(labelText: 'Pincode', counterText: ''),
              keyboardType: TextInputType.number,
              maxLength: 6,
              enabled: !_loading,
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
              enabled: !_loading,
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
              onChanged: _loading ? null : (v) => setState(() => _selectedNgoId = v),
              validator: (v) => v == null ? 'Please select an NGO' : null,
              buttonStyleData: const FormFieldButtonStyleData(
                height: 52,
                padding: EdgeInsets.only(left: 16, right: 8),
              ),
              iconStyleData: const IconStyleData(iconSize: 20),
              dropdownStyleData: const DropdownStyleData(
                maxHeight: 240,
                padding: EdgeInsets.symmetric(vertical: 4),
              ),
              menuItemStyleData: const MenuItemStyleData(
                padding: EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
            const SizedBox(height: 24),

            // Disability — optional, because an imported record may legitimately
            // not have it yet and the operator may be here for another reason.
            DropdownButtonFormField2<String>(
              valueListenable: ValueNotifier<String?>(_disabilityType),
              decoration: const InputDecoration(
                labelText: 'Disability Type',
                helperText: 'Fill in if known',
              ),
              hint: const Text('Select disability type'),
              items: _disabilityItems()
                  .map((t) => DropdownItem<String>(
                        value: t,
                        child: Text(t, overflow: TextOverflow.ellipsis),
                      ))
                  .toList(),
              isExpanded: true,
              onChanged:
                  _loading ? null : (v) => setState(() => _disabilityType = v),
              buttonStyleData: const FormFieldButtonStyleData(
                height: 52,
                padding: EdgeInsets.only(left: 16, right: 8),
              ),
              iconStyleData: const IconStyleData(iconSize: 20),
              dropdownStyleData: const DropdownStyleData(
                maxHeight: 260,
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
                labelText: 'Disability Percentage (%)',
                helperText: 'Fill in if known',
                counterText: '',
              ),
              keyboardType: TextInputType.number,
              maxLength: 3,
              enabled: !_loading,
              validator: (v) {
                final raw = (v ?? '').trim();
                if (raw.isEmpty) return null;
                final n = int.tryParse(raw);
                if (n == null || n < 1 || n > 100) {
                  return 'Enter a percentage between 1-100';
                }
                return null;
              },
            ),
            const SizedBox(height: 28),

            // Photo
            const SectionHeader(title: 'Photo'),
            const SizedBox(height: 16),
            _photoSection(),
            const SizedBox(height: 28),

            // Documents
            const SectionHeader(title: 'Documents'),
            const SizedBox(height: 16),
            ..._documentsSection(),
            const SizedBox(height: 28),

            // Fingerprints
            const SectionHeader(title: 'Fingerprints'),
            const SizedBox(height: 6),
            const Text(
              'Scan anything not already on file. Saved as you scan.',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 16),
            _fingerprintsSection(),
            const SizedBox(height: 28),

            SizedBox(
              child: ElevatedButton.icon(
                onPressed: _loading ? null : _submit,
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
                    : const Icon(Icons.save_outlined, size: 18),
                label: Text(_loading ? 'Saving...' : 'Save Record'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _identityCard() {
    final code = _code;
    final name = _fullNameController.text.trim();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppTheme.radiusCard,
        boxShadow: AppTheme.cardShadow,
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 24,
            backgroundColor: AppColors.primaryBlueSoft,
            child: Text(
              name.isNotEmpty ? name[0].toUpperCase() : '?',
              style: const TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w700,
                color: AppColors.primaryBlue,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name.isEmpty ? 'Name not filled' : name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  code.isEmpty ? 'No beneficiary code' : code,
                  style: const TextStyle(
                      fontSize: 12.5, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }


  // ---- Photo --------------------------------------------------------------

  /// Captures the beneficiary's photo with the plain camera (no document scan
  /// effect) and stores it small enough to keep in the record's `photo` column.
  Future<void> _pickPhoto() async {
    if (_loading) return;
    final bytes = await Navigator.push<Uint8List>(
      context,
      MaterialPageRoute(
        builder: (_) => const CameraCapturePage(
          hint: 'Frame the face and capture',
          captureLabel: 'Capture Photo',
        ),
      ),
    );
    if (bytes == null || bytes.isEmpty || !mounted) return;
    setState(() => _photoBusy = true);
    try {
      final dataUrl = await compute(photoDataUrl, bytes);
      if (!mounted) return;
      setState(() => _photo = dataUrl);
    } catch (e) {
      if (!mounted) return;
      showAppSnackbar(context, 'Could not use that photo: $e', error: true);
    } finally {
      if (mounted) setState(() => _photoBusy = false);
    }
  }

  Widget _photoSection() {
    final has = _photo != null && _photo!.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: has
                  ? Image.memory(
                      dataUrlBytes(_photo!),
                      width: 64,
                      height: 64,
                      fit: BoxFit.cover,
                      gaplessPlayback: true,
                      errorBuilder: (_, _, _) => const PhotoPlaceholder(),
                    )
                  : const PhotoPlaceholder(),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Photo',
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    has ? 'Attached to this record' : 'No photo on file',
                    style: const TextStyle(
                        fontSize: 11, color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: _loading || _photoBusy ? null : _pickPhoto,
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 36),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    icon: _photoBusy
                        ? const SkeletonBox(
                            width: 14,
                            height: 14,
                            borderRadius: 7,
                            baseColor: Color(0x262563EB),
                            shineColor: Color(0xFF2563EB),
                          )
                        : Icon(
                            has ? LucideIcons.camera : LucideIcons.userCircle,
                            size: 15,
                            color: AppColors.primaryBlue,
                          ),
                    label: Text(
                      has ? 'Replace photo' : 'Add photo',
                      style: const TextStyle(fontSize: 12.5),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  List<Widget> _documentsSection() {
    if (_loadingFiles) {
      return const [
        SkeletonCardRows(rows: 3, leadingSize: 32, leadingRadius: 8),
      ];
    }
    return [
      if (_loadFilesError != null)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text(
            'Could not check documents already on file ($_loadFilesError). '
            'You can still add one below.',
            style: const TextStyle(
                fontSize: 11.5, color: AppColors.textSecondary),
          ),
        ),
      InkWell(
        onTap: _loading ? null : _uploadDocument,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.dashedBorder),
          ),
          child: const Column(
            children: [
              Icon(Icons.upload_rounded, size: 26, color: AppColors.primaryBlue),
              SizedBox(height: 8),
              Text(
                'Add a document',
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
      const SizedBox(height: 12),
      ..._docs.map((d) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _docStatusRow(d),
          )),
    ];
  }

  Widget _docStatusRow(_PendingDoc doc) {
    final attached = doc.base64 != null;
    final existing = _existingCount(doc.type);
    final filed = attached || existing > 0;
    final subtitle = attached
        ? 'Ready to upload on save'
        : existing > 0
            ? '$existing on file'
            : 'Not on file yet';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(
            filed ? LucideIcons.checkCircle : LucideIcons.camera,
            size: 18,
            color: filed ? AppColors.successGreen : AppColors.textTertiary,
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
                  subtitle,
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
          if (attached)
            IconButton(
              onPressed: _loading
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

  Widget _fingerprintsSection() {
    if (_loadingFiles) {
      return const SkeletonCardRows(rows: 1, leadingSize: 32, leadingRadius: 8);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_enrolledFingerLabels.isNotEmpty) ...[
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _enrolledFingerLabels
                .map((f) => Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: AppColors.successGreenSoft,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(LucideIcons.checkCircle,
                              size: 13, color: AppColors.successGreen),
                          const SizedBox(width: 6),
                          Text(
                            f,
                            style: const TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.successGreen,
                            ),
                          ),
                        ],
                      ),
                    ))
                .toList(),
          ),
          const SizedBox(height: 12),
        ],
        if (_code.isEmpty)
          const Text(
            'This record has no beneficiary code, so fingerprints cannot be '
            'enrolled against it yet.',
            style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
          )
        else
          FingerprintEnrollPanel(
            beneficiaryCode: _code,
            beneficiaryName: _fullNameController.text.trim(),
            alreadyEnrolledFingers: _enrolledFingers,
          ),
      ],
    );
  }

  // ---- NGO dropdown -------------------------------------------------------

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

  Set<String> _ngoIdSet() {
    final ids = <String>{};
    for (final n in _ngos) {
      final id = n['id']?.toString() ?? '';
      if (id.isNotEmpty) ids.add(id);
    }
    return ids;
  }
}

class _PendingDoc {
  final _DocType type;
  final String label;
  String? base64;
  String? name;

  _PendingDoc({required this.type, required this.label});
}
