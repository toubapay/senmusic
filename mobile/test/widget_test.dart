import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:promusic/main.dart';
import 'package:promusic/state/auth_state.dart';
import 'package:promusic/state/player_state.dart';

void main() {
  testWidgets('App boots to the home tab with bottom navigation', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => AuthState()),
          ChangeNotifierProvider(create: (_) => PlayerState()),
        ],
        child: const ProMusicApp(),
      ),
    );
    await tester.pump();

    expect(find.text('ProMusic'), findsOneWidget);
    expect(find.text('Accueil'), findsOneWidget);
    expect(find.text('Parcourir par genre'), findsOneWidget);
  });
}
