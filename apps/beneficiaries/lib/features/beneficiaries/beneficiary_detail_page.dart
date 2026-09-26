import 'dart:math' as math;

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';

import '../../core/lucide_icons.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/app_snackbar.dart';
import '../../services/api_service.dart';
import 'edit_beneficiary_page.dart';

/// Spec-exact colors (JOD Beneficiary Detail Screen) not already in AppColors.
const Color _kAvatarBg = Color(0xFFEEF4FF);
const Color _kSoftGreen = Color(0xFFECF9F3);
const Color _kConnector = Color(0xFFDCEFE7);
const Color _kHistTs = Color(0xFF8A93A3);
const Color _kShowMoreBg = Color(0xFFF4F7FC);
const Color _kWarnBg = Color(0xFFFFF8EA);
const Color _kWarnBorder = Color(0xFFF4D9A5);
const Color _kWarnIcon = Color(0xFFC47A16);
const Color _kWarnText = Color(0xFF80500F);

class BeneficiaryDetailPage extends StatefulWidget {
  final Map<String, dynamic> beneficiary;

  /// Read-only presentation (no give-again accept/reject flow, no "give kit"
  /// swipe). Used by the kit-given list on the home screen.
  final bool readOnly;

  const BeneficiaryDetailPage({
    super.key,
    required this.beneficiary,
    this.readOnly = false,
  });

  @override
  State<BeneficiaryDetailPage> createState() => _BeneficiaryDetailPageState();
}

class _BeneficiaryDetailPageState extends State<BeneficiaryDetailPage> {
  static const int _initialHistoryRows = 3;

  late Map<String, dynamic> _b;
  bool _markingKit = false;
  bool _decisionAccepted = false;
  bool _rejected = false;
  bool _justGiven = false;
  bool _acceptedFlash = false;
  bool _decisionPrompted = false;
  bool _historyExpanded = false;
  List<Map<String, dynamic>> _kitHistory = [];
  late final AudioPlayer _player;

  @override
  void initState() {
    super.initState();
    _b = widget.beneficiary;
    _player = AudioPlayer();
    if (_b['id'] != null) _refresh();
    if (!widget.readOnly) _maybePromptDecision();
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final id = _b['id'];
    if (id == null) return;
    try {
      final result = await ApiService.get('/beneficiaries/$id');
      if (mounted) setState(() => _b = result);
    } catch (_) {}
    try {
      final audit = await ApiService.getList('/beneficiaries/$id/audit');
      if (!mounted) return;
      final logs = audit
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .where((e) => e['action'] == 'KIT_GIVEN')
          .toList();
      setState(() => _kitHistory = logs);
    } catch (_) {}
  }

  // ---- kit eligibility ----------------------------------------------------

  // Tolerant check: `kit_given` may be a boolean, a 'true' string, or absent
  // on some lookup paths (QR/mobile). A non-empty `kit_given_at` also counts.
  bool get _kitGiven {
    final v = _b['kit_given'];
    if (v == true) return true;
    if (v is num && v == 1) return true;
    if (v is String) {
      final s = v.trim().toLowerCase();
      if (s == 'true' || s == '1' || s == 't' || s == 'yes') return true;
    }
    final at = _b['kit_given_at'];
    return at != null && at.toString().trim().isNotEmpty;
  }

  String get _kitGivenAt => _fmt(_b['kit_given_at']);

  bool get _active {
    final s = _b['status'];
    return s == null || s.toString().trim().toUpperCase() == 'ACTIVE';
  }

  // ---- actions ------------------------------------------------------------

  void _reject() {
    if (_markingKit) return;
    setState(() => _rejected = true);
    showAppSnackbar(context, 'Rejected — no kit given');
  }

  void _accept() {
    if (_markingKit) return;
    setState(() => _decisionAccepted = true);
  }

