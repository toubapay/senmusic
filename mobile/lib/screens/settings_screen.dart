import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/auth_state.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _controller;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: context.read<AuthState>().token ?? '',
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await context.read<AuthState>().setToken(_controller.text.trim());
    setState(() => _saved = true);
    Future.delayed(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _saved = false);
    });
  }

  Future<void> _clear() async {
    await context.read<AuthState>().signOut();
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Session')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Aucune page de connexion n'existe encore côté API — collez un "
              'JWT de session ici pour tester l\'app.',
              style: TextStyle(color: Colors.white54, fontSize: 13),
            ),
            const SizedBox(height: 16),
            const Text(
              'Bearer token',
              style: TextStyle(color: Colors.white54, fontSize: 13),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _controller,
              decoration: const InputDecoration(hintText: 'eyJhbGciOi...'),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF1DB954),
                  foregroundColor: Colors.black,
                ),
                onPressed: _save,
                child: Text(_saved ? 'Enregistré ✓' : 'Enregistrer'),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: _clear,
                child: const Text('Effacer'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
