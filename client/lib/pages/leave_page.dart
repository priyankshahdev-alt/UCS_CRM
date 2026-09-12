import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:intl/intl.dart';
import 'package:image_picker/image_picker.dart';
import '../services/api_service.dart';
import '../services/realtime_service.dart';
import '../main.dart';
import '../widgets/skeleton_loader.dart';
import '../utils/responsive.dart';

class LeavePage extends StatefulWidget {
  final ScrollController? scrollController;
  const LeavePage({super.key, this.scrollController});

  @override
  State<LeavePage> createState() => _LeavePageState();
}

class _LeavePageState extends State<LeavePage> {
  String? _selectedType;
  final _leaveDateCtrl = TextEditingController();
  final _startDateCtrl = TextEditingController();
  final _endDateCtrl = TextEditingController();
  final _reasonCtrl = TextEditingController();
  TimeOfDay? _halfStartTime;
  TimeOfDay? _halfEndTime;
  bool _showSuccess = false;
  bool _submitting = false;
  List<dynamic> _leaves = [];
  bool _loadingLeaves = true;

  String? _proofBase64;
  String? _proofMime;
  String? _proofFileName;

  void _onRealtimeChange() {
    if (RealtimeService.instance.lastEvent == RealtimeEvent.leaves) {
      _fetchLeaves();
    }
  }

  final Map<String, String> _typeLabels = {
    'full_day': 'Full Day',
    'half_day': 'Half Day',
    'vacational': 'Vacational',
    'emergency': 'Emergency',
  };

  @override
  void initState() {
    super.initState();
    _fetchLeaves();
    RealtimeService.instance.addListener(_onRealtimeChange);
  }