  // When the kit was already collected, pop the accept/reject sheet once.
  void _maybePromptDecision() {
    if (_decisionPrompted ||
        _justGiven ||
        _decisionAccepted ||
        _rejected ||
        !_kitGiven) {
      return;
    }
    _decisionPrompted = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _showDecisionSheet();
    });
  }

  Future<void> _showDecisionSheet() async {
    final nav = Navigator.of(context);
    final accepted = await showModalBottomSheet<bool>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (didPop) return;
          // System back closes the sheet and leaves to the main screen —
          // it must not re-ask the same question.
          nav.pop();
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) nav.maybePop();
          });
        },
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            24,
            20,
            24,
            24 + MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFE4E7EC),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 20),
              Container(
                width: 52,
                height: 52,
                decoration: const BoxDecoration(
                  color: AppColors.successGreenSoft,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: const Icon(
                  LucideIcons.package,
                  size: 26,
                  color: AppColors.successGreen,
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Already collected',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'This person has already collected the kit'
                '${_kitGivenAt.isEmpty ? '' : ' on $_kitGivenAt'}.\n'
                'Do you want to give them the kit again?',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.45,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.black,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: () => Navigator.of(context).pop(true),
                  child: const Text(
                    'Accept',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: Colors.black,
                    side: const BorderSide(color: Colors.black, width: 1.5),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text(
                    'Reject',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted) return;
    // null comes from system back, already handled by PopScope above.
    if (accepted == true) {
      _accept();
    } else if (accepted == false) {
      _reject();
    }
  }

  Future<void> _markKitGiven() async {
    if (_markingKit) return;
    setState(() => _markingKit = true);
    try {
      final result = await ApiService.post(
        '/beneficiaries/${_b['id']}/kit-given',
        // Reaching this swipe already means the operator chose to give again,
        // so always pass the override when the kit was given before. This
        // avoids the 3-month guard erroring out with a toast.
        body: _kitGiven ? {'override': true} : null,
      );
      if (!mounted) return;
      setState(() {
        final res = result['beneficiary'];
        if (res is Map) {
          _b = Map<String, dynamic>.from(res);
        } else {
          _b['kit_given'] = true;
          _b['kit_given_at'] = DateTime.now().toIso8601String();
        }
        _justGiven = true;
        _decisionAccepted = true;
        _acceptedFlash = true;
        _playDoneSound();
        _kitHistory = [
          {
            'action': 'KIT_GIVEN',
            'performed_at': DateTime.now().toIso8601String(),
            'performed_by': '',
          },
          ..._kitHistory,
        ];
      });
      _refresh();
      showAppSnackbar(context, 'Kit marked as given', success: true);
      Future<void>.delayed(const Duration(milliseconds: 1800), () {
        if (mounted) setState(() => _acceptedFlash = false);
      });
    } catch (e) {
      if (!mounted) return;
      // The 3-month guard message is a deliberate block, not an error we
      // should surface as a toast.
      if (e.toString().contains('already given')) {
        setState(() => _markingKit = false);
        return;
      }
      showAppSnackbar(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _markingKit = false);
    }
  }

  // Google-pay-style "done" chime right when the green flash appears.
  void _playDoneSound() {
    try {
      _player.stop();
      _player.play(AssetSource('audio/google_pay.mp3'));
    } catch (_) {
      // Sound is cosmetic; never block the give flow over audio.
    }
  }

  // ---- edit ----------------------------------------------------------------

  Future<void> _openEdit() async {
    if (_markingKit) return;
    final updated = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => EditBeneficiaryPage(beneficiary: _b),
      ),
    );
    if (updated == null || !mounted) return;
    setState(() => _b = updated);
    _refresh();
  }

  // ---- helpers ------------------------------------------------------------

  String _fmt(dynamic v) {
    if (v == null) return '';
    final s = v.toString();
    if (s.length >= 10 && s[4] == '-' && s[7] == '-') return s.substring(0, 10);
    return s;
  }

  String _fmtDateTime(dynamic v) {
    if (v == null) return '';
    var s = v.toString().trim().replaceAll('T', ' ').replaceAll('Z', '');
    if (s.length >= 16) return s.substring(0, 16);
    return s;
  }

  // ---- layout -------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    // Wrap the whole Scaffold so the acceptance flash can sweep the full
    // screen, header and all.
    return Stack(
      children: [
        Scaffold(
          backgroundColor: AppTheme.background,
          body: SafeArea(
            child: Column(
              children: [
                _buildHeader(),
                Expanded(child: _buildScrollBody()),
                _buildBottomArea(),
              ],
            ),
          ),
        ),
        if (_acceptedFlash) const _AcceptFlashOverlay(),
      ],
    );
  }

  Widget _buildHeader() {
    return SizedBox(
      height: 56,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Row(
          children: [
            IconButton(
              onPressed: () => Navigator.of(context).maybePop(),
              padding: EdgeInsets.zero,
              constraints:
                  const BoxConstraints(minWidth: 44, minHeight: 44),
              icon: const Icon(LucideIcons.arrowLeft, size: 24),
              color: AppColors.textPrimary,
            ),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'Beneficiary',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            if (!widget.readOnly)
              IconButton(
                onPressed: _openEdit,
                padding: EdgeInsets.zero,
                constraints:
                    const BoxConstraints(minWidth: 44, minHeight: 44),
                tooltip: 'Edit beneficiary',
                icon: const Icon(Icons.edit_outlined,
                    size: 21, color: AppColors.textPrimary),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildScrollBody() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildProfileCard(),
          const SizedBox(height: 24),
          _buildDetailsCard(),
          const SizedBox(height: 24),
          _buildHistoryCard(),
          if (_kitGiven && !_justGiven && !widget.readOnly) ...[
            const SizedBox(height: 24),
            _buildWarning(),
          ],
        ],
      ),
    );
  }

  // ---- profile card -------------------------------------------------------

  Widget _buildProfileCard() {
    final name = _b['full_name'] ?? '';
    final code = _b['beneficiary_code'] ?? '';
    final date = _fmt(_b['registration_date']);

    return _card(
      Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _avatar(name),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    code,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            if (date.isNotEmpty) ...[
              const SizedBox(width: 12),
              Flexible(child: _registrationDate(date)),
            ],
          ],
        ),
      ),
    );
  }

  Widget _avatar(String name) {
    return SizedBox(
      width: 64,
      height: 64,
      child: Stack(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: _kAvatarBg,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              name.isNotEmpty ? name[0].toUpperCase() : '?',
              style: const TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w600,
                color: AppColors.primaryBlue,
              ),
            ),
          ),
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _active ? AppColors.successGreen : AppColors.error,
                border: Border.all(color: Colors.white, width: 3),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _registrationDate(String date) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(LucideIcons.calendar, size: 15, color: AppColors.textSecondary),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            date,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
          ),
        ),
      ],
    );
  }

  // ---- details card ---------------------------------------------------------
  // Every registration-captured field except fingerprints, Aadhaar number and
  // document uploads — those stay out of this read-mostly screen.

  Widget _buildDetailsCard() {
    final rows = <(String, String)>[
      ('Date of Birth', _fmt(_b['date_of_birth'])),
      ('Gender', _b['gender']?.toString() ?? ''),
      ('Mobile', _b['mobile']?.toString() ?? ''),
      ('Occupation', _b['occupation']?.toString() ?? ''),
      ('Address', _address),
      ('Pincode', _b['pincode']?.toString() ?? ''),
      ('NGO', _ngoName),
      ('Disability', _disability),
      ('Needed', _b['needed']?.toString() ?? ''),
    ].where((r) => r.$2.isNotEmpty).toList();

    if (rows.isEmpty) return const SizedBox.shrink();

    return _card(
      Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Details',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 16),
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) const SizedBox(height: 12),
              _labelValueRow(rows[i].$1, rows[i].$2),
            ],
          ],
        ),
      ),
    );
  }

  String get _address {
    final parts = <String>[
      _b['address_line_1']?.toString() ?? '',
      _b['city']?.toString() ?? '',
      _b['state']?.toString() ?? '',
    ].where((p) => p.trim().isNotEmpty).toList();
    return parts.join(', ');
  }

  String get _ngoName {
    final ngo = _b['ngos'];
    if (ngo is Map) {
      final parts = <String>[
        ngo['name']?.toString() ?? '',
        ngo['code']?.toString() ?? '',
      ].where((p) => p.trim().isNotEmpty).toList();
      return parts.join(' • ');
    }
    return '';
  }

  String get _disability {
    final list = _b['disabilities'];
    if (list is! List || list.isEmpty) return '';
    final d = list.first;
    if (d is! Map) return '';
    final type = d['disability_type']?.toString() ?? '';
    final pct = d['disability_percentage']?.toString() ?? '';
    if (type.isEmpty && pct.isEmpty) return '';
    final val = [type, pct.isNotEmpty ? '$pct%' : '']
        .where((p) => p.isNotEmpty)
        .join(' — ');
    return val;
  }

  Widget _labelValueRow(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 96,
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 14,
              height: 1.3,
              fontWeight: FontWeight.w500,
              color: AppColors.textPrimary,
            ),
          ),
        ),
      ],
    );
  }

  // ---- history card -------------------------------------------------------

  // Every kit handed out to this beneficiary, newest first. Kits are recorded
  // as `KIT_GIVEN` audit entries; if the trail is somehow empty we still
  // surface the beneficiary's own kit_given_at so History never lies.
  List<Map<String, dynamic>> get _historyEntries {
    if (_kitHistory.isNotEmpty) return _kitHistory;
    final at = _b['kit_given_at'];
    if (at != null && at.toString().trim().isNotEmpty) {
      return [
        {
          'action': 'KIT_GIVEN',
          'performed_at': at,
          'performed_by': _b['kit_given_by'],
          'details': null,
        },
      ];
    }
    return const [];
  }

  String _historyGivenBy(Map<String, dynamic> entry) {
    final by = entry['performed_by']?.toString().trim();
    if (by == null || by.isEmpty || by.toLowerCase() == 'system') return '';
    return by;
  }

  Widget _buildHistoryCard() {
    final entries = _historyEntries;
    final n = entries.length;
    final visible = _historyExpanded
        ? entries
        : entries.take(_initialHistoryRows).toList();
    final showToggle = n > _initialHistoryRows;

    return _card(
      Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'History',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
                if (n > 0) _countBadge(n),
              ],
            ),
            const SizedBox(height: 16),
            if (n == 0)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  'No kit handed out yet.',
                  style: TextStyle(fontSize: 13.5, color: AppColors.textSecondary),
                ),
              )
            else ...[
              AnimatedSize(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeOut,
                alignment: Alignment.topCenter,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (var i = 0; i < visible.length; i++)
                      _historyRow(visible[i], notLast: i < visible.length - 1),
                  ],
                ),
              ),
              if (showToggle) ...[
                const SizedBox(height: 14),
                _showMoreToggle(),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Widget _countBadge(int n) {
    final label = '$n kit${n == 1 ? '' : 's'} given';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: _kAvatarBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(LucideIcons.package, size: 14, color: AppColors.primaryBlue),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.primaryBlue,
            ),
          ),
        ],
      ),
    );
  }

  Widget _historyRow(Map<String, dynamic> entry, {required bool notLast}) {
    final name = _historyEventName(entry);
    final at = _fmtDateTime(entry['performed_at']);
    final by = _historyGivenBy(entry);
    // IntrinsicHeight gives the stretch Row a bounded height even when
    // AnimatedSize measures its child with an unbounded max height; without
    // it the constraining assertions throw and the whole card fails to lay
    // out for any beneficiary with kit history.
    return IntrinsicHeight(
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 32,
            child: Column(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: const BoxDecoration(
                    color: _kSoftGreen,
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: const Icon(
                    LucideIcons.check,
                    size: 16,
                    color: AppColors.successGreen,
                  ),
                ),
                if (notLast)
                  Expanded(
                    child: Center(
                      child: Container(width: 1, color: _kConnector),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(LucideIcons.calendar,
                          size: 13, color: _kHistTs),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    at,
                    style: const TextStyle(fontSize: 12.5, color: _kHistTs),
                  ),
                  if (by.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        const Icon(LucideIcons.user,
                            size: 12, color: _kHistTs),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            by,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              color: _kHistTs,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          ],
        ),
      ),
    );
  }

  // The backend stores the operator's event name in the audit log `details`
  // for each KIT_GIVEN entry.
  String _historyEventName(Map<String, dynamic> entry) {
    final details = entry['details'];
    if (details is Map) {
      final n = details['event_name']?.toString().trim();
      if (n != null && n.isNotEmpty && n.toLowerCase() != 'null') return n;
    }
    return 'Kit Given';
  }

  Widget _showMoreToggle() {
    final expanded = _historyExpanded;
    return SizedBox(
      height: 44,
      width: double.infinity,
      child: Material(
        color: _kShowMoreBg,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => setState(() => _historyExpanded = !_historyExpanded),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                expanded ? 'Show Less' : 'Show More',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.primaryBlue,
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                expanded ? LucideIcons.chevronUp : LucideIcons.chevronDown,
                size: 16,
                color: AppColors.primaryBlue,
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ---- warning ------------------------------------------------------------

  Widget _buildWarning() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: _kWarnBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kWarnBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(LucideIcons.alertTriangle, size: 18, color: _kWarnIcon),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Kit already given on $_kitGivenAt.\n'
              'Would you still want to give this beneficiary the kit?',
              style: const TextStyle(fontSize: 13, height: 1.4, color: _kWarnText),
            ),
          ),
        ],
      ),
    );
  }

  // ---- bottom area --------------------------------------------------------

  // After a successful give the slider is replaced by a confirmation label;
  // after Reject a persistent banner; otherwise the decision sheet owns the
  // screen (nothing pinned) until the delegate picks.
  Widget _buildBottomArea() {
    if (widget.readOnly) return const SizedBox.shrink();
    if (_justGiven) {
      return const Padding(
        padding: EdgeInsets.fromLTRB(24, 14, 24, 24),
        child: _GivenBanner(),
      );
    }
    if (_rejected) {
      return const Padding(
        padding: EdgeInsets.fromLTRB(24, 14, 24, 24),
        child: _RejectBanner(),
      );
    }
    final blocked = _kitGiven && !_justGiven && !_decisionAccepted;
    if (blocked) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 14, 24, 24),
      child: _GiveSwipe(onConfirm: _markKitGiven, busy: _markingKit),
    );
  }

  // ---- shared card --------------------------------------------------------

  Widget _card(Widget child) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        boxShadow: AppTheme.cardShadow,
      ),
      child: child,
    );
  }
}

