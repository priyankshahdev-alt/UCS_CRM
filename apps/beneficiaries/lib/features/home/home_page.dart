import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/widgets/bottom_navigation.dart';
import '../../services/api_service.dart';
import '../../services/fingerprint_service.dart';
import 'widgets/kits_page.dart';
import '../profile/profile_page.dart';
import '../beneficiaries/fingerprint_lookup_page.dart';

class HomePage extends StatefulWidget {
  final VoidCallback onLogout;
  const HomePage({super.key, required this.onLogout});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _currentTab = 0;
  Map<String, dynamic>? _volunteerData;
  StreamSubscription<Map<String, dynamic>>? _deviceEventSub;

  @override
  void initState() {
    super.initState();
    FingerprintService.initialize();
    _loadData();
    _checkDevice();
    _deviceEventSub = FingerprintService.onEvent.listen(_handleDeviceEvent);
  }

  Future<void> _handleDeviceEvent(Map<String, dynamic> event) async {
    final type = event['type'];
    if (type == 'device_connected') {
      await _checkDevice();
    }
  }

  @override
  void dispose() {
    _deviceEventSub?.cancel();
    FingerprintService.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    _volunteerData = await ApiService.getVolunteerData();
    if (mounted) setState(() {});
  }

  Future<bool> _checkDevice() async {
    try {
      return await FingerprintService.ensureConnected();
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = _volunteerData?['name'] ?? 'Volunteer';
    final canAdd = [
      'super_admin',
      'admin',
      'ngo',
      'accounts',
      'event_head',
      'worker',
    ].contains(_volunteerData?['role']);
    final pages = [
      FingerprintLookupPage(name: name, canAdd: canAdd),
      _buildHomeContent(),
      ProfilePage(onLogout: widget.onLogout),
    ];

    return Scaffold(
      body: pages[_currentTab],
      bottomNavigationBar: BottomNavigation(
        currentIndex: _currentTab,
        onChanged: (i) {
          setState(() => _currentTab = i);
          if (i == 1) _kitCardKey.currentState?.refresh();
        },
      ),
    );
  }

  final GlobalKey<KitsPageState> _kitCardKey = GlobalKey();

  Widget _buildHomeContent() {
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        onRefresh: () async {
          await _loadData();
          await _checkDevice();
          await _kitCardKey.currentState?.refresh();
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
          children: [
            KitsPage(key: _kitCardKey),
          ],
        ),
      ),
    );
  }
}