  @override
  void dispose() {
    RealtimeService.instance.removeListener(_onRealtimeChange);
    _leaveDateCtrl.dispose();
    _startDateCtrl.dispose();
    _endDateCtrl.dispose();
    _reasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchLeaves() async {
    try {
      final leaves = await ApiService.getMyLeaves();
      setState(() { _leaves = leaves; _loadingLeaves = false; });
    } catch (_) {
      setState(() => _loadingLeaves = false);
    }
  }

  int _daysFromNow(DateTime date) {
    final now = DateTime.now();
    final target = DateTime(date.year, date.month, date.day);
    final today = DateTime(now.year, now.month, now.day);
    return target.difference(today).inDays;
  }

  String? _validateForm() {
    if (_selectedType == null) return 'Please select a leave type';

    if (_selectedType == 'full_day') {
      if (_leaveDateCtrl.text.isEmpty) return 'Please select a leave date';
      final date = DateTime.tryParse(_leaveDateCtrl.text);
      if (date == null) return 'Invalid date';
      if (_daysFromNow(date) < 2) return 'Full day leave must be applied at least 2 days prior';
    } else if (_selectedType == 'half_day') {
      if (_leaveDateCtrl.text.isEmpty) return 'Please select a leave date';
      if (_halfStartTime == null) return 'Please select start time';
      if (_halfEndTime == null) return 'Please select end time';
      final date = DateTime.tryParse(_leaveDateCtrl.text);
      if (date == null) return 'Invalid date';
      if (_daysFromNow(date) < 1) return 'Half day leave must be applied at least 1 day prior';
    } else if (_selectedType == 'vacational') {
      if (_startDateCtrl.text.isEmpty) return 'Please select start date';
      if (_endDateCtrl.text.isEmpty) return 'Please select end date';
      final sd = DateTime.tryParse(_startDateCtrl.text);
      final ed = DateTime.tryParse(_endDateCtrl.text);
      if (sd == null || ed == null) return 'Invalid dates';
      if (ed.isBefore(sd)) return 'End date must be on or after start date';
      if (_daysFromNow(sd) < 0) return 'Start date cannot be in the past';
    } else if (_selectedType == 'emergency') {
      if (_leaveDateCtrl.text.isEmpty) return 'Please select a leave date';
      final date = DateTime.tryParse(_leaveDateCtrl.text);
      if (date == null) return 'Invalid date';
    }
    if (_reasonCtrl.text.trim().isEmpty) return 'Please provide a reason';
    return null;
  }

  Future<void> _submitLeave() async {
    final error = _validateForm();
    if (error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error), backgroundColor: const Color(0xFFba1a1a)),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      final data = <String, dynamic>{'type': _selectedType, 'reason': _reasonCtrl.text.trim()};
      if (_selectedType == 'full_day') {
        data['leave_date'] = _leaveDateCtrl.text;
      } else if (_selectedType == 'half_day') {
        data['leave_date'] = _leaveDateCtrl.text;
        data['half_start_time'] = '${_halfStartTime!.hour.toString().padLeft(2, '0')}:${_halfStartTime!.minute.toString().padLeft(2, '0')}';
        data['half_end_time'] = '${_halfEndTime!.hour.toString().padLeft(2, '0')}:${_halfEndTime!.minute.toString().padLeft(2, '0')}';
      } else if (_selectedType == 'vacational') {
        data['start_date'] = _startDateCtrl.text;
        data['end_date'] = _endDateCtrl.text;
      } else if (_selectedType == 'emergency') {
        data['leave_date'] = _leaveDateCtrl.text;
      }

      if (_proofBase64 != null) {
        data['proof_data'] = _proofBase64;
        data['proof_mime'] = _proofMime;
      }

      await ApiService.applyLeave(data);
      if (!mounted) return;
      setState(() { _showSuccess = true; _submitting = false; });
      _fetchLeaves();
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: const Color(0xFFba1a1a)),
      );
    }
  }

  void _resetForm() {
    setState(() {
      _showSuccess = false;
      _selectedType = null;
      _leaveDateCtrl.clear();
      _startDateCtrl.clear();
      _endDateCtrl.clear();
      _reasonCtrl.clear();
      _halfStartTime = null;
      _halfEndTime = null;
      _proofBase64 = null;
      _proofMime = null;
      _proofFileName = null;
    });
  }

  DateTime _minDateForType() {
    final today = DateTime(DateTime.now().year, DateTime.now().month, DateTime.now().day);
    if (_selectedType == 'full_day') return today.add(const Duration(days: 2));
    if (_selectedType == 'half_day') return today.add(const Duration(days: 1));
    return today;
  }

  Future<void> _pickDate(TextEditingController ctrl, {DateTime? minDate}) async {
    final first = minDate ?? _minDateForType();
    final d = await showDatePicker(
      context: context,
      initialDate: first,
      firstDate: first,
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d != null) {
      setState(() => ctrl.text = DateFormat('yyyy-MM-dd').format(d));
    }
  }

  Future<void> _pickTime(TimeOfDay? current, bool isStart) async {
    final t = await showTimePicker(
      context: context,
      initialTime: current ?? const TimeOfDay(hour: 9, minute: 0),
    );
    if (t != null) {
      setState(() {
        if (isStart) _halfStartTime = t;
        else _halfEndTime = t;
      });
    }
  }

  Future<void> _pickProof() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, maxWidth: 1920);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    setState(() {
      _proofBase64 = base64Encode(bytes);
      _proofMime = file.mimeType ?? 'image/jpeg';
      _proofFileName = file.name;
    });
  }

  void _removeProof() {
    setState(() {
      _proofBase64 = null;
      _proofMime = null;
      _proofFileName = null;
    });
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'approved': return const Color(0xFF1D7A4F);
      case 'rejected': return const Color(0xFFC0392B);
      default: return const Color(0xFF7A4900);
    }
  }

  Color _statusBg(String status) {
    switch (status) {
      case 'approved': return const Color(0xFFE6F6ED);
      case 'rejected': return const Color(0xFFFDEAEA);
      default: return const Color(0xFFFFF3E0);
    }
  }

  String _formatDate(dynamic d) {
    if (d == null) return '';
    final dt = DateTime.tryParse(d.toString());
    if (dt == null) return d.toString();
    return DateFormat('dd MMM yyyy').format(dt);
  }

  String _leaveDates(dynamic l) {
    final type = l['type'] ?? '';
    if (type == 'vacational') return 'From ${_formatDate(l['start_date'])} → To ${_formatDate(l['end_date'])}';
    if (type == 'holiday') return '${_formatDate(l['start_date'])} – ${_formatDate(l['end_date'])}';
    if (type == 'emergency') return '🔴 ${_formatDate(l['leave_date'])}';
    if (type == 'half_day') {
      final st = l['half_start_time']?.toString().substring(0, 5) ?? '';
      final et = l['half_end_time']?.toString().substring(0, 5) ?? '';
      return '${_formatDate(l['leave_date'])} · $st – $et';
    }
    return _formatDate(l['leave_date']);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<AppColors>()!;
    final scheme = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      body: SafeArea(child: Column(
        children: [
          SizedBox(height: Responsive.pad(context, 12)),
          Container(width: Responsive.pad(context, 48), height: Responsive.pad(context, 4),
            decoration: BoxDecoration(color: colors.surfaceContainerHighest, borderRadius: BorderRadius.circular(4))),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 16), vertical: Responsive.pad(context, 8)),
            child: Row(
              children: [
                Text('Attendance', style: tt.headlineSmall?.copyWith(fontWeight: FontWeight.w700, color: scheme.primary)),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              controller: widget.scrollController,
              padding: EdgeInsets.fromLTRB(Responsive.pad(context, 16), Responsive.pad(context, 8), Responsive.pad(context, 16), Responsive.pad(context, 80)),
              children: [
                _buildForm(colors, scheme, tt),
                SizedBox(height: Responsive.pad(context, 16)),
                _buildHistory(colors, scheme, tt),
              ],
            ),
          ),
        ],
      )),
    );
  }

  Widget _buildForm(AppColors colors, ColorScheme scheme, TextTheme tt) {
    return Container(
      padding: EdgeInsets.all(Responsive.pad(context, 20)),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: _showSuccess ? _buildSuccess(colors, scheme, tt) : _buildFormContent(colors, scheme, tt),
    );
  }

  Widget _buildSuccess(AppColors colors, ColorScheme scheme, TextTheme tt) {
    return Column(
      children: [
        Icon(LucideIcons.circleCheck, size: Responsive.sp(context, 48), color: const Color(0xFF1D7A4F)),
        SizedBox(height: Responsive.pad(context, 8)),
        Text('Application Submitted', style: tt.headlineSmall?.copyWith(color: const Color(0xFF0D5535))),
        SizedBox(height: Responsive.pad(context, 4)),
        Text('Your manager will review and respond.', style: tt.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
        SizedBox(height: Responsive.pad(context, 12)),
        OutlinedButton(
          onPressed: _resetForm,
          style: OutlinedButton.styleFrom(
            foregroundColor: scheme.primary,
            side: BorderSide(color: scheme.primary),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
          child: const Text('Apply for another'),
        ),
      ],
    );
  }

  Widget _buildFormContent(AppColors colors, ColorScheme scheme, TextTheme tt) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Apply for leave', style: tt.headlineSmall?.copyWith(color: scheme.onSurface)),
        SizedBox(height: Responsive.pad(context, 24)),
        _label(tt, 'Leave type', colors),
        SizedBox(height: Responsive.pad(context, 8)),
        DropdownButtonFormField<String>(
          value: _selectedType,
          decoration: InputDecoration(
            hintText: 'Select type...',
            hintStyle: TextStyle(fontSize: Responsive.sp(context, 14), color: scheme.onSurfaceVariant),
            filled: true,
            fillColor: colors.surfaceContainerLowest,
            contentPadding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 16), vertical: Responsive.pad(context, 14)),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: const Color(0xFFDDDDDD)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: const Color(0xFFDDDDDD)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: scheme.primary, width: 1.5),
            ),
            suffixIcon: Icon(LucideIcons.chevronDown, color: scheme.onSurfaceVariant),
          ),
          items: ['full_day', 'half_day', 'vacational', 'emergency'].map((t) => DropdownMenuItem(
            value: t,
            child: Text(_typeLabels[t]!, style: TextStyle(fontSize: Responsive.sp(context, 14), color: scheme.onSurface)),
          )).toList(),
          onChanged: (v) => setState(() {
            _selectedType = v;
            _leaveDateCtrl.clear();
            _startDateCtrl.clear();
            _endDateCtrl.clear();
            _halfStartTime = null;
            _halfEndTime = null;
            _proofBase64 = null;
            _proofMime = null;
            _proofFileName = null;
          }),
        ),
        if (_selectedType == 'full_day') ...[
          SizedBox(height: Responsive.pad(context, 16)), _label(tt, 'Leave date', colors), SizedBox(height: Responsive.pad(context, 8)),
          _dateField(_leaveDateCtrl, colors, scheme),
          Padding(
            padding: EdgeInsets.only(top: Responsive.pad(context, 4)),
            child: Text('Must be at least 2 days prior',
              style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant)),
          ),
        ],
        if (_selectedType == 'half_day') ...[
          SizedBox(height: Responsive.pad(context, 16)), _label(tt, 'Leave date', colors), SizedBox(height: Responsive.pad(context, 8)),
          _dateField(_leaveDateCtrl, colors, scheme),
          SizedBox(height: Responsive.pad(context, 16)), _label(tt, 'Start time', colors), SizedBox(height: Responsive.pad(context, 8)),
          _timeField(colors, scheme, _halfStartTime, true),
          SizedBox(height: Responsive.pad(context, 16)), _label(tt, 'End time', colors), SizedBox(height: Responsive.pad(context, 8)),
          _timeField(colors, scheme, _halfEndTime, false),
          Padding(
            padding: EdgeInsets.only(top: Responsive.pad(context, 4)),
            child: Text('Must be at least 1 day prior',
              style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant)),
          ),
        ],
        if (_selectedType == 'vacational') ...[
          SizedBox(height: Responsive.pad(context, 16)), _label(tt, 'From date', colors), SizedBox(height: Responsive.pad(context, 8)),
          _dateField(_startDateCtrl, colors, scheme),
          SizedBox(height: Responsive.pad(context, 16)), _label(tt, 'To date', colors), SizedBox(height: Responsive.pad(context, 8)),
          _dateField(_endDateCtrl, colors, scheme, minDate: _startDateCtrl.text.isNotEmpty
              ? DateTime.tryParse(_startDateCtrl.text) : null),
          Padding(
            padding: EdgeInsets.only(top: Responsive.pad(context, 4)),
            child: Text('Can be applied anytime — from today onward',
              style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant)),
          ),
        ],
        if (_selectedType == 'emergency') ...[
          SizedBox(height: Responsive.pad(context, 16)), _label(tt, 'Leave date', colors), SizedBox(height: Responsive.pad(context, 8)),
          _dateField(_leaveDateCtrl, colors, scheme),
          Padding(
            padding: EdgeInsets.only(top: Responsive.pad(context, 4)),
            child: Text('Immediate emergency leave — no prior notice required',
              style: TextStyle(fontSize: Responsive.sp(context, 11), color: const Color(0xFFC0392B))),
          ),
        ],
        if (_selectedType != null && _selectedType != 'half_day') ...[
          SizedBox(height: Responsive.pad(context, 16)),
          _label(tt, 'Proof (optional)', colors),
          SizedBox(height: Responsive.pad(context, 8)),
          _buildProofUploader(colors, scheme),
        ],
        SizedBox(height: Responsive.pad(context, 16)),
        _label(tt, 'Reason', colors),
        SizedBox(height: Responsive.pad(context, 8)),
        TextField(
          controller: _reasonCtrl,
          maxLines: 4,
          decoration: InputDecoration(
            hintText: 'Briefly describe the reason for your leave...',
            hintStyle: TextStyle(fontSize: Responsive.sp(context, 14), color: scheme.onSurfaceVariant.withValues(alpha: 0.6)),
            filled: true,
            fillColor: colors.surfaceContainerLowest,
            contentPadding: EdgeInsets.all(Responsive.pad(context, 16)),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: const Color(0xFFDDDDDD)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: const Color(0xFFDDDDDD)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: scheme.primary, width: 1.5),
            ),
          ),
        ),
        SizedBox(height: Responsive.pad(context, 24)),
        SizedBox(
          width: double.infinity,
          height: Responsive.pad(context, 48),
          child: ElevatedButton(
            onPressed: _submitting ? null : _submitLeave,
            style: ElevatedButton.styleFrom(
              backgroundColor: scheme.primaryContainer,
              foregroundColor: scheme.onPrimary,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              elevation: 1,
            ),
            child: _submitting
                ? const ButtonSkeleton()
                : Text('Submit Application', style: TextStyle(fontSize: Responsive.sp(context, 14), fontWeight: FontWeight.w600, color: Colors.white)),
          ),
        ),
      ],
    );
  }

  Widget _label(TextTheme tt, String text, AppColors colors) {
    return Text(text, style: tt.labelMedium?.copyWith(color: colors.outline));
  }

  Widget _dateField(TextEditingController ctrl, AppColors colors, ColorScheme scheme, {DateTime? minDate}) {
    return GestureDetector(
      onTap: () => _pickDate(ctrl, minDate: minDate),
      child: Container(
        height: Responsive.pad(context, 48),
        padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 16)),
        decoration: BoxDecoration(
          color: colors.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFFDDDDDD)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                ctrl.text.isEmpty ? 'Select date' : ctrl.text,
                style: TextStyle(fontSize: Responsive.sp(context, 14), color: ctrl.text.isEmpty ? scheme.onSurfaceVariant.withValues(alpha: 0.6) : scheme.onSurface),
              ),
            ),
            SizedBox(width: Responsive.pad(context, 8)),
            Icon(LucideIcons.calendarDays, size: Responsive.sp(context, 18), color: scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }

  Widget _timeField(AppColors colors, ColorScheme scheme, TimeOfDay? time, bool isStart) {
    return GestureDetector(
      onTap: () => _pickTime(time, isStart),
      child: Container(
        height: Responsive.pad(context, 48),
        padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 16)),
        decoration: BoxDecoration(
          color: colors.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFFDDDDDD)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                time != null ? time.format(context) : 'Select time',
                style: TextStyle(fontSize: Responsive.sp(context, 14), color: time != null ? scheme.onSurface : scheme.onSurfaceVariant.withValues(alpha: 0.6)),
              ),
            ),
            SizedBox(width: Responsive.pad(context, 8)),
            Icon(LucideIcons.clock, size: Responsive.sp(context, 18), color: scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }

  Widget _buildProofUploader(AppColors colors, ColorScheme scheme) {
    return _proofBase64 != null
        ? Container(
            padding: EdgeInsets.all(Responsive.pad(context, 8)),
            decoration: BoxDecoration(
              color: colors.surfaceContainerLowest,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFDDDDDD)),
            ),
            child: Column(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Image.memory(
                    base64Decode(_proofBase64!),
                    height: Responsive.pad(context, 140),
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => SizedBox(height: Responsive.pad(context, 140),
                      child: const Center(child: Text('Failed to load preview'))),
                  ),
                ),
                SizedBox(height: Responsive.pad(context, 6)),
                Row(
                  children: [
                    Expanded(
                      child: Text(_proofFileName ?? 'Proof attached',
                        style: TextStyle(fontSize: Responsive.sp(context, 13), color: scheme.onSurface), overflow: TextOverflow.ellipsis),
                    ),
                    GestureDetector(
                      onTap: _removeProof,
                      child: Padding(
                        padding: EdgeInsets.only(left: Responsive.pad(context, 8)),
                        child: Icon(LucideIcons.x, size: Responsive.sp(context, 18), color: scheme.onSurfaceVariant),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          )
        : GestureDetector(
            onTap: _pickProof,
            child: Container(
              height: Responsive.pad(context, 48),
              decoration: BoxDecoration(
                color: colors.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFFDDDDDD)),
              ),
              child: Row(
                children: [
                  SizedBox(width: Responsive.pad(context, 12)),
                  Icon(LucideIcons.fileUp, size: Responsive.sp(context, 20), color: scheme.onSurfaceVariant),
                  SizedBox(width: Responsive.pad(context, 8)),
                  Text('Upload proof (image)',
                    style: TextStyle(fontSize: Responsive.sp(context, 13), color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
          );
  }

  Widget _buildHistory(AppColors colors, ColorScheme scheme, TextTheme tt) {
    return Container(
      padding: EdgeInsets.all(Responsive.pad(context, 20)),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('LEAVE HISTORY', style: tt.labelMedium?.copyWith(color: scheme.onSurfaceVariant, letterSpacing: 1.0)),
          SizedBox(height: Responsive.pad(context, 16)),
          if (_loadingLeaves)
            SkeletonLoader(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: List.generate(3, (_) => Padding(
                  padding: EdgeInsets.only(bottom: Responsive.pad(context, 16)),
                  child: Row(
                    children: [
                      SkeletonBlock(width: Responsive.pad(context, 36), height: Responsive.pad(context, 36), borderRadius: 10),
                      SizedBox(width: Responsive.pad(context, 12)),
                      Expanded(child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SkeletonBlock(height: Responsive.pad(context, 14), width: Responsive.pad(context, 120)),
                          SizedBox(height: Responsive.pad(context, 6)),
                          SkeletonBlock(height: Responsive.pad(context, 10), width: Responsive.pad(context, 200)),
                        ],
                      )),
                    ],
                  ),
                )),
              ),
            )
          else if (_leaves.isEmpty)
            _buildEmptyState(colors, scheme, tt)
          else
            ...(_leaves.take(20).toList()).map((l) => _leaveItem(l, colors, scheme, tt)),
        ],
      ),
    );
  }

  Widget _buildEmptyState(AppColors colors, ColorScheme scheme, TextTheme tt) {
    return SizedBox(
      width: double.infinity,
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 24)),
        child: Column(
          children: [
            Icon(LucideIcons.history, size: Responsive.sp(context, 48), color: scheme.onSurfaceVariant.withValues(alpha: 0.5)),
            SizedBox(height: Responsive.pad(context, 8)),
            Text('No leave applications yet', style: tt.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }

  Widget _leaveItem(dynamic l, AppColors colors, ColorScheme scheme, TextTheme tt) {
    final type = l['type'] ?? '';
    final typeLabel = _typeLabels[type] ?? type;
    final status = l['status'] ?? 'pending';
    final days = l['days'] ?? 0;
    final reason = l['reason'] ?? '';

    IconData icon;
    Color iconColor;
    Color iconBg;
    switch (type) {
      case 'vacational':
        icon = LucideIcons.plane; iconColor = scheme.primary; iconBg = colors.primaryFixed; break;
      case 'holiday':
        icon = LucideIcons.gift; iconColor = const Color(0xFF1D7A4F); iconBg = const Color(0xFFE6F6ED); break;
      case 'half_day':
        icon = LucideIcons.clock; iconColor = colors.onTertiaryFixedVariant; iconBg = colors.tertiaryFixed; break;
      case 'emergency':
        icon = LucideIcons.triangleAlert; iconColor = const Color(0xFFC0392B); iconBg = const Color(0xFFFDEAEA); break;
      default:
        icon = LucideIcons.calendar; iconColor = scheme.primary; iconBg = colors.primaryFixed; break;
    }

    return Container(
      padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 12)),
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: colors.surfaceVariant))),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: Responsive.pad(context, 36), height: Responsive.pad(context, 36),
            decoration: BoxDecoration(color: iconBg, borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: Responsive.sp(context, 18), color: iconColor),
          ),
          SizedBox(width: Responsive.pad(context, 12)),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(typeLabel, style: TextStyle(fontSize: Responsive.sp(context, 14), fontWeight: FontWeight.w500, color: scheme.onSurface)),
                SizedBox(height: Responsive.pad(context, 2)),
                Text('${_leaveDates(l)} · $days day${days > 1 ? 's' : ''}',
                  style: TextStyle(fontSize: Responsive.sp(context, 12), color: scheme.onSurfaceVariant)),
                if (reason.isNotEmpty) SizedBox(height: Responsive.pad(context, 2)),
                if (reason.isNotEmpty) Text(reason,
                  style: TextStyle(fontSize: Responsive.sp(context, 12), color: scheme.onSurfaceVariant)),
              ],
            ),
          ),
          Container(
            padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 10), vertical: Responsive.pad(context, 4)),
            decoration: BoxDecoration(color: _statusBg(status), borderRadius: BorderRadius.circular(20)),
            child: Text('${status[0].toUpperCase()}${status.substring(1)}',
              style: TextStyle(fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w500, color: _statusColor(status))),
          ),
        ],
      ),
    );
  }
}