/// Full-screen green circle that expands from the bottom-right corner and
/// covers the entire screen (header included), showing the verified
/// badge-check "done" animation.
class _AcceptFlashOverlay extends StatefulWidget {
  const _AcceptFlashOverlay();

  @override
  State<_AcceptFlashOverlay> createState() => _AcceptFlashOverlayState();
}

class _AcceptFlashOverlayState extends State<_AcceptFlashOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 650),
  )..forward();
  late final Animation<double> _scale =
      CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final w = constraints.maxWidth;
          final h = constraints.maxHeight;
          // Diameter large enough that the circle, grown from the corner,
          // guarantees full-screen coverage.
          final cover = 2 * math.sqrt(w * w + h * h);

          return AnimatedBuilder(
            animation: _scale,
            builder: (context, child) {
              final t = _scale.value;
              final d = t * cover;
              final contentAlpha = ((t - 0.4) / 0.5).clamp(0.0, 1.0).toDouble();
              return Stack(
                clipBehavior: Clip.hardEdge,
                children: [
                  Positioned(
                    right: -d / 2,
                    bottom: -d / 2,
                    child: Container(
                      width: d,
                      height: d,
                      decoration: const BoxDecoration(
                        color: AppColors.successGreen,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                  Center(
                    child: Opacity(
                      opacity: contentAlpha,
                      child: _BadgeCheck(progress: t),
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}

/// Lucide `badge-check` (24x24 viewBox) redrawn as a Path, Instagram-blue
/// filled, with an animated outline stroke + white checkmark draw-in.
class _BadgeCheck extends StatelessWidget {
  final double progress;

  const _BadgeCheck({required this.progress});

  @override
  Widget build(BuildContext context) {
    // Ease-out-back pop: scales slightly past 1 then settles.
    final pop = Curves.easeOutBack
        .transform((progress / 0.9).clamp(0.0, 1.0).toDouble());
    return RepaintBoundary(
      child: Transform.scale(
        scale: pop,
        child: CustomPaint(
          size: const Size.square(124),
          painter: _BadgeCheckPainter(progress: progress),
        ),
      ),
    );
  }
}

/// Adds an SVG-style `a rx ry 0 0 1 dx dy` arc (sweep=1, small arc) to [p].
void _svgArcTo(Path p, Offset from, double dx, double dy, double r) {
  final to = from + Offset(dx, dy);
  final d = (to - from).distance;
  final h = math.sqrt(r * r - (d / 2) * (d / 2));
  final mid = Offset((from.dx + to.dx) / 2, (from.dy + to.dy) / 2);
  final perp = Offset(-dy, dx) / d;
  final c = mid + perp * h;
  final start = math.atan2(from.dy - c.dy, from.dx - c.dx);
  final sweep = 2 * math.asin((d / 2) / r);
  p.arcTo(Rect.fromCircle(center: c, radius: r), start, sweep, false);
}

class _BadgeCheckPainter extends CustomPainter {
  final double progress;

  const _BadgeCheckPainter({required this.progress});

  double _ease(double t) =>
      Curves.easeInOut.transform(t.clamp(0.0, 1.0).toDouble());

  Path _badgeShape(double s) {
    final p = Path()..moveTo(3.85 * s, 8.62 * s);
    double cx = 3.85 * s, cy = 8.62 * s;
    void a(double dx, double dy) {
      final from = Offset(cx, cy);
      _svgArcTo(p, from, dx * s, dy * s, 4 * s);
      cx = from.dx + dx * s;
      cy = from.dy + dy * s;
    }

    a(4.78, -4.77);
    a(6.74, 0);
    a(4.78, 4.78);
    a(0, 6.74);
    a(-4.77, 4.78);
    a(-6.75, 0);
    a(-4.78, -4.77);
    a(0, -6.76);
    return p..close();
  }

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;

    // Phase 1 [0 .. 55%]: white outline of the badge strokes itself in.
    final strokeT = _ease((progress / 0.55).clamp(0.0, 1.0).toDouble());
    // Phase 2 [35% .. 80%]: the blue body fades in beneath the stroke.
    final fillT = _ease(((progress - 0.35) / 0.45).clamp(0.0, 1.0).toDouble());
    // Phase 3 [60% .. 100%]: the white check draws itself.
    final checkT = _ease(((progress - 0.6) / 0.4).clamp(0.0, 1.0).toDouble());

    final shape = _badgeShape(s);

    if (fillT > 0) {
      final fill = Paint()
        ..style = PaintingStyle.fill
        ..color = Colors.transparent
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF4FC3F7), Color(0xFF1565C0)],
        ).createShader(Offset.zero & size);
      canvas.saveLayer(
          Offset.zero & size, Paint()..color = Colors.white.withValues(alpha: fillT));
      canvas.drawPath(shape, fill);
      canvas.restore();
    }

    if (strokeT > 0) {
      final metrics = shape.computeMetrics().first;
      final strokePaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.7 * s
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = Colors.white.withValues(alpha: 0.95);
      canvas.drawPath(
          metrics.extractPath(0, metrics.length * strokeT), strokePaint);
    }

    if (checkT > 0) {
      final check = Path()
        ..moveTo(16 * s, 9 * s)
        ..lineTo(10.5 * s, 14.5 * s)
        ..lineTo(8 * s, 12 * s);
      final metrics = check.computeMetrics().first;
      final checkPaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2 * s
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = Colors.white;
      canvas.drawPath(
          metrics.extractPath(0, metrics.length * checkT), checkPaint);
    }
  }

  @override
  bool shouldRepaint(covariant _BadgeCheckPainter oldDelegate) =>
      oldDelegate.progress != progress;
}

/// Marching chevrons that glide toward [direction] (-1 left / +1 right),
/// fading as they travel.
class _MarchingArrows extends StatefulWidget {
  final IconData icon;
  final Color color;
  final int direction;

  const _MarchingArrows({
    required this.icon,
    required this.color,
    this.direction = 1,
  });

  @override
  State<_MarchingArrows> createState() => _MarchingArrowsState();
}

class _MarchingArrowsState extends State<_MarchingArrows>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1000),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 40,
      height: 20,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) => Stack(
          alignment: Alignment.center,
          children: List.generate(3, (i) {
            final t = (_controller.value - i * 0.16).abs() % 1.0;
            return Opacity(
              opacity: (1 - t).clamp(0.0, 1.0),
              child: Transform.translate(
                offset: Offset(12 * widget.direction * t, 0),
                child: Icon(widget.icon, size: 16, color: widget.color),
              ),
            );
          }),
        ),
      ),
    );
  }
}

