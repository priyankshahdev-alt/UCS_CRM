import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:beneficiaries/features/beneficiaries/beneficiary_detail_page.dart';

void main() {
  testWidgets('give-swipe bar renders at bottom, below history',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2160);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: BeneficiaryDetailPage(
          beneficiary: const {
            'id': null,
            'full_name': 'Aarav Sharma',
            'beneficiary_code': 'UCS-001',
            'registration_date': '2026-01-15',
            'kit_given': false,
          },
        ),
      ),
    );
    await tester.pump();

    final headerTop = tester.getTopLeft(find.text('Beneficiary')).dy;
    final historyTop = tester.getTopLeft(find.text('History')).dy;
    final swipeFinder = find.text('Swipe to mark as given');
    final swipeTop = tester.getTopLeft(swipeFinder).dy;
    final swipeBottom = tester.getBottomLeft(swipeFinder).dy;
    final screenBottom = tester.getSize(find.byType(MaterialApp)).height;

    expect(find.text('Swipe to mark as given'), findsOneWidget,
        reason: 'give-swipe must be visible for a fresh beneficiary');
    expect(historyTop, greaterThan(headerTop),
        reason: 'History card must be below the header');
    expect(swipeTop, greaterThan(historyTop),
        reason: 'give-swipe bar must be below the History card');
    expect(swipeBottom, lessThan(screenBottom + 40),
        reason: 'give-swipe bar must sit at the bottom of the screen, '
            'not the top');
  });

  testWidgets('already-collected flow: profile + history render above the '
      'decision sheet at the bottom', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(720, 1600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: BeneficiaryDetailPage(
          beneficiary: const {
            'id': null,
            'full_name': 'Riya Patel',
            'beneficiary_code': 'UCS-042',
            'registration_date': '2026-09-24',
            'kit_given': true,
            'kit_given_at': '2026-09-24 10:30:00',
            'kit_given_by': 'shawnnn',
          },
        ),
      ),
    );
    // Let the post-frame callback open the decision sheet.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Already collected'), findsOneWidget,
        reason: 'decision sheet must open for an already-collected kit');

    final profileTop = tester.getTopLeft(find.text('Riya Patel')).dy;
    final historyTop = tester.getTopLeft(find.text('History')).dy;
    final sheetTop = tester.getTopLeft(find.text('Already collected')).dy;
    final screenBottom = tester.getSize(find.byType(MaterialApp)).height;

    expect(historyTop, greaterThan(profileTop),
        reason: 'History card must still render below the profile card');
    expect(sheetTop, greaterThan(historyTop),
        reason: 'decision sheet is a bottom sheet, below the content');
    expect(sheetTop, lessThan(screenBottom),
        reason: 'sheet sits at the bottom of the screen, not the top');
  });
}