import 'dart:async';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import '../services/api_service.dart';
import '../services/realtime_service.dart';
import '../services/remote_config_service.dart';
import '../widgets/skeleton_loader.dart';
import '../main.dart';
import '../utils/responsive.dart';

import 'scanner_page.dart';
import 'leave_page.dart';
import 'attendance_list_page.dart';
import 'advance_page.dart';

class HomePage extends StatefulWidget {
  final int tabChangeVersion;
  const HomePage({super.key, required this.tabChangeVersion});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  final ScrollController _scrollController = ScrollController();
  Timer? _clockTimer;
  Timer? _refreshTimer;
  DateTime _now = DateTime.now();
  DateTime? _punchInTime;
  DateTime? _punchOutTime;
  String _workedDisplay = '00:00:00';
  bool _isPunchedIn = false;
  bool _isPunchedOut = false;
  bool _loading = true;
  bool _isPressing = false;
  int _lateUsed = 0;
  String _workerName = '';
  String _workerId = '';
  String _officeStartTime = '10:00';
  late final AnimationController _pulseCtrl;
  late final Animation<double> _pulseAnim;
  String _officeEndTime = '19:00';
  List<Map<String, dynamic>> _notifications = [];
  int _unreadCount = 0;
  List<dynamic> _pendingLoans = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
    _pulseAnim = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeOut),
    );
    _clockTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      setState(() => _now = DateTime.now());
      if (_isPunchedIn && !_isPunchedOut) {
        _updateWorked();
      }
    });
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _fetchStatus();
    });
    _fetchStatus();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _fetchStatus();
    }
  }

  @override
  void didUpdateWidget(covariant HomePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.tabChangeVersion != oldWidget.tabChangeVersion) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) _scrollController.jumpTo(0);
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _clockTimer?.cancel();
    _refreshTimer?.cancel();
    _scrollController.dispose();
    _pulseCtrl.dispose();
    super.dispose();
  }

  void _updateWorked() {
    if (_punchInTime == null) return;
    final end = _punchOutTime ?? DateTime.now();
    final diff = end.difference(_punchInTime!);
    final h = diff.inHours.toString().padLeft(2, '0');
    final m = (diff.inMinutes % 60).toString().padLeft(2, '0');
    final s = (diff.inSeconds % 60).toString().padLeft(2, '0');
    _workedDisplay = '$h:$m:$s';
  }

  Future<void> _fetchStatus() async {
    try {
      final worker = await ApiService.getWorkerData();
      _workerName = worker?['name'] ?? '';
      _workerId = worker?['id']?.toString() ?? '';
      final isAdmin = (worker?['role']?.toString().toLowerCase() == 'admin' ||
          worker?['department']?.toString().toLowerCase() == 'ngo admin');

      if (_workerId.isNotEmpty) {
        try {
          RealtimeService.instance.init(_workerId, isAdmin: isAdmin);
        } catch (_) {}
      }
      RealtimeService.instance.removeListener(_onRealtimeChange);
      RealtimeService.instance.addListener(_onRealtimeChange);

      try {
        final cachedStatus = await ApiService.getCachedTodayStatus();
        if (cachedStatus != null) _applyTodayStatus(cachedStatus);
      } catch (_) {}

      try {
        if (_workerId.isNotEmpty) {
          final cachedNotifs = await ApiService.getCachedNotifications(_workerId);
          final cachedUnread = await ApiService.getCachedUnreadCount(_workerId);
          if (cachedNotifs != null) {
            setState(() {
              _notifications = cachedNotifs.cast<Map<String, dynamic>>();
              _unreadCount = cachedUnread;
            });
          }
        }
      } catch (_) {}
    } catch (_) {}

    if (mounted) setState(() => _loading = false);

    try {
      final today = await ApiService.getTodayStatus();

      _officeStartTime = (today['officeStartTime'] ?? '10:00') as String;
      _officeEndTime = (today['officeEndTime'] ?? '19:00') as String;

      final att = today['attendance'];
      if (mounted) {
        setState(() {
          _lateUsed = today['lateUsed'] ?? 0;
          if (att != null) {
            _isPunchedIn = att['punch_in_time'] != null;
            _isPunchedOut = att['punch_out_time'] != null;
            _punchInTime = att['punch_in_time'] != null
                ? DateTime.tryParse(att['punch_in_time'].toString())
                : null;
            _punchOutTime = att['punch_out_time'] != null
                ? DateTime.tryParse(att['punch_out_time'].toString())
                : null;
            if (_isPunchedIn && !_isPunchedOut) {
              _updateWorked();
            }
            if (_isPunchedOut && _punchInTime != null && _punchOutTime != null) {
              final diff = _punchOutTime!.difference(_punchInTime!);
              final h = diff.inHours.toString().padLeft(2, '0');
              final m = (diff.inMinutes % 60).toString().padLeft(2, '0');
              final s = (diff.inSeconds % 60).toString().padLeft(2, '0');
              _workedDisplay = '$h:$m:$s';
            }
          }
        });
      }
    } catch (_) {}

    try {
      if (_workerId.isNotEmpty) {
        final notifs = await ApiService.getNotifications(_workerId);
        final unread = await ApiService.getUnreadNotificationCount(_workerId);
        if (mounted) {
          setState(() {
            _notifications = notifs.cast<Map<String, dynamic>>();
            _unreadCount = unread;
          });
        }
      }
    } catch (_) {}

    try {
      final loans = await ApiService.getMyLoans();
      if (mounted) {
        setState(() {
          _pendingLoans = loans.where((l) => l['status'] == 'approved' || l['status'] == 'pending').toList();
        });
      }
    } catch (_) {}
  }

  void _applyTodayStatus(Map<String, dynamic> today) {
    final att = today['attendance'];
    setState(() {
      _officeStartTime = (today['officeStartTime'] ?? '10:00') as String;
      _officeEndTime = (today['officeEndTime'] ?? '19:00') as String;
      _lateUsed = today['lateUsed'] ?? 0;
      if (att != null) {
        _isPunchedIn = att['punch_in_time'] != null;
        _isPunchedOut = att['punch_out_time'] != null;
        _punchInTime = att['punch_in_time'] != null
            ? DateTime.tryParse(att['punch_in_time'].toString())
            : null;
        _punchOutTime = att['punch_out_time'] != null
            ? DateTime.tryParse(att['punch_out_time'].toString())
            : null;
        if (_isPunchedIn && !_isPunchedOut) _updateWorked();
        if (_isPunchedOut && _punchInTime != null && _punchOutTime != null) {
          final diff = _punchOutTime!.difference(_punchInTime!);
          final h = diff.inHours.toString().padLeft(2, '0');
          final m = (diff.inMinutes % 60).toString().padLeft(2, '0');
          final s = (diff.inSeconds % 60).toString().padLeft(2, '0');
          _workedDisplay = '$h:$m:$s';
        }
      }
    });
  }

  void _cacheTodayState(String? punchIn, String? punchOut) {
    final today = {
      'officeStartTime': _officeStartTime,
      'officeEndTime': _officeEndTime,
      'lateUsed': _lateUsed,
      'attendance': {
        'punch_in_time': punchIn,
        'punch_out_time': punchOut,
      },
    };
    ApiService.cacheTodayStatus(today);
  }

  Future<bool> _requestLocationPermission() async {
    bool service = await Geolocator.isLocationServiceEnabled();
    if (!service) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: const Text('Please enable GPS location'), backgroundColor: Colors.red.shade700),
        );
      }
      return false;
    }
    LocationPermission perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: const Text('Location permission is required to punch in/out'), backgroundColor: Colors.red.shade700),
          );
        }
        return false;
      }
    }
    if (perm == LocationPermission.deniedForever) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: const Text('Location permission permanently denied. Enable it in app settings.'), backgroundColor: Colors.red.shade700),
        );
      }
      return false;
    }
    return true;
  }

  Future<void> _punchIn() async {
    if (!await _requestLocationPermission()) return;

    final online = await ApiService.checkConnectivity();
    if (!online && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No internet connection. Please check your network.'),
          backgroundColor: Colors.red,
          duration: Duration(seconds: 3),
        ),
      );
      return;
    }

    final result = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(builder: (_) => const ScannerPage()),
    );
    if (result == null || !mounted) return;

    try {
      final data = await ApiService.punchIn(
        result['code'] ?? '',
        (result['lat'] as num).toDouble(),
        (result['lng'] as num).toDouble(),
        punchMethod: result['punch_method'] as String?,
      );
      final lm = (data['lateMinutes'] ?? 0) as int;
      final now = DateTime.now();
      setState(() {
        _isPunchedIn = true;
        _punchInTime = now;
        _isPunchedOut = false;
        _punchOutTime = null;
        if (lm > 0) _lateUsed += lm;
        _updateWorked();
      });
      _cacheTodayState(now.toIso8601String(), null);
      if (mounted) {
        HapticFeedback.vibrate();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Punched in successfully'),
            backgroundColor: const Color(0xFF10b981),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        final msg = _friendlyNetworkError(e);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(msg),
            backgroundColor: Colors.red.shade700,
          ),
        );
      }
    }
  }

  Future<void> _punchOut() async {
    if (!await _requestLocationPermission()) return;

    final online = await ApiService.checkConnectivity();
    if (!online && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No internet connection. Please check your network.'),
          backgroundColor: Colors.red,
          duration: Duration(seconds: 3),
        ),
      );
      return;
    }

    final result = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(builder: (_) => const ScannerPage()),
    );
    if (result == null || !mounted) return;

    try {
      await ApiService.punchOut(
        (result['lat'] as num).toDouble(),
        (result['lng'] as num).toDouble(),
        punchMethod: result['punch_method'] as String?,
      );
      final now = DateTime.now();
      setState(() {
        _isPunchedOut = true;
        _punchOutTime = now;
        _updateWorked();
      });
      _cacheTodayState(_punchInTime?.toIso8601String(), now.toIso8601String());
      if (mounted) {
        HapticFeedback.vibrate();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Punched out successfully'),
            backgroundColor: const Color(0xFF10b981),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        final msg = _friendlyNetworkError(e);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(msg),
            backgroundColor: Colors.red.shade700,
          ),
        );
      }
    }
  }

  void _onRealtimeChange() {
    final event = RealtimeService.instance.lastEvent;
    if (event == null) return;
    switch (event) {
      case RealtimeEvent.attendance:
      case RealtimeEvent.notifications:
      case RealtimeEvent.corrections:
      case RealtimeEvent.loans:
        _fetchStatus();
      default:
        break;
    }
  }

  String _friendlyNetworkError(Object e) {
    final s = e.toString();
    if (s.contains('SocketException') || s.contains('Connection refused') || s.contains('No route to host')) {
      return 'Network unreachable. Please check your internet connection.';
    }
    if (s.contains('TimeoutException') || s.contains('timed out')) {
      return 'Request timed out. Please try again.';
    }
    if (s.contains('FormatException') || s.contains('json')) {
      return 'Server error. Please try again later.';
    }
    return s.replaceFirst('Exception: ', '').trim();
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

  void _openRequestSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _RequestSheet(),
    );
  }

  void _openLateBatchSheet() {
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
          child: Column(
            children: [
              SizedBox(height: Responsive.pad(context, 12)),
              Container(
                width: 40, height: 4,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              SizedBox(height: Responsive.pad(context, 12)),
              Expanded(child: AttendanceListPage()),
            ],
          ),
        ),
      ),
    );
  }

  void _openNotificationSheet() {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _NotificationSheet(
        notifications: _notifications,
        unreadCount: _unreadCount,
        workerId: _workerId,
        scheme: scheme,
        textTheme: textTheme,
        onMarkRead: (id) async {
          try {
            await ApiService.markNotificationRead(id);
            final idx = _notifications.indexWhere((n) => n['id'] == id);
            if (idx != -1) {
              setState(() {
                _notifications[idx]['read_at'] = DateTime.now().toIso8601String();
                _unreadCount = _notifications.where((n) => n['read_at'] == null).length;
              });
            }
          } catch (_) {}
        },
        onDelete: (id) async {
          try {
            await ApiService.deleteNotification(id);
          } catch (e) {
            debugPrint('deleteNotification error: $e');
          }
          setState(() {
            _notifications.removeWhere((n) => n['id'] == id);
            _unreadCount = _notifications.where((n) => n['read_at'] == null).length;
          });
        },
        onRefresh: () async {
          if (_workerId.isNotEmpty) {
            try {
              final notifs = await ApiService.getNotifications(_workerId);
              final unread = await ApiService.getUnreadNotificationCount(_workerId);
              setState(() {
                _notifications = notifs.cast<Map<String, dynamic>>();
                _unreadCount = unread;
              });
            } catch (_) {}
          }
        },
      ),
    );
  }

  int get _lateTier {
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

  String get _lateTierLabel {
    switch (_lateTier) {
      case 0: return 'Within grace limit';
      case 1: return 'Half-day deduction';
      case 2: return 'One-day deduction';
      case 3: return 'Proportional deduction';
      default: return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const HomeSkeleton();

    final sc = Theme.of(context).colorScheme;
    final colors = Theme.of(context).extension<AppColors>()!;

    final clockStr = DateFormat('hh:mm a').format(_now);
    final firstName = _workerName.split(' ').first;
    final displayName = firstName.isNotEmpty
        ? '${firstName[0].toUpperCase()}${firstName.substring(1).toLowerCase()}'
        : 'there';

    return Scaffold(
      backgroundColor: sc.surface,
      body: SafeArea(
        child: CustomScrollView(
          controller: _scrollController,
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(Responsive.pad(context, 16), Responsive.pad(context, 8), Responsive.pad(context, 16), Responsive.pad(context, 0)),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            RemoteConfigService.instance.uiText('home_hello') ?? 'HELLO THERE',
                            style: TextStyle(
                              fontSize: Responsive.sp(context, 12), fontWeight: FontWeight.w600, letterSpacing: 0.05,
                              color: const Color(0xFF00152a),
                            ),
                          ),
                          SizedBox(height: Responsive.pad(context, 2)),
                          Text(
                            displayName,
                            style: GoogleFonts.hankenGrotesk(
                              fontSize: Responsive.sp(context, 24),
                              fontWeight: FontWeight.w700,
                              height: 32 / 24,
                              color: sc.onSurface,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Stack(
                      children: [
                        Container(
                          width: Responsive.sp(context, 48),
                          height: Responsive.sp(context, 48),
                          decoration: BoxDecoration(
                            color: colors.surfaceContainerLow,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: colors.outline),
                          ),
                          child: IconButton(
                            icon: Icon(LucideIcons.bell),
                            iconSize: Responsive.sp(context, 22),
                            color: sc.onSurfaceVariant,
                            onPressed: _openNotificationSheet,
                          ),
                        ),
                        if (_unreadCount > 0)
                          Positioned(
                            top: 4,
                            right: 4,
                            child: Container(
                              padding: EdgeInsets.all(Responsive.pad(context, 4)),
                              decoration: BoxDecoration(
                                color: const Color(0xFFba1a1a),
                                shape: BoxShape.circle,
                              ),
                              constraints: BoxConstraints(
                                minWidth: Responsive.sp(context, 18),
                                minHeight: Responsive.sp(context, 18),
                              ),
                              child: Text(
                                '$_unreadCount',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: Responsive.sp(context, 10),
                                  fontWeight: FontWeight.w700,
                                ),
                                textAlign: TextAlign.center,
                              ),
                            ),
                    ),
                    SizedBox(height: Responsive.pad(context, 16)),
                  ],
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(Responsive.pad(context, 16), Responsive.pad(context, 0), Responsive.pad(context, 16), Responsive.pad(context, 0)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    SizedBox(height: Responsive.pad(context, 16)),
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 12), vertical: Responsive.pad(context, 8)),
                      decoration: BoxDecoration(
                        color: sc.surface,
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: colors.outline),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'SHIFT',
                            style: TextStyle(
                              fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w700, letterSpacing: 0.05,
                              color: sc.outline,
                            ),
                          ),
                          SizedBox(width: Responsive.pad(context, 8)),
                          Text(
                            '$_officeStartTime – $_officeEndTime',
                            style: TextStyle(
                              fontSize: Responsive.sp(context, 14), fontWeight: FontWeight.w600,
                              color: sc.onSurface,
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: Responsive.pad(context, 32)),
                    Text(
                      clockStr,
                      style: GoogleFonts.hankenGrotesk(
                        fontSize: Responsive.sp(context, 64),
                        fontWeight: FontWeight.w800,
                        height: 64 / 64,
                        letterSpacing: -1.5,
                        color: sc.onSurface,
                      ),
                    ),
                    SizedBox(height: Responsive.pad(context, 12)),
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 16), vertical: Responsive.pad(context, 8)),
                      decoration: BoxDecoration(
                        color: const Color(0xFFbfdbfe).withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(LucideIcons.clock, size: Responsive.sp(context, 18), color: const Color(0xFF1d4ed8)),
                          SizedBox(width: Responsive.pad(context, 6)),
                          Text(
                            '$_workedDisplay',
                            style: TextStyle(
                              fontSize: Responsive.sp(context, 14), fontWeight: FontWeight.w500,
                              color: const Color(0xFF1d4ed8),
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: Responsive.pad(context, 40)),
                    if (_isPunchedOut)
                      Column(
                        children: [
                          Icon(LucideIcons.circleCheck, size: Responsive.sp(context, 72), color: const Color(0xFF2563eb)),
                          SizedBox(height: Responsive.pad(context, 12)),
                          Text('Today completed', style: GoogleFonts.hankenGrotesk(
                            fontSize: Responsive.sp(context, 18), fontWeight: FontWeight.w600, color: sc.onSurface,
                          )),
                        ],
                      )
                    else
                      SizedBox(
                        width: 192,
                        height: 192,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            for (final i in [0, 1, 2])
                              AnimatedBuilder(
                                animation: _pulseAnim,
                                builder: (context, child) {
                                  final phase = i * 0.33;
                                  final t = (_pulseAnim.value + phase) % 1.0;
                                  final scale = 1.0 + t * 0.6;
                                  final opacity = (1.0 - t) * 0.2;
                                  return Transform.scale(
                                    scale: scale,
                                    child: Opacity(
                                      opacity: opacity,
                                      child: Container(
                                        width: 192,
                                        height: 192,
                                        decoration: BoxDecoration(
                                          shape: BoxShape.circle,
                                          border: Border.all(
                                            color: _isPunchedIn
                                                ? const Color(0xFF2563eb).withValues(alpha: 0.5)
                                                : const Color(0xFF00152a).withValues(alpha: 0.5),
                                            width: 2,
                                          ),
                                        ),
                                      ),
                                    ),
                                  );
                                },
                              ),
                            AnimatedScale(
                              scale: _isPressing ? 0.92 : 1.0,
                              duration: const Duration(milliseconds: 100),
                              child: GestureDetector(
                              onTap: _isPunchedIn ? _punchOut : _punchIn,
                              onTapDown: (_) => setState(() => _isPressing = true),
                              onTapUp: (_) => setState(() => _isPressing = false),
                              onTapCancel: () => setState(() => _isPressing = false),
                              child: Container(
                                width: 192,
                                height: 192,
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                    colors: _isPunchedIn
                                        ? [const Color(0xFF2563eb), const Color(0xFF1e40af)]
                                        : [const Color(0xFF00152a), const Color(0xFF102a43)],
                                  ),
                                  shape: BoxShape.circle,
                                  boxShadow: [
                                    BoxShadow(
                                      color: _isPunchedIn
                                          ? const Color(0xFF2563eb).withValues(alpha: 0.4)
                                          : const Color(0xFF00152a).withValues(alpha: 0.4),
                                      blurRadius: 40,
                                      offset: const Offset(0, 20),
                                    ),
                                  ],
                                ),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(
                                      _isPunchedIn ? LucideIcons.power : LucideIcons.scanLine,
                                      size: Responsive.sp(context, 48),
                                      color: Colors.white,
                                    ),
                                    SizedBox(height: Responsive.pad(context, 8)),
                                    Text(
                                      _isPunchedIn ? 'Punch Out' : 'Punch In',
                                      style: TextStyle(
                                        fontSize: Responsive.sp(context, 12), fontWeight: FontWeight.w700, letterSpacing: 1.5,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          ],
                        ),
                      ),
                    SizedBox(height: Responsive.pad(context, 40)),
                    Row(
                      children: [
                        Expanded(
                          child: Container(
                            padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 20), horizontal: Responsive.pad(context, 16)),
                            decoration: BoxDecoration(
                              color: sc.surface,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: colors.outline),
                            ),
                            child: Column(
                              children: [
                                Text(
                                  'IN',
                                  style: TextStyle(
                                    fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w700, letterSpacing: 1.0,
                                    color: sc.outline,
                                  ),
                                ),
                                SizedBox(height: Responsive.pad(context, 6)),
                                Text(
                                  _fmtTime(_punchInTime),
                                  style: GoogleFonts.hankenGrotesk(
                                    fontSize: Responsive.sp(context, 20),
                                    fontWeight: FontWeight.w700,
                                    color: sc.onSurface,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        SizedBox(width: Responsive.pad(context, 12)),
                        Expanded(
                          child: Container(
                            padding: EdgeInsets.symmetric(vertical: Responsive.pad(context, 20), horizontal: Responsive.pad(context, 16)),
                            decoration: BoxDecoration(
                              color: sc.surface,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: colors.outline),
                            ),
                            child: Column(
                              children: [
                                Text(
                                  'OUT',
                                  style: TextStyle(
                                    fontSize: Responsive.sp(context, 11), fontWeight: FontWeight.w700, letterSpacing: 1.0,
                                    color: sc.outline,
                                  ),
                                ),
                                SizedBox(height: Responsive.pad(context, 6)),
                                Text(
                                  _fmtTime(_punchOutTime),
                                  style: GoogleFonts.hankenGrotesk(
                                    fontSize: Responsive.sp(context, 20),
                                    fontWeight: FontWeight.w700,
                                    color: sc.onSurface,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(Responsive.pad(context, 16), Responsive.pad(context, 24), Responsive.pad(context, 16), Responsive.pad(context, 0)),
                child: GestureDetector(
                  onTap: _openLateBatchSheet,
                  child: Container(
                    padding: EdgeInsets.all(Responsive.pad(context, 16)),
                    decoration: BoxDecoration(
                      color: sc.surface,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: colors.outline),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: Responsive.sp(context, 48), height: Responsive.sp(context, 48),
                          decoration: BoxDecoration(
                            color: _lateTierColor.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Icon(LucideIcons.clock, size: Responsive.sp(context, 22), color: _lateTierColor),
                        ),
                        SizedBox(width: Responsive.pad(context, 16)),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text('Late Batch', style: GoogleFonts.hankenGrotesk(
                                    fontSize: Responsive.sp(context, 16), fontWeight: FontWeight.w600, color: sc.onSurface,
                                  )),
                                  SizedBox(width: Responsive.pad(context, 8)),
                                  Container(
                                    padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 6), vertical: Responsive.pad(context, 2)),
                                    decoration: BoxDecoration(
                                      color: _lateTierColor.withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(3),
                                    ),
                                    child: Text(
                                      _lateTierLabel,
                                      style: TextStyle(
                                        fontSize: Responsive.sp(context, 9), fontWeight: FontWeight.w700,
                                        color: _lateTierColor,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: Responsive.pad(context, 2)),
                              Text(
                                '${_lateUsed ~/ 60}:${(_lateUsed % 60).toString().padLeft(2, '0')}h used',
                                style: TextStyle(
                                  fontSize: Responsive.sp(context, 12), fontWeight: FontWeight.w500,
                                  color: sc.onSurfaceVariant,
                                ),
                              ),
                              SizedBox(height: Responsive.pad(context, 8)),
                              LayoutBuilder(
                                builder: (context, constraints) {
                                  const batch1End = 180;
                                  const batch2End = 240;
                                  final totalWidth = constraints.maxWidth;
                                  final pct1 = (_lateUsed / batch1End).clamp(0.0, 1.0);
                                  final pct2 = _lateUsed > batch1End
                                      ? ((_lateUsed - batch1End) / (batch2End - batch1End)).clamp(0.0, 1.0)
                                      : 0.0;
                                  final batch1Width = totalWidth * 0.6;
                                  final batch2Width = totalWidth * 0.4;

                                  return Column(
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(
                                            flex: _lateUsed > 180 ? 6 : 10,
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                ClipRRect(
                                                  borderRadius: BorderRadius.circular(3),
                                                  child: Stack(
                                                    children: [
                                                      Container(height: 6, color: colors.outlineVariant),
                                                      Positioned(
                                                        left: 0, top: 0, bottom: 0,
                                                        child: Container(
                                                          width: batch1Width * pct1,
                                                          decoration: BoxDecoration(
                                                            color: const Color(0xFF2a6a4b),
                                                            borderRadius: BorderRadius.circular(3),
                                                          ),
                                                        ),
                                                      ),
                                                    ],
                                                  ),
                                                ),
                                                SizedBox(height: 2),
                                                Text('0–180m', style: TextStyle(fontSize: 8, color: sc.outline)),
                                              ],
                                            ),
                                          ),
                                          if (_lateUsed > batch1End) ...[
                                            SizedBox(width: 6),
                                            Expanded(
                                              flex: 4,
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  ClipRRect(
                                                    borderRadius: BorderRadius.circular(3),
                                                    child: Stack(
                                                      children: [
                                                        Container(height: 6, color: colors.outlineVariant),
                                                        Positioned(
                                                          left: 0, top: 0, bottom: 0,
                                                          child: Container(
                                                            width: batch2Width * pct2,
                                                            decoration: BoxDecoration(
                                                              color: const Color(0xFFe67e22),
                                                              borderRadius: BorderRadius.circular(3),
                                                            ),
                                                          ),
                                                        ),
                                                      ],
                                                    ),
                                                  ),
                                                  SizedBox(height: 2),
                                                  Text('181–240m', style: TextStyle(fontSize: 8, color: sc.outline)),
                                                ],
                                              ),
                                            ),
                                          ],
                                        ],
                                      ),
                                    ],
                                  );
                                },
                              ),
                            ],
                          ),
                        ),
                        Icon(LucideIcons.chevronRight, size: Responsive.sp(context, 20), color: sc.outline),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            if (_pendingLoans.isNotEmpty &&
                RemoteConfigService.instance.featureFlag('show_pending_loans'))
              SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(Responsive.pad(context, 16), Responsive.pad(context, 24), Responsive.pad(context, 16), Responsive.pad(context, 0)),
                  child: Container(
                    padding: EdgeInsets.all(Responsive.pad(context, 16)),
                    decoration: BoxDecoration(
                      color: sc.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: colors.outline),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: Responsive.sp(context, 48), height: Responsive.sp(context, 48),
                          decoration: BoxDecoration(
                            color: const Color(0xFFfff3cd),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Icon(LucideIcons.wallet, size: Responsive.sp(context, 22), color: Color(0xFF856404)),
                        ),
                        SizedBox(width: Responsive.pad(context, 16)),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Pending Loans', style: GoogleFonts.hankenGrotesk(
                                fontSize: Responsive.sp(context, 16), fontWeight: FontWeight.w600, color: sc.onSurface,
                              )),
                              Text(
                                '${_pendingLoans.length} active \u00B7 \u20B9${_pendingLoans.fold<int>(0, (s, l) => s + ((l['remaining_amount'] ?? l['total_amount'] ?? 0) as int))}',
                                style: TextStyle(
                                  fontSize: Responsive.sp(context, 12), fontWeight: FontWeight.w500,
                                  color: sc.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            if (RemoteConfigService.instance.featureFlag('show_requests'))
              SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(Responsive.pad(context, 16), Responsive.pad(context, 24), Responsive.pad(context, 16), Responsive.pad(context, 80)),
                  child: Container(
                    padding: EdgeInsets.all(Responsive.pad(context, 16)),
                    decoration: BoxDecoration(
                      color: sc.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: colors.outline),
                    ),
                    child: InkWell(
                      onTap: _openRequestSheet,
                      child: Row(
                        children: [
                          Container(
                            width: Responsive.sp(context, 48), height: Responsive.sp(context, 48),
                            decoration: BoxDecoration(
                              color: const Color(0xFFd1e4ff),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Icon(LucideIcons.sparkles, size: Responsive.sp(context, 22), color: Color(0xFF00152a)),
                          ),
                          SizedBox(width: Responsive.pad(context, 16)),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('New Request', style: GoogleFonts.hankenGrotesk(
                                  fontSize: Responsive.sp(context, 16), fontWeight: FontWeight.w600, color: sc.onSurface,
                                )),
                                Text('Leave, advance, or loan', style: TextStyle(
                                  fontSize: Responsive.sp(context, 12), fontWeight: FontWeight.w500,
                                  color: sc.onSurfaceVariant,
                                )),
                              ],
                            ),
                          ),
                          Icon(LucideIcons.chevronRight, size: Responsive.sp(context, 20), color: sc.outline),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _RequestSheet extends StatefulWidget {
  const _RequestSheet();

  @override
  State<_RequestSheet> createState() => _RequestSheetState();
}

class _RequestSheetState extends State<_RequestSheet> with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sc = Theme.of(context).colorScheme;
    final colors = Theme.of(context).extension<AppColors>()!;
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.90,
      child: Container(
        decoration: BoxDecoration(
          color: sc.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        ),
        child: Column(
          children: [
            SizedBox(height: Responsive.pad(context, 12)),
            Container(
              width: 40, height: 4,
              decoration: BoxDecoration(
                color: sc.outlineVariant,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            SizedBox(height: Responsive.pad(context, 8)),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: Responsive.pad(context, 16)),
              child: Container(
                height: Responsive.sp(context, 40),
                decoration: BoxDecoration(
                  color: colors.surfaceContainerHigh,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: TabBar(
                  controller: _tabCtrl,
                  indicatorSize: TabBarIndicatorSize.tab,
                  indicatorPadding: EdgeInsets.zero,
                  indicator: BoxDecoration(
                    color: sc.surface,
                    borderRadius: BorderRadius.circular(7),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.06),
                        blurRadius: 4,
                        offset: const Offset(0, 1),
                      ),
                    ],
                  ),
                  dividerColor: Colors.transparent,
                  labelColor: sc.onSurface,
                  unselectedLabelColor: sc.onSurfaceVariant,
                  labelStyle: GoogleFonts.hankenGrotesk(fontSize: Responsive.sp(context, 13), fontWeight: FontWeight.w600),
                  unselectedLabelStyle: GoogleFonts.hankenGrotesk(fontSize: Responsive.sp(context, 13), fontWeight: FontWeight.w500),
                  splashBorderRadius: BorderRadius.circular(7),
                  tabs: const [
                    Tab(text: 'Leave'),
                    Tab(text: 'Advance'),
                  ],
                ),
              ),
            ),
            SizedBox(height: Responsive.pad(context, 8)),
            Expanded(
              child: TabBarView(
                controller: _tabCtrl,
                children: [
                  LeavePage(),
                  AdvancePage(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

IconData _notifIcon(String? type) {
  switch (type) {
    case 'birthday':
      return LucideIcons.cake;
    case 'event':
      return LucideIcons.calendar;
    case 'notice':
      return LucideIcons.megaphone;
    case 'achievement':
      return LucideIcons.trophy;
    default:
      return LucideIcons.bell;
  }
}

Color _notifColor(String? type, ColorScheme sc) {
  switch (type) {
    case 'birthday':
      return const Color(0xFFf43f5e);
    case 'event':
      return const Color(0xFF2563eb);
    case 'notice':
      return const Color(0xFF00152a);
    case 'achievement':
      return const Color(0xFFf59e0b);
    default:
      return sc.onSurfaceVariant;
  }
}

class _NotificationSheet extends StatefulWidget {
  final List<Map<String, dynamic>> notifications;
  final int unreadCount;
  final String workerId;
  final ColorScheme scheme;
  final TextTheme textTheme;
  final Function(String id) onMarkRead;
  final Function(String id) onDelete;
  final VoidCallback? onRefresh;

  const _NotificationSheet({
    required this.notifications,
    required this.unreadCount,
    required this.workerId,
    required this.scheme,
    required this.textTheme,
    required this.onMarkRead,
    required this.onDelete,
    this.onRefresh,
  });

  @override
  State<_NotificationSheet> createState() => _NotificationSheetState();
}

class _NotificationSheetState extends State<_NotificationSheet> {
  late List<Map<String, dynamic>> _items;
  @override
  void initState() {
    super.initState();
    _items = List.from(widget.notifications);
  }

  @override
  Widget build(BuildContext context) {
    final sc = Theme.of(context).colorScheme;
    final colors = Theme.of(context).extension<AppColors>()!;
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.85,
      child: Container(
        decoration: BoxDecoration(
          color: sc.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
        ),
        child: ListView(
          padding: EdgeInsets.fromLTRB(Responsive.pad(context, 16), Responsive.pad(context, 16), Responsive.pad(context, 16), Responsive.pad(context, 32)),
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: EdgeInsets.only(bottom: Responsive.pad(context, 24)),
                decoration: BoxDecoration(
                  color: const Color(0xFFdfe3e7),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Row(
              children: [
                Container(
                  width: Responsive.sp(context, 44),
                  height: Responsive.sp(context, 44),
                  decoration: BoxDecoration(
                    color: const Color(0xFFd1e4ff),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Icon(LucideIcons.bellRing, color: Color(0xFF00152a), size: Responsive.sp(context, 22)),
                ),
                SizedBox(width: Responsive.pad(context, 16)),
                Text(
                  'Notifications',
                  style: GoogleFonts.hankenGrotesk(
                    fontSize: Responsive.sp(context, 20),
                    fontWeight: FontWeight.w600,
                    color: sc.onSurface,
                  ),
                ),
                const Spacer(),
                if (_items.isNotEmpty)
                  Text(
                    '${widget.unreadCount} unread',
                    style: TextStyle(
                      fontSize: Responsive.sp(context, 12), fontWeight: FontWeight.w600,
                      color: sc.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
            SizedBox(height: Responsive.pad(context, 24)),
            if (_items.isEmpty)
              Padding(
                padding: EdgeInsets.only(top: Responsive.pad(context, 40)),
                child: Center(
                  child: Column(
                    children: [
                      Icon(LucideIcons.bellOff, size: Responsive.sp(context, 48), color: sc.outline.withValues(alpha: 0.3)),
                      SizedBox(height: Responsive.pad(context, 12)),
                      Text('No notifications yet', style: TextStyle(
                        fontSize: Responsive.sp(context, 14), color: sc.outline.withValues(alpha: 0.6),
                      )),
                    ],
                  ),
                ),
              )
            else
              ..._items.asMap().entries.map((entry) {
                final i = entry.key;
                final n = entry.value;
                final isLast = i == _items.length - 1;
                final isRead = n['read_at'] != null;
                return Column(
                  children: [
                    Dismissible(
                      key: ValueKey('notif_${n['id']}'),
                      direction: DismissDirection.horizontal,
                      background: Container(
                        alignment: Alignment.centerLeft,
                        padding: EdgeInsets.only(left: Responsive.pad(context, 16)),
                        decoration: BoxDecoration(
                          color: const Color(0xFF2563eb),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          children: [
                            Icon(LucideIcons.checkCheck, color: Colors.white, size: Responsive.sp(context, 20)),
                            SizedBox(width: Responsive.pad(context, 8)),
                            Text('Read', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: Responsive.sp(context, 13))),
                          ],
                        ),
                      ),
                      secondaryBackground: Container(
                        alignment: Alignment.centerRight,
                        padding: EdgeInsets.only(right: Responsive.pad(context, 16)),
                        decoration: BoxDecoration(
                          color: const Color(0xFFba1a1a),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('Delete', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: Responsive.sp(context, 13))),
                            SizedBox(width: Responsive.pad(context, 8)),
                            Icon(LucideIcons.trash2, color: Colors.white, size: Responsive.sp(context, 20)),
                          ],
                        ),
                      ),
                      confirmDismiss: (direction) async {
                        if (direction == DismissDirection.startToEnd) {
                          await widget.onMarkRead(n['id'].toString());
                          setState(() => n['read_at'] = DateTime.now().toIso8601String());
                          return false;
                        } else {
                          await widget.onDelete(n['id'].toString());
                          setState(() => _items.removeAt(i));
                          return true;
                        }
                      },
                      child: Opacity(
                        opacity: isRead ? 0.5 : 1,
                        child: Container(
                          padding: EdgeInsets.all(Responsive.pad(context, 16)),
                          decoration: BoxDecoration(
                            color: !isRead
                                ? colors.surfaceContainerHigh
                                : colors.surfaceContainerLow,
                            borderRadius: BorderRadius.circular(8),
                            border: !isRead ? Border.all(color: colors.outline.withValues(alpha: 0.3)) : null,
                          ),
                          child: Row(
                            children: [
                              Icon(
                                _notifIcon(n['type']?.toString()),
                                size: Responsive.sp(context, 20),
                                color: _notifColor(n['type']?.toString(), sc),
                              ),
                              SizedBox(width: Responsive.pad(context, 14)),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      n['title'] ?? '',
                                      style: TextStyle(
                                        fontSize: Responsive.sp(context, 14), fontWeight: FontWeight.w600,
                                        color: sc.onSurface,
                                      ),
                                    ),
                                    SizedBox(height: Responsive.pad(context, 2)),
                                    Text(
                                      n['body'] ?? '',
                                      style: TextStyle(
                                        fontSize: Responsive.sp(context, 12),
                                        color: sc.outline,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                         ),
                        ),
                      ),
                      if (!isLast) SizedBox(height: Responsive.pad(context, 12)),
                    ],
                  );
              }),
            SizedBox(height: Responsive.pad(context, 8)),
            SizedBox(
              width: double.infinity,
              height: Responsive.sp(context, 48),
              child: ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: colors.surfaceContainerHigh,
                  foregroundColor: sc.onSurface,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                child: Text('Close', style: GoogleFonts.hankenGrotesk(
                  fontSize: Responsive.sp(context, 14), fontWeight: FontWeight.w700,
                )),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