/// Square thumb with a soft expanding ripple ring behind it while dragging.
class _SwipeHandle extends StatelessWidget {
  static const double span = 66;
  final bool expanding;
  final Widget child;

  const _SwipeHandle({required this.expanding, required this.child});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: span,
      height: span,
      child: Stack(
        alignment: Alignment.center,
        children: [
          AnimatedScale(
            scale: expanding ? 1.5 : 1.0,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            child: Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFFC9D5E3)
                    .withValues(alpha: expanding ? 0.55 : 0.25),
              ),
            ),
          ),
          Container(
            width: 54,
            height: 54,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              color: Colors.white,
              border: Border.all(color: const Color(0xFFE5E9EF)),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x14111827),
                  blurRadius: 12,
                  offset: Offset(0, 3),
                ),
              ],
            ),
            alignment: Alignment.center,
            child: child,
          ),
        ],
      ),
    );
  }
}

/// The "Swipe to mark as given" bar. The actual API call happens here;
/// success plays the green acceptance flash.
class _GiveSwipe extends StatefulWidget {
  final VoidCallback onConfirm;
  final bool busy;

  const _GiveSwipe({required this.onConfirm, required this.busy});

  @override
  State<_GiveSwipe> createState() => _GiveSwipeState();
}

class _GiveSwipeState extends State<_GiveSwipe> {
  static const double _height = 72;

