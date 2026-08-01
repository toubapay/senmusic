import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:promusic/main.dart';
import 'package:promusic/state/auth_state.dart';
import 'package:promusic/state/player_state.dart';

Widget _app() => MultiProvider(
  providers: [
    ChangeNotifierProvider(create: (_) => AuthState()),
    ChangeNotifierProvider(create: (_) => PlayerState()),
  ],
  child: const ProMusicApp(),
);

void main() {
  testWidgets('App boots to the home tab with bottom navigation', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_app());
    await tester.pump();

    expect(find.text('ProMusic'), findsOneWidget);
    expect(find.text('Accueil'), findsOneWidget);
    expect(find.text('Parcourir par genre'), findsOneWidget);
  });

  testWidgets('Bottom nav has 5 tabs including Bibliothèque', (WidgetTester tester) async {
    await tester.pumpWidget(_app());
    await tester.pump();

    expect(find.byType(NavigationDestination), findsNWidgets(5));
    expect(find.text('Bibliothèque'), findsOneWidget);
    expect(find.text('Téléchargements'), findsOneWidget);
    expect(find.text('Abonnement'), findsOneWidget);
    expect(find.text('Session'), findsOneWidget);
  });

  testWidgets('Tapping Bibliothèque navigates to the Library screen', (WidgetTester tester) async {
    // LibraryScreen's actual playlist/liked-tracks content needs a real
    // backend (no HTTP mocking here), so this only checks the navigation
    // itself: the nav-bar label plus the destination Scaffold's AppBar
    // title both read "Bibliothèque" once there.
    await tester.pumpWidget(_app());
    await tester.pump();

    await tester.tap(find.text('Bibliothèque'));
    await tester.pump();

    expect(find.text('Bibliothèque'), findsNWidgets(2));
  });
}
