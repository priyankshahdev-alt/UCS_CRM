import 'package:dropdown_button2/dropdown_button2.dart';
import 'package:flutter/material.dart';

import '../../core/lucide_icons.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_snackbar.dart';
import '../../core/widgets/section_header.dart';
import '../../services/api_service.dart';

/// Edit screen for an existing beneficiary. Only the registration fields are
/// editable; fingerprints, Aadhaar number and document uploads are intentionally
/// left out of this screen. Pops with the updated beneficiary map on success.
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
  final _addressController = TextEditingController();
  final _pincodeController = TextEditingController();
  final _disabilityPctController = TextEditingController();

  final List<Map<String, dynamic>> _ngos = [];
  String? _selectedNgoId;

  String? _gender;
  DateTime? _dob;
  String? _disabilityType;
  bool _loading = false;

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

  @override
  void initState() {
    super.initState();
    final b = widget.beneficiary;
    _fullNameController.text = b['full_name']?.toString() ?? '';
    _mobileController.text = b['mobile']?.toString() ?? '';
    _occupationController.text = b['occupation']?.toString() ?? '';
    _neededController.text = b['needed']?.toString() ?? '';
    _addressController.text = b['address_line_1']?.toString() ?? '';
    _pincodeController.text = b['pincode']?.toString() ?? '';
    _gender = b['gender']?.toString();
    _dob = _parseDob(b['date_of_birth']?.toString());
    _selectedNgoId = b['ngo_id']?.toString();
    final list = b['disabilities'];
    if (list is List && list.isNotEmpty) {
      final d = list.first;
      if (d is Map) {
        _disabilityType = d['disability_type']?.toString();
        final pct = d['disability_percentage'];
        if (pct != null) _disabilityPctController.text = pct.toString();
      }
    }
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
    _disabilityPctController.dispose();
    super.dispose();
  }

  DateTime? _parseDob(String? v) {
    if (v == null) return null;
    final parts = v.split('-');
    if (parts.length != 3) return null;
    final y = int.tryParse(parts[0]);
    final m = int.tryParse(parts[1]);
    final d = int.tryParse(parts[2]);
    if (y == null || m == null || d == null) return null;
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

  Future<void> _submit() async {
    if (_loading) return;
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      final body = <String, dynamic>{
        'full_name': _fullNameController.text.trim(),
      };
      if (_mobileController.text.trim().isNotEmpty) {
        body['mobile'] = _mobileController.text.trim();
      }
      if (_dob != null) {
        body['date_of_birth'] =
            '${_dob!.year.toString().padLeft(4, '0')}-${_dob!.month.toString().padLeft(2, '0')}-${_dob!.day.toString().padLeft(2, '0')}';
      }
      if (_gender != null) body['gender'] = _gender;
      if (_occupationController.text.trim().isNotEmpty) {
        body['occupation'] = _occupationController.text.trim();
      }
      if (_addressController.text.trim().isNotEmpty) {
        body['address_line_1'] = _addressController.text.trim();
      }
      if (_pincodeController.text.trim().isNotEmpty) {
        body['pincode'] = _pincodeController.text.trim();
      }
      if (_neededController.text.trim().isNotEmpty) {
        body['needed'] = _neededController.text.trim();
      }
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

      final id = widget.beneficiary['id'];
      final result = await ApiService.patch('/beneficiaries/$id', body: body);
      if (!mounted) return;
      showAppSnackbar(context, 'Beneficiary updated', success: true);
      final updated = Map<String, dynamic>.from(result['beneficiary'] ?? {});
      Navigator.of(context).pop(updated);
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      showAppSnackbar(context, e.toString().replaceFirst('Exception: ', ''),
          error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Edit Beneficiary'),
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
              enabled: !_loading,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Full name is required' : null,
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
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField2<String>(
                    valueListenable: ValueNotifier<String?>(_gender),
                    decoration: const InputDecoration(labelText: 'Gender'),
                    items: ['Male', 'Female', 'Other']
                        .map((g) => DropdownItem<String>(value: g, child: Text(g)))
                        .toList(),
                    onChanged: _loading ? null : (v) => setState(() => _gender = v),
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
                    onTap: _loading ? null : _pickDob,
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
            TextFormField(
              controller: _addressController,
              decoration: const InputDecoration(labelText: 'Address'),
              textCapitalization: TextCapitalization.words,
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
              enabled: !_loading,
            ),
            const SizedBox(height: 16),
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
              onChanged: _loading ? null : (v) => setState(() => _disabilityType = v),
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
              enabled: !_loading,
              validator: (v) {
                final n = int.tryParse((v ?? '').trim());
                if (n == null || n < 1 || n > 100) {
                  return 'Enter a disability percentage between 1-100';
                }
                return null;
              },
            ),
            const SizedBox(height: 24),

            SizedBox(
              width: double.infinity,
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
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.addBeneficiaryText,
                        ),
                      )
                    : const Icon(Icons.save_outlined, size: 18),
                label: Text(_loading ? 'Saving...' : 'Save Changes'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}