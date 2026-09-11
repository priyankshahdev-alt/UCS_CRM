import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:intl/intl.dart';
import 'package:google_fonts/google_fonts.dart';
import '../services/api_service.dart';
import '../services/realtime_service.dart';
import '../main.dart';
import '../widgets/mini_calendar.dart';
import '../widgets/consistency_bar.dart';
import '../utils/responsive.dart';

import '../widgets/skeleton_loader.dart';
import 'edit_profile_page.dart';

class ProfilePage extends StatefulWidget {
  final VoidCallback? onLogout;
  final int tabChangeVersion;
  const ProfilePage({super.key, this.onLogout, required this.tabChangeVersion});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final ScrollController _scrollController = ScrollController();
  Map<String, dynamic>? _worker;
  bool _loading = true;
  List<dynamic> _tickets = [];
  bool _loadingTickets = false;
  List<dynamic> _loans = [];
  List<dynamic> _profileRequests = [];
  final Set<String> _expandedCards = {};

  int _present = 0, _absent = 0, _late = 0, _leave = 0, _lateUsed = 0;
  Map<String, String> _statusByDate = {};
  Map<String, Map<String, dynamic>> _historyByDate = {};
  String? _selectedDateKey;
  final Map<int, Map<String, int>> _monthlyStats = {};
  Map<String, List<String>> _calendarDates = {};

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant ProfilePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.tabChangeVersion != oldWidget.tabChangeVersion) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) _scrollController.jumpTo(0);
        _refreshHistoryFromNetwork();
        _fetchCalendar();
      });
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    RealtimeService.instance.removeListener(_onRealtimeChange);
    super.dispose();
  }

  Future<void> _loadData() async {
    _worker = await ApiService.getWorkerData();

    // Load cached data instantly
    final cachedProfile = await ApiService.getCachedProfile();
    if (cachedProfile != null) {
      _worker = cachedProfile;
      await ApiService.saveWorkerData(cachedProfile);
    }
    _applyCachedHistory(ApiService.getCachedHistory());

    setState(() => _loading = false);

    try {
      final profile = await ApiService.getMyProfile();
      _worker = profile;
      await ApiService.saveWorkerData(profile);
    } catch (_) {}

    await _refreshHistoryFromNetwork();
    _fetchCalendar();

    // Listen to realtime updates
    RealtimeService.instance.addListener(_onRealtimeChange);
    _fetchLoans();
    _fetchTickets();
    _fetchProfileRequests();
  }

  Future<void> _fetchLoans() async {
    try {
      final loans = await ApiService.getMyLoans();
      if (mounted) setState(() => _loans = loans);
    } catch (_) {}
  }

  Future<void> _fetchTickets() async {
    setState(() => _loadingTickets = true);
    try {
      final tickets = await ApiService.getMyCorrectionTickets();
      if (mounted) setState(() { _tickets = tickets; _loadingTickets = false; });
    } catch (_) { if (mounted) setState(() => _loadingTickets = false); }
  }

  Future<void> _fetchProfileRequests() async {
    try {
      final reqs = await ApiService.getMyProfileUpdateRequests();
      if (mounted) setState(() => _profileRequests = reqs);
    } catch (_) {}
  }

  void _onRealtimeChange() {
    final event = RealtimeService.instance.lastEvent;
    if (event == null) return;
    switch (event) {
      case RealtimeEvent.attendance:
      case RealtimeEvent.corrections:
        _refreshHistoryFromNetwork();
      default:
        break;
    }
  }

  Future<void> _applyCachedHistory(Future<List<dynamic>?> future) async {
    final cachedHistory = await future;
    if (cachedHistory == null) return;
    int p = 0, a = 0, l = 0, lv = 0;
    final statusMap = <String, String>{};
    final monthlyStats = <int, Map<String, int>>{};
    final detailMap = <String, Map<String, dynamic>>{};

    for (final rec in cachedHistory) {
      final date = rec['date'] ?? '';
      final status = rec['status'] ?? 'present';
      statusMap[date.toString()] = status.toString();
      detailMap[date.toString()] = {
        'date': date,
        'status': status,
        'punch_in_time': rec['punch_in_time'],
        'punch_out_time': rec['punch_out_time'],
        'hours_worked': rec['hours_worked'],
        'late_minutes': rec['late_minutes'],
      };
      final dt = DateTime.tryParse(date.toString());
      if (dt != null) {
        final ym = dt.year * 100 + dt.month;
        monthlyStats.putIfAbsent(ym, () => {'present': 0, 'absent': 0, 'late': 0, 'leave': 0, 'half-day': 0, 'holiday': 0});
        final st = status.toString();
        if (monthlyStats[ym]!.containsKey(st)) {
          monthlyStats[ym]![st] = monthlyStats[ym]![st]! + 1;
        }
      }
        switch (status) { case 'present': p++; break; case 'absent': a++; break; case 'late': l++; p++; break; case 'leave': lv++; break; }
    }

    setState(() {
      _present = p; _absent = a; _late = l; _leave = lv;
      _statusByDate = statusMap;
      _historyByDate = detailMap;
      _monthlyStats.clear();
      _monthlyStats.addAll(monthlyStats);
    });
  }

  Future<void> _refreshHistoryFromNetwork() async {
    int p = 0, a = 0, l = 0, lv = 0;
    final statusMap = <String, String>{};
    final monthlyStats = <int, Map<String, int>>{};
    final detailMap = <String, Map<String, dynamic>>{};

    try {
      final res = await Future.wait([
        ApiService.getHistory(),
        ApiService.getTodayStatus(),
      ]);
      final history = res[0] as List<dynamic>;
      final today = res[1] as Map<String, dynamic>;

      for (final rec in history) {
        final date = rec['date'] ?? '';
        final status = rec['status'] ?? 'present';
        statusMap[date.toString()] = status.toString();
        detailMap[date.toString()] = {
          'date': date,
          'status': status,
          'punch_in_time': rec['punch_in_time'],
          'punch_out_time': rec['punch_out_time'],
          'hours_worked': rec['hours_worked'],
          'late_minutes': rec['late_minutes'],
        };
        final dt = DateTime.tryParse(date.toString());
        if (dt != null) {
          final ym = dt.year * 100 + dt.month;
        monthlyStats.putIfAbsent(ym, () => {'present': 0, 'absent': 0, 'late': 0, 'leave': 0, 'half-day': 0, 'holiday': 0});
          final st = status.toString();
          if (monthlyStats[ym]!.containsKey(st)) {
            monthlyStats[ym]![st] = monthlyStats[ym]![st]! + 1;
          }
        }
      switch (status) { case 'present': p++; break; case 'absent': a++; break; case 'late': l++; p++; break; case 'leave': lv++; break; }
      }

      setState(() {
        _present = p; _absent = a; _late = l; _leave = lv;
        _lateUsed = today['lateUsed'] ?? 0;
        _statusByDate = statusMap;
        _historyByDate = detailMap;
        _monthlyStats.clear();
        _monthlyStats.addAll(monthlyStats);
      });
    } catch (_) {}
  }

  Future<void> _fetchCalendar() async {
    try {
      final n = DateTime.now();
      final data = await ApiService.getCalendar(year: n.year, month: n.month);
      final Map<String, List<String>> calMap = {};
      for (final e in (data['events'] as List? ?? [])) {
        final d = e['date']?.toString();
        if (d != null) calMap.putIfAbsent(d, () => []).add('event');
      }
      for (final h in (data['holidays'] as List? ?? [])) {
        final d = h['date']?.toString();
        if (d != null) calMap.putIfAbsent(d, () => []).add('holiday');
      }
      for (final b in (data['birthdays'] as List? ?? [])) {
        final d = b['date']?.toString();
        if (d != null) calMap.putIfAbsent(d, () => []).add('birthday');
      }
      if (mounted) setState(() => _calendarDates = calMap);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<AppColors>()!;
    final scheme = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    if (_loading) return const ProfileSkeleton();

    final rawName = _worker?['name'] ?? 'Worker';
    final name = rawName.split(' ').map((w) => w.isNotEmpty ? '${w[0].toUpperCase()}${w.substring(1).toLowerCase()}' : '').join(' ');
    final loginId = _worker?['login_id'] ?? '';
    final role = _worker?['role'] ?? _worker?['designation'] ?? '';
    final total = _present + _absent + _late + _leave;
    final rate = total > 0 ? (_present + _late) / total : 0.0;
    final initials = name.split(' ').map((n) => n.isNotEmpty ? n[0] : '').join().toUpperCase();

    final presentFraction = total > 0 ? _present / total : 0.0;
    final absentFraction = total > 0 ? _absent / total : 0.0;
    final leaveFraction = total > 0 ? _leave / total : 0.0;
    final lateFraction = total > 0 ? _late / total : 0.0;

    return Scaffold(
      backgroundColor: scheme.surface,
      body: SafeArea(
        child: ListView(
          controller: _scrollController,
          padding: EdgeInsets.fromLTRB(Responsive.pad(context, 16), Responsive.pad(context, 16), Responsive.pad(context, 16), Responsive.pad(context, 80)),
          children: [
            _profileCard(name, loginId, role, initials),
            SizedBox(height: Responsive.pad(context, 24)),
            _lateDeductionCard(colors, scheme, tt),
            SizedBox(height: Responsive.pad(context, 24)),
            _attendanceCalendar(
              presentFraction, absentFraction, leaveFraction, lateFraction,
              rate, colors, scheme, tt,
            ),
            SizedBox(height: Responsive.pad(context, 24)),
            if (_selectedDateKey != null)
              Padding(
                padding: EdgeInsets.only(bottom: Responsive.pad(context, 24)),
                child: _dayDetailCard(colors, scheme, tt),
              ),
        _ticketStatusCard(colors, scheme, tt),
        SizedBox(height: Responsive.pad(context, 16)),
        _loanStatusCard(colors, scheme, tt),
        SizedBox(height: Responsive.pad(context, 16)),
        _profileRequestCard(colors, scheme, tt),
        SizedBox(height: Responsive.pad(context, 24)),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _confirmLogout,
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFba1a1a),
              foregroundColor: Colors.white,
              elevation: 0,
              padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 16)),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(4),
                side: const BorderSide(color: Color(0xFF7f1d1d), width: 2),
              ),
            ),
            icon: Icon(LucideIcons.power, size: Responsive.sp(context, 20)),
            label: Text('LOGOUT', style: GoogleFonts.hankenGrotesk(
              fontSize: Responsive.sp(context, 14), fontWeight: FontWeight.w800, letterSpacing: Responsive.sp(context, 1.5),
            )),
          ),
        ),
        SizedBox(height: Responsive.pad(context, 16)),
          ],
        ),
      ),
    );
  }

  Widget _profileCard(String name, String loginId, String role, String initials) {
    final sc = Theme.of(context).colorScheme;
    final colors = Theme.of(context).extension<AppColors>()!;
    return GestureDetector(
      onTap: () {
        showModalBottomSheet(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.transparent,
          builder: (_) => SizedBox(
            height: MediaQuery.of(context).size.height * 0.90,
            child: Container(
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
              ),
              child: EditProfilePage(worker: _worker!),
            ),
          ),
        ).then((result) {
          if (result == true && mounted) _loadData();
        });
      },
      child: Container(
        padding: EdgeInsets.all(Responsive.pad(context, 16)),
        decoration: BoxDecoration(
          color: sc.surface,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: colors.outline),
        ),
        child: Row(
          children: [
            Stack(
              children: [
                Container(
                  width: Responsive.pad(context, 80), height: Responsive.pad(context, 80),
                  decoration: BoxDecoration(
                    color: colors.primaryFixed,
                    shape: BoxShape.circle,
                    border: Border.all(color: sc.primary, width: 4),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: _worker?['photo_url'] != null && (_worker!['photo_url'] as String).isNotEmpty
                      ? Transform.scale(
                          scale: 1.2,
                          child: Image.network(
                            _worker!['photo_url'],
                            fit: BoxFit.cover,
                            width: Responsive.pad(context, 80), height: Responsive.pad(context, 80),
                            errorBuilder: (_, __, ___) => Center(child: Text(initials,
                              style: GoogleFonts.hankenGrotesk(
                                fontSize: Responsive.sp(context, 28), fontWeight: FontWeight.w800, color: sc.primary,
                              ),
                            )),
                          ),
                        )
                      : Center(child: Text(initials,
                          style: GoogleFonts.hankenGrotesk(
                            fontSize: Responsive.sp(context, 28), fontWeight: FontWeight.w800, color: sc.primary,
                          ),
                        )),
                ),
                Positioned(
                  right: 0, bottom: 0,
                  child: Container(
                    width: Responsive.pad(context, 20), height: Responsive.pad(context, 20),
                    decoration: BoxDecoration(
                      color: sc.secondary,
                      shape: BoxShape.circle,
                      border: Border.all(color: sc.surface, width: 2),
                    ),
                  ),
                ),
              ],
            ),
            SizedBox(width: Responsive.pad(context, 16)),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name,
                    style: GoogleFonts.hankenGrotesk(
                      fontSize: Responsive.sp(context, 20), fontWeight: FontWeight.w600, color: sc.onSurface,
                    ),
                  ),
                  SizedBox(height: Responsive.pad(context, 2)),
                  Text(role.isNotEmpty ? role : (_worker?['department'] ?? 'Employee'),
                  style: TextStyle(
                    fontSize: Responsive.sp(context, 14), fontWeight: FontWeight.w400, color: sc.onSurfaceVariant,
                  ),
                ),
                SizedBox(height: Responsive.pad(context, 2)),
                Text('Employee ID: #$loginId',
                  style: TextStyle(
                    fontSize: Responsive.sp(context, 12), fontWeight: FontWeight.w400, color: sc.outline,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      ),
    );
  }

  double get _lateTier {
    if (_lateUsed <= 180) return 0;
    if (_lateUsed <= 240) return 1;
    if (_lateUsed <= 480) return 2;
    return 3;
  }

  Color get _lateTierColor {
    switch (_lateTier) {
      case 0: return const Color(0xFF2a6a4b);
      case 1: return const Color(0xFFe67e22);
      case 2: return const Color(0xFFd35400);
      case 3: return const Color(0xFFba1a1a);
      default: return const Color(0xFFc28228);
    }
  }

  Color get _lateTierBg {
    switch (_lateTier) {
      case 0: return const Color(0xFFf0f9f4);
      case 1: return const Color(0xFFfff8f0);
      case 2: return const Color(0xFFfff3eb);
      case 3: return const Color(0xFFfff5f5);
      default: return const Color(0xFFf0f4f8);
    }
  }

  Color get _lateTierBorder {
    switch (_lateTier) {
      case 0: return const Color(0xFF2a6a4b);
      case 1: return const Color(0xFFe67e22);
      case 2: return const Color(0xFFd35400);
      case 3: return const Color(0xFFba1a1a);
      default: return const Color(0xFFc3c6ce);
    }
  }

  String get _lateTierLabel {
    switch (_lateTier) {
      case 0: return 'No deduction';
      case 1: return 'Half-day deduction';
      case 2: return 'One-day deduction';
      case 3: return 'Proportional deduction';
      default: return '';
    }
  }

  String get _lateTierDesc {
    switch (_lateTier) {
      case 0: return '$_lateUsed min used — within the 180 min grace period. No expense deduction for lateness.';
      case 1: return '$_lateUsed min used — exceeds grace limit. Half-day (0.5 day) will be deducted from expenses.';
      case 2: return '$_lateUsed min used — exceeds half-day threshold. One full day will be deducted from expenses.';
      case 3: return '$_lateUsed min used — exceeds 480 min. Proportional deduction (total min / 480) applied to salary.';
      default: return '';
    }
  }

  bool get _joinedThisMonth {
    final created = _worker?['created_at'];
    if (created == null) return false;
    final dt = DateTime.tryParse(created.toString());
    if (dt == null) return false;
    final now = DateTime.now();
    return dt.year == now.year && dt.month == now.month;
  }

  Widget _lateDeductionCard(AppColors colors, ColorScheme scheme, TextTheme tt) {
    return Container(
      padding: EdgeInsets.all(Responsive.pad(context, 16)),
      decoration: BoxDecoration(
        color: _lateTierBg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _lateTierBorder.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(LucideIcons.clock, size: Responsive.sp(context, 16), color: _lateTierColor),
              SizedBox(width: Responsive.pad(context, 8)),
              Text('Late Deduction Status',
                style: GoogleFonts.hankenGrotesk(
                  fontSize: Responsive.sp(context, 16), fontWeight: FontWeight.w600, color: const Color(0xFF171c1f),
                ),
              ),
            ],
          ),
          SizedBox(height: Responsive.pad(context, 14)),
          Row(
            children: [
              Container(
                padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 10), vertical: Responsive.pad(context, 6)),
                decoration: BoxDecoration(
                  color: _lateTierColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '${_lateUsed} min',
                  style: GoogleFonts.hankenGrotesk(
                    fontSize: Responsive.sp(context, 24), fontWeight: FontWeight.w800, color: _lateTierColor,
                  ),
                ),
              ),
              SizedBox(width: Responsive.pad(context, 14)),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 8), vertical: Responsive.pad(context, 3)),
                      decoration: BoxDecoration(
                        color: _lateTierColor.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(3),
                      ),
                      child: Text(_lateTierLabel,
                        style: TextStyle(
                          fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w700,
                          color: _lateTierColor,
                        ),
                      ),
                    ),
                    SizedBox(height: Responsive.pad(context, 4)),
                    Text(
                      _lateTierDesc,
                      style: TextStyle(
                        fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant, height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: Responsive.pad(context, 12)),
          Container(
            padding: EdgeInsets.all(Responsive.pad(context, 12)),
            decoration: BoxDecoration(
              color: scheme.surface.withValues(alpha: 0.6),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Deduction rules',
                  style: TextStyle(
                    fontSize: Responsive.sp(context, 10), fontWeight: FontWeight.w700, letterSpacing: 0.05,
                    color: const Color(0xFF74777e),
                  ),
                ),
                SizedBox(height: Responsive.pad(context, 6)),
                _ruleRow('0 – 180 min', 'No deduction', _lateTier == 0),
                _ruleRow('181 – 240 min', 'Half-day deduction', _lateTier == 1),
                _ruleRow('241 – 480 min', 'One-day deduction', _lateTier == 2),
                _ruleRow('> 480 min', 'Proportional deduction', _lateTier == 3),
              ],
            ),
          ),
          if (_joinedThisMonth) ...[
            SizedBox(height: Responsive.pad(context, 10)),
            Container(
              padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 10), vertical: Responsive.pad(context, 8)),
              decoration: BoxDecoration(
                color: const Color(0xFFf3e8ff).withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0xFF8B5CF6).withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  Icon(LucideIcons.info, size: Responsive.sp(context, 14), color: const Color(0xFF8B5CF6)),
                  SizedBox(width: Responsive.pad(context, 8)),
                  Expanded(
                    child: Text(
                      'First month joining: 1.5 days deducted from expenses (new joiner policy).',
                      style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant, height: 1.3),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _ruleRow(String range, String desc, bool active) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 2)),
      child: Row(
        children: [
          Container(
            width: 8, height: 8,
            decoration: BoxDecoration(
              color: active ? const Color(0xFF2a6a4b) : const Color(0xFFdfe3e7),
              shape: BoxShape.circle,
            ),
          ),
          SizedBox(width: Responsive.pad(context, 8)),
          Text(range,
            style: TextStyle(
              fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w600,
              color: active ? const Color(0xFF171c1f) : const Color(0xFF74777e),
            ),
          ),
          SizedBox(width: Responsive.pad(context, 8)),
          Text('→',
            style: TextStyle(
              fontSize: Responsive.sp(context, 11), color: const Color(0xFFc3c6ce),
            ),
          ),
          SizedBox(width: Responsive.pad(context, 8)),
          Expanded(
            child: Text(desc,
              style: TextStyle(
                fontSize: Responsive.sp(context, 11), fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                color: active ? const Color(0xFF171c1f) : const Color(0xFF74777e),
              ),
            ),
          ),
        ],
      ),
    );
  }


  Widget _attendanceCalendar(
    double presentFrac, double absentFrac, double leaveFrac, double lateFrac,
    double rate, AppColors colors, ColorScheme scheme, TextTheme tt,
  ) {
    return Container(
      padding: EdgeInsets.all(Responsive.pad(context, 16)),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Attendance Calendar',
                style: GoogleFonts.hankenGrotesk(
                  fontSize: Responsive.sp(context, 18), fontWeight: FontWeight.w600, color: scheme.onSurface,
                ),
              ),
            ],
          ),
          SizedBox(height: Responsive.pad(context, 16)),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Monthly Consistency',
                style: TextStyle(
                  fontSize: Responsive.sp(context, 12), fontWeight: FontWeight.w600, letterSpacing: 0.05,
                  color: const Color(0xFF43474d),
                ),
              ),
              Text('${(rate * 100).round()}%',
                style: TextStyle(
                  fontSize: Responsive.sp(context, 12), fontWeight: FontWeight.w600, letterSpacing: 0.05,
                  color: const Color(0xFF2a6a4b),
                ),
              ),
            ],
          ),
          SizedBox(height: Responsive.pad(context, 8)),
          ConsistencyBar(
            presentFraction: presentFrac,
            absentFraction: absentFrac,
            leaveFraction: leaveFrac,
            lateFraction: lateFrac,
            height: 8,
          ),
          SizedBox(height: Responsive.pad(context, 20)),
          MiniCalendar(
            year: DateTime.now().year,
            month: DateTime.now().month,
            statusByDate: _statusByDate,
            selectedDate: _selectedDateKey,
            calendarDates: _calendarDates,
            onDateSelected: (key) => setState(() {
              _selectedDateKey = _selectedDateKey == key ? null : key;
            }),
          ),
          SizedBox(height: Responsive.pad(context, 16)),
          Wrap(
            spacing: 16, runSpacing: 8,
            children: [
              _legendDot('Present', const Color(0xFFaff1ca)),
              _legendDot('Absent', const Color(0xFFffdad6)),
              _legendDot('Leave', const Color(0xFFd1e4ff)),
              _legendDot('Late', const Color(0xFFffddb8)),
              _legendDot('Half-day', const Color(0xFFe8d5f5)),
              _legendDot('Holiday', const Color(0xFFe8d5f5)),
              _smLegendDot(LucideIcons.circle, 'Event', const Color(0xFF2563eb)),
              _smLegendDot(LucideIcons.cake, 'Birthday', const Color(0xFFf43f5e)),
            ],
          ),
        ],
      ),
    );
  }

  void _confirmLogout() {
    final sc = Theme.of(context).colorScheme;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        backgroundColor: sc.surface,
        title: Text('Logout',
          style: GoogleFonts.hankenGrotesk(
            fontSize: Responsive.sp(context, 20), fontWeight: FontWeight.w600, color: sc.onSurface,
          ),
        ),
        content: Text('Are you sure you want to logout?',
          style: TextStyle(fontSize: Responsive.sp(context, 14), color: sc.onSurfaceVariant),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Cancel',
              style: TextStyle(fontWeight: FontWeight.w600, color: sc.onSurfaceVariant),
            ),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              widget.onLogout?.call();
            },
            child: Text('Logout',
              style: TextStyle(fontWeight: FontWeight.w600, color: sc.error),
            ),
          ),
        ],
      ),
    );
  }

  Widget _ticketStatusCard(AppColors colors, ColorScheme scheme, TextTheme tt) {
    final expanded = _expandedCards.contains('ticket');
    final pendingTickets = _tickets.where((t) => t['status'] == 'pending' || t['status'] == 'hr_verified').toList();
    return Container(
      padding: EdgeInsets.all(Responsive.pad(context, 16)),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: () => setState(() {
              if (expanded) { _expandedCards.remove('ticket'); } else { _expandedCards.add('ticket'); }
            }),
            behavior: HitTestBehavior.opaque,
            child: Row(
              children: [
                Icon(LucideIcons.ticket, size: Responsive.sp(context, 18), color: scheme.primary),
                SizedBox(width: Responsive.pad(context, 8)),
                Expanded(
                  child: Text('Ticket Status',
                    style: GoogleFonts.hankenGrotesk(
                      fontSize: Responsive.sp(context, 18), fontWeight: FontWeight.w600, color: scheme.onSurface,
                    ),
                  ),
                ),
                if (pendingTickets.isNotEmpty)
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 6), vertical: Responsive.pad(context, 2)),
                    decoration: BoxDecoration(
                      color: const Color(0xFFc28228).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('${pendingTickets.length}', style: TextStyle(fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w700, color: const Color(0xFFc28228))),
                  ),
                SizedBox(width: Responsive.pad(context, 8)),
                Icon(expanded ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: Responsive.sp(context, 18), color: scheme.onSurfaceVariant),
              ],
            ),
          ),
          if (expanded) ...[
            SizedBox(height: Responsive.pad(context, 16)),
            if (_loadingTickets)
              Padding(
                padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 16)),
                child: const Center(child: ButtonSkeleton()),
              )
            else if (pendingTickets.isEmpty)
              Padding(
                padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 16)),
                child: Center(
                  child: Text('No pending tickets', style: TextStyle(fontSize: Responsive.sp(context, 13), color: scheme.onSurfaceVariant)),
                ),
              )
            else
              ...pendingTickets.take(3).map((t) => _ticketItem(t, scheme, colors)),
            if (pendingTickets.length > 3)
              Padding(
                padding: EdgeInsets.only(top: Responsive.pad(context, 8)),
                child: Center(
                  child: Text('+${pendingTickets.length - 3} more', style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant)),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _ticketItem(dynamic t, ColorScheme scheme, AppColors colors) {
    final status = t['status']?.toString() ?? 'pending';
    final field = t['field'] == 'punch_in' ? 'Punch In' : 'Punch Out';
    final date = t['date']?.toString() ?? '';
    final Color statusColor;
    final String statusLabel;
    switch (status) {
      case 'pending': statusColor = const Color(0xFFc28228); statusLabel = 'Pending'; break;
      case 'hr_verified': statusColor = const Color(0xFF2563eb); statusLabel = 'HR Verified'; break;
      case 'approved': statusColor = const Color(0xFF1D7A4F); statusLabel = 'Approved'; break;
      case 'rejected': statusColor = const Color(0xFFba1a1a); statusLabel = 'Rejected'; break;
      default: statusColor = scheme.onSurfaceVariant; statusLabel = status;
    }
    return Padding(
      padding: EdgeInsets.only(bottom: Responsive.pad(context, 12)),
      child: Container(
        padding: EdgeInsets.all(Responsive.pad(context, 12)),
        decoration: BoxDecoration(
          color: colors.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: colors.outline.withValues(alpha: 0.5)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$date • $field',
                    style: TextStyle(fontSize: Responsive.sp(context, 13), fontWeight: FontWeight.w600, color: scheme.onSurface)),
                  SizedBox(height: Responsive.pad(context, 2)),
                  if (t['reason'] != null)
                    Text(t['reason'].toString(),
                      style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant),
                      maxLines: 1, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            SizedBox(width: Responsive.pad(context, 8)),
            Container(
              padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 8), vertical: Responsive.pad(context, 3)),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(statusLabel, style: TextStyle(fontSize: Responsive.sp(context, 10), fontWeight: FontWeight.w700, color: statusColor)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _loanStatusCard(AppColors colors, ColorScheme scheme, TextTheme tt) {
    final expanded = _expandedCards.contains('loan');
    final activeLoans = _loans.where((l) => l['status'] == 'approved' || l['status'] == 'pending').toList();
    return Container(
      padding: EdgeInsets.all(Responsive.pad(context, 16)),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: () => setState(() {
              if (expanded) { _expandedCards.remove('loan'); } else { _expandedCards.add('loan'); }
            }),
            behavior: HitTestBehavior.opaque,
            child: Row(
              children: [
                Icon(LucideIcons.wallet, size: Responsive.sp(context, 18), color: scheme.primary),
                SizedBox(width: Responsive.pad(context, 8)),
                Expanded(
                  child: Text('Loan Status',
                    style: GoogleFonts.hankenGrotesk(
                      fontSize: Responsive.sp(context, 18), fontWeight: FontWeight.w600, color: scheme.onSurface,
                    ),
                  ),
                ),
                if (activeLoans.isNotEmpty)
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 6), vertical: Responsive.pad(context, 2)),
                    decoration: BoxDecoration(
                      color: const Color(0xFFc28228).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('${activeLoans.length}', style: TextStyle(fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w700, color: const Color(0xFFc28228))),
                  ),
                SizedBox(width: Responsive.pad(context, 8)),
                Icon(expanded ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: Responsive.sp(context, 18), color: scheme.onSurfaceVariant),
              ],
            ),
          ),
          if (expanded) ...[
            SizedBox(height: Responsive.pad(context, 16)),
            if (activeLoans.isEmpty)
              Padding(
                padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 16)),
                child: Center(
                  child: Text('No active loans', style: TextStyle(fontSize: Responsive.sp(context, 13), color: scheme.onSurfaceVariant)),
                ),
              )
            else
              ...activeLoans.take(3).map((l) => _loanItem(l, scheme, colors)),
            if (activeLoans.length > 3)
              Padding(
                padding: EdgeInsets.only(top: Responsive.pad(context, 8)),
                child: Center(
                  child: Text('+${activeLoans.length - 3} more', style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant)),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _loanItem(dynamic l, ColorScheme scheme, AppColors colors) {
    final status = l['status']?.toString() ?? 'pending';
    final total = l['total_amount'] ?? 0;
    final remaining = l['remaining_amount'] ?? total;
    final Color statusColor;
    final String statusLabel;
    switch (status) {
      case 'pending': statusColor = const Color(0xFFc28228); statusLabel = 'Pending'; break;
      case 'approved': statusColor = const Color(0xFF1D7A4F); statusLabel = 'Approved'; break;
      case 'rejected': statusColor = const Color(0xFFba1a1a); statusLabel = 'Rejected'; break;
      default: statusColor = scheme.onSurfaceVariant; statusLabel = status;
    }
    return Padding(
      padding: EdgeInsets.only(bottom: Responsive.pad(context, 12)),
      child: Container(
        padding: EdgeInsets.all(Responsive.pad(context, 12)),
        decoration: BoxDecoration(
          color: colors.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: colors.outline.withValues(alpha: 0.5)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('\u20B9$total',
                    style: TextStyle(fontSize: Responsive.sp(context, 14), fontWeight: FontWeight.w700, color: scheme.onSurface)),
                  SizedBox(height: Responsive.pad(context, 2)),
                  if (status == 'approved')
                    Text('\u20B9$remaining remaining',
                      style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
            Container(
              padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 8), vertical: Responsive.pad(context, 3)),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(statusLabel, style: TextStyle(fontSize: Responsive.sp(context, 10), fontWeight: FontWeight.w700, color: statusColor)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _profileRequestCard(AppColors colors, ColorScheme scheme, TextTheme tt) {
    final expanded = _expandedCards.contains('profile_req');
    final pendingReqs = _profileRequests.where((r) => r['status'] == 'pending').toList();
    return Container(
      padding: EdgeInsets.all(Responsive.pad(context, 16)),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: () => setState(() {
              if (expanded) { _expandedCards.remove('profile_req'); } else { _expandedCards.add('profile_req'); }
            }),
            behavior: HitTestBehavior.opaque,
            child: Row(
              children: [
                Icon(LucideIcons.clipboardCheck, size: Responsive.sp(context, 18), color: scheme.primary),
                SizedBox(width: Responsive.pad(context, 8)),
                Expanded(
                  child: Text('Profile Update Requests',
                    style: GoogleFonts.hankenGrotesk(
                      fontSize: Responsive.sp(context, 18), fontWeight: FontWeight.w600, color: scheme.onSurface,
                    ),
                  ),
                ),
                if (pendingReqs.isNotEmpty)
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 6), vertical: Responsive.pad(context, 2)),
                    decoration: BoxDecoration(
                      color: const Color(0xFFc28228).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('${pendingReqs.length}', style: TextStyle(fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w700, color: const Color(0xFFc28228))),
                  ),
                SizedBox(width: Responsive.pad(context, 8)),
                Icon(expanded ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: Responsive.sp(context, 18), color: scheme.onSurfaceVariant),
              ],
            ),
          ),
          if (expanded) ...[
            SizedBox(height: Responsive.pad(context, 16)),
            if (_profileRequests.isEmpty)
              Padding(
                padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 16)),
                child: Center(
                  child: Text('No requests yet', style: TextStyle(fontSize: Responsive.sp(context, 13), color: scheme.onSurfaceVariant)),
                ),
              )
            else
              ..._profileRequests.take(3).map((r) => _profileRequestItem(r, scheme, colors)),
            if (_profileRequests.length > 3)
              Padding(
                padding: EdgeInsets.only(top: Responsive.pad(context, 8)),
                child: Center(
                  child: Text('+${_profileRequests.length - 3} more', style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant)),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _profileRequestItem(dynamic r, ColorScheme scheme, AppColors colors) {
    final status = r['status']?.toString() ?? 'pending';
    final changes = r['requested_changes'] as Map<String, dynamic>? ?? {};
    final fieldCount = changes.length;
    final Color statusColor;
    final String statusLabel;
    switch (status) {
      case 'pending': statusColor = const Color(0xFFc28228); statusLabel = 'Pending'; break;
      case 'approved': statusColor = const Color(0xFF1D7A4F); statusLabel = 'Approved'; break;
      case 'rejected': statusColor = const Color(0xFFba1a1a); statusLabel = 'Rejected'; break;
      default: statusColor = scheme.onSurfaceVariant; statusLabel = status;
    }
    final dateStr = r['created_at']?.toString() ?? '';
    final dt = dateStr.isNotEmpty ? DateTime.tryParse(dateStr)?.toLocal() : null;
    final dateLabel = dt != null ? '${dt.day}/${dt.month}/${dt.year}' : '';

    return Padding(
      padding: EdgeInsets.only(bottom: Responsive.pad(context, 12)),
      child: Container(
        padding: EdgeInsets.all(Responsive.pad(context, 12)),
        decoration: BoxDecoration(
          color: colors.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: colors.outline.withValues(alpha: 0.5)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$fieldCount field${fieldCount > 1 ? 's' : ''} changed',
                    style: TextStyle(fontSize: Responsive.sp(context, 13), fontWeight: FontWeight.w600, color: scheme.onSurface)),
                  SizedBox(height: Responsive.pad(context, 2)),
                  Text(dateLabel,
                    style: TextStyle(fontSize: Responsive.sp(context, 11), color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
            Container(
              padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 8), vertical: Responsive.pad(context, 3)),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(statusLabel, style: TextStyle(fontSize: Responsive.sp(context, 10), fontWeight: FontWeight.w700, color: statusColor)),
            ),
          ],
        ),
      ),
    );
  }

  String _fmtTime(dynamic ts) {
    if (ts == null) return '—';
    if (ts is DateTime) return DateFormat('hh:mm a').format(ts.toLocal());
    String s = ts.toString();
    if (!s.endsWith('Z') && !RegExp(r'[+-]\d{2}:\d{2}$').hasMatch(s)) s += 'Z';
    final t = DateTime.tryParse(s);
    if (t == null) return '—';
    return DateFormat('hh:mm a').format(t.toLocal());
  }

  Widget _dayDetailCard(AppColors colors, ColorScheme scheme, TextTheme tt) {
    final detail = _historyByDate[_selectedDateKey];
    if (detail == null) {
      return Container(
        padding: EdgeInsets.all(Responsive.pad(context, 16)),
        decoration: BoxDecoration(
        color: Theme.of(context).extension<AppColors>()!.surfaceContainerLow,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            Icon(LucideIcons.info, size: Responsive.sp(context, 18), color: const Color(0xFF74777e)),
            SizedBox(width: Responsive.pad(context, 10)),
            Text('No record for this date', style: TextStyle(fontSize: Responsive.sp(context, 14), color: const Color(0xFF74777e))),
        ],
      ),
    );
    }

    final status = detail['status']?.toString() ?? '';
    final punchIn = detail['punch_in_time'];
    final punchOut = detail['punch_out_time'];
    final hoursWorked = detail['hours_worked'];
    final lateMinutes = detail['late_minutes'];

    Color statusColor;
    IconData statusIcon;
    switch (status) {
      case 'present': statusColor = const Color(0xFF2a6a4b); statusIcon = LucideIcons.circleCheck; break;
      case 'absent': statusColor = const Color(0xFFba1a1a); statusIcon = LucideIcons.circleX; break;
      case 'late': statusColor = const Color(0xFFc28228); statusIcon = LucideIcons.clock; break;
      case 'leave': statusColor = const Color(0xFF7a92b0); statusIcon = LucideIcons.calendarCheck; break;
      case 'half-day': statusColor = const Color(0xFF7c3aed); statusIcon = LucideIcons.sun; break;
      default: statusColor = const Color(0xFF74777e); statusIcon = LucideIcons.circleHelp;
    }

    final dateStr = _selectedDateKey ?? '';
    final dt = DateTime.tryParse(dateStr);
    final formattedDate = dt != null ? DateFormat('EEEE, d MMMM yyyy').format(dt) : dateStr;

    return Container(
      padding: EdgeInsets.all(Responsive.pad(context, 16)),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(statusIcon, size: Responsive.sp(context, 18), color: statusColor),
              SizedBox(width: Responsive.pad(context, 8)),
              Expanded(
                child: Text(formattedDate, style: GoogleFonts.hankenGrotesk(
                  fontSize: Responsive.sp(context, 16), fontWeight: FontWeight.w600, color: scheme.onSurface,
                )),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 10), vertical: Responsive.pad(context, 4)),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(status.toUpperCase(), style: TextStyle(fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w700, color: statusColor)),
              ),
            ],
          ),
          SizedBox(height: Responsive.pad(context, 16)),
          Row(
            children: [
              Expanded(child: _detailBox(LucideIcons.scanLine, 'Punch In', _fmtTime(punchIn))),
              SizedBox(width: Responsive.pad(context, 8)),
              Expanded(child: _detailBox(LucideIcons.power, 'Punch Out', _fmtTime(punchOut))),
              SizedBox(width: Responsive.pad(context, 8)),
              Expanded(child: _detailBox(LucideIcons.timer, 'Worked', hoursWorked?.toString() ?? '—')),
            ],
          ),
          if (lateMinutes != null && (lateMinutes as num) > 0) ...[
            SizedBox(height: Responsive.pad(context, 10)),
            Row(
              children: [
                Icon(LucideIcons.clock, size: Responsive.sp(context, 14), color: const Color(0xFFc28228)),
                SizedBox(width: Responsive.pad(context, 4)),
                Text('Late by ${lateMinutes} min', style: TextStyle(fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w700, color: const Color(0xFFc28228))),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _detailBox(IconData icon, String label, String value) {
    return Container(
      padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 10), horizontal: Responsive.pad(context, 8)),
      decoration: BoxDecoration(
        color: Theme.of(context).extension<AppColors>()!.surfaceContainerLow,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        children: [
          Icon(icon, size: Responsive.sp(context, 16), color: const Color(0xFF43474d)),
          SizedBox(height: Responsive.pad(context, 4)),
          Text(label, style: TextStyle(fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w600,
            color: const Color(0xFF74777e))),
          SizedBox(height: Responsive.pad(context, 2)),
          Text(value, style: TextStyle(fontSize: Responsive.sp(context, 13), fontWeight: FontWeight.w700, color: const Color(0xFF171c1f))),
        ],
      ),
    );
  }

  Widget _legendDot(String label, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 12, height: 12, decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(3),
        )),
        SizedBox(width: Responsive.pad(context, 6)),
        Text(label, style: TextStyle(fontSize: Responsive.sp(context, 12), color: Theme.of(context).colorScheme.onSurfaceVariant)),
      ],
    );
  }

  Widget _smLegendDot(IconData icon, String label, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: Responsive.sp(context, 10), color: color),
        SizedBox(width: Responsive.pad(context, 4)),
        Text(label, style: TextStyle(fontSize: Responsive.sp(context, 12), color: Theme.of(context).colorScheme.onSurfaceVariant)),
      ],
    );
  }
}