  double _dragX = 0;
  double _maxDrag = 0;
  bool _dragging = false;

  void _updateMax(double track) {
    final max = track - _SwipeHandle.span - 8;
    if (max > 0) _maxDrag = max;
  }

  void _onUpdate(DragUpdateDetails d) {
    if (widget.busy) return;
    setState(() {
      _dragging = true;
      _dragX = (_dragX + d.delta.dx).clamp(0.0, _maxDrag);
    });
  }

  void _onEnd(DragEndDetails d) {
    if (widget.busy) return;
    final x = _dragX;
    final fling = d.velocity.pixelsPerSecond.dx > 600;
    final done = _maxDrag > 0 && (fling || x >= _maxDrag * 0.5);
    setState(() {
      _dragging = false;
      // Visually complete the bar when confirmed, otherwise snap back.
      _dragX = done ? _maxDrag : 0;
    });
    if (done) widget.onConfirm();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.busy) {
      return SizedBox(
        height: _height,
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.successGreen,
            borderRadius: BorderRadius.circular(6),
          ),
          alignment: Alignment.center,
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  color: Colors.white,
                  strokeWidth: 2,
                ),
              ),
              SizedBox(width: 10),
              Text(
                'Marking kit as given…',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        _updateMax(constraints.maxWidth);
        final handleLeft = _dragX + 4;
        // Whole bar is draggable, not just the thumb, so a swipe anywhere
        // slides it and "goes".
        return GestureDetector(
          behavior: HitTestBehavior.translucent,
          onHorizontalDragUpdate: _onUpdate,
          onHorizontalDragEnd: _onEnd,
          child: SizedBox(
            height: _height,
            child: Stack(
              children: [
Container(
                height: _height,
                decoration: BoxDecoration(
                  color: AppColors.successGreenSoft,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Swipe to mark as given',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppColors.successGreen,
                        ),
                      ),
                    ),
                    Padding(
                      padding: EdgeInsets.only(right: 20),
                      child: _SwipeLabels(
                        icon: LucideIcons.chevronsRight,
                        color: AppColors.successGreen,
                        direction: 1,
                      ),
                    ),
                  ],
                ),
              ),
              AnimatedPositioned(
                duration: _dragging
                    ? Duration.zero
                    : const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                left: handleLeft,
                top: 3,
                bottom: 3,
                width: _SwipeHandle.span,
                child: _SwipeHandle(
                  expanding: _dragging,
                  child: const Icon(
                    LucideIcons.chevronsRight,
                    size: 26,
                    color: AppColors.successGreen,
                  ),
                ),
              ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Non-interactive marching chevrons used on the swipe bars.
class _SwipeLabels extends StatelessWidget {
  final IconData icon;
  final Color color;
  final int direction;

  const _SwipeLabels({
    required this.icon,
    required this.color,
    this.direction = 1,
  });

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: _MarchingArrows(
        icon: icon,
        color: color,
        direction: direction,
      ),
    );
  }
}

/// Persistent banner shown after Reject so the choice is obvious even after
/// the toast disappears.
class _RejectBanner extends StatelessWidget {
  const _RejectBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1F1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE96868).withValues(alpha: 0.35)),
      ),
      child: const Row(
        children: [
          Icon(LucideIcons.xCircle, size: 18, color: Color(0xFFE96868)),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Rejected — no kit given',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Color(0xFFE96868),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Green confirmation label that replaces the slider after a successful give.
class _GivenBanner extends StatelessWidget {
  const _GivenBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.successGreenSoft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: AppColors.successGreen.withValues(alpha: 0.35),
        ),
      ),
      child: const Row(
        children: [
          Icon(
            LucideIcons.checkCircle,
            size: 18,
            color: AppColors.successGreen,
          ),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Kit given successfully',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.successGreen,
              ),
            ),
          ),
        ],
      ),
    );
  }
}