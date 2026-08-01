import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/downloads_screen.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/subscribe_screen.dart';
import 'services/offline_manager.dart';
import 'state/auth_state.dart';
import 'state/player_state.dart';
import 'widgets/mini_player.dart';

void main() {
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthState()..load()),
        ChangeNotifierProvider(create: (_) => PlayerState()),
      ],
      child: const ProMusicApp(),
    ),
  );
}

class ProMusicApp extends StatelessWidget {
  const ProMusicApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ProMusic',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF121212),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1DB954),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      routes: {'/subscribe': (_) => const SubscribeScreen()},
      home: const _RootShell(),
    );
  }
}

class _RootShell extends StatefulWidget {
  const _RootShell();

  @override
  State<_RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<_RootShell> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    // App-launch license check, per offline_manager.dart's documented contract.
    OfflineManager.instance.refreshLicenses();
  }

  @override
  Widget build(BuildContext context) {
    final pages = const [
      HomeScreen(),
      DownloadsScreen(),
      SubscribeScreen(),
      SettingsScreen(),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('ProMusic')),
      body: pages[_tab],
      bottomNavigationBar: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const MiniPlayer(),
          NavigationBar(
            selectedIndex: _tab,
            onDestinationSelected: (i) => setState(() => _tab = i),
            destinations: const [
              NavigationDestination(
                icon: Icon(Icons.home_outlined),
                selectedIcon: Icon(Icons.home),
                label: 'Accueil',
              ),
              NavigationDestination(
                icon: Icon(Icons.download_outlined),
                selectedIcon: Icon(Icons.download),
                label: 'Téléchargements',
              ),
              NavigationDestination(
                icon: Icon(Icons.star_outline),
                selectedIcon: Icon(Icons.star),
                label: 'Abonnement',
              ),
              NavigationDestination(
                icon: Icon(Icons.settings_outlined),
                selectedIcon: Icon(Icons.settings),
                label: 'Session',
              ),
            ],
          ),
        ],
      ),
    );
  }
}
