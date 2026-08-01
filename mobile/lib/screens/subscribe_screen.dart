import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';

class SubscribeScreen extends StatefulWidget {
  const SubscribeScreen({super.key});

  @override
  State<SubscribeScreen> createState() => _SubscribeScreenState();
}

class _SubscribeScreenState extends State<SubscribeScreen> {
  final _planController = TextEditingController(text: 'premium-monthly');
  Map<String, dynamic>? _status;
  String? _checkoutUrl;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  Future<void> _loadStatus() async {
    try {
      final r = await ApiClient.instance.getSubscription();
      setState(() => _status = r);
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<void> _checkout() async {
    setState(() {
      _busy = true;
      _error = null;
      _checkoutUrl = null;
    });
    try {
      final r = await ApiClient.instance.checkout(_planController.text.trim());
      setState(() => _checkoutUrl = r['checkoutUrl'] as String?);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _planController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final premium = _status?['premium'] == true;

    return Scaffold(
      appBar: AppBar(title: const Text('Abonnement')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (premium)
              Text(
                'Premium actif — ${_status!['planName']}, jusqu\'au '
                '${DateTime.tryParse(_status!['expiresAt'] as String? ?? '')?.toLocal().toString().split(' ').first ?? ''}',
                style: const TextStyle(
                  color: Color(0xFF1DB954),
                  fontWeight: FontWeight.bold,
                ),
              )
            else if (_status != null)
              const Text(
                'Aucun abonnement actif.',
                style: TextStyle(color: Colors.white54),
              ),
            const SizedBox(height: 20),
            const Text(
              'Code du plan',
              style: TextStyle(color: Colors.white54, fontSize: 13),
            ),
            const SizedBox(height: 6),
            TextField(controller: _planController),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF1DB954),
                  foregroundColor: Colors.black,
                ),
                onPressed: _busy ? null : _checkout,
                child: Text(
                  _busy ? 'Patientez…' : "S'abonner — Wave / Orange Money",
                ),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Colors.redAccent),
                ),
              ),
            if (_checkoutUrl != null)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextButton(
                      onPressed: () => launchUrl(
                        Uri.parse(_checkoutUrl!),
                        mode: LaunchMode.externalApplication,
                      ),
                      child: const Text(
                        'Paiement prêt — ouvrir la page PayDunya',
                      ),
                    ),
                    const Text(
                      "L'abonnement s'active automatiquement après confirmation (webhook IPN).",
                      style: TextStyle(fontSize: 12, color: Colors.white54),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
