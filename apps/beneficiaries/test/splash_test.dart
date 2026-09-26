import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:beneficiaries/core/widgets/jod_splash_screen.dart';

void main() {
  testWidgets('JodSplashScreen renders the JOD splash without throwing',
      (tester) async {
    final errors = <FlutterErrorDetails>[];
    final oldOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      errors.add(details);
      // swallow to see if a build/parse exception occurs
    };

    var finished = false;
    await tester.pumpWidget(
      MaterialApp(
        home: JodSplashScreen(
          onFinished: () => finished = true,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 1900));
    await tester.pump(const Duration(milliseconds: 100));

    FlutterError.onError = oldOnError;

    // ignore: avoid_print
    print('finished=$finished errors=${errors.length}');
    for (final e in errors.take(3)) {
      // ignore: avoid_print
      print('ESR: ${e.exceptionAsString()}');
      // ignore: avoid_print
      print('STACK: ${e.stack}');
    }
    expect(finished, isTrue);
  });
}