import 'package:flutter/material.dart';

import '../core/config/api_config.dart';
import 'backend_switcher.dart';

class BackendPicker extends StatelessWidget {
  const BackendPicker({super.key, this.dark = false});

  final bool dark;

  @override
  Widget build(BuildContext context) {
    final label = 'Backend: ${BackendSwitcher.baseUrl}  (tap to change)';
    final color = dark
        ? Colors.white.withValues(alpha: 0.6)
        : Theme.of(context).colorScheme.outline;

    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Center(
        child: InkWell(
          onTap: () => _pick(context),
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: color.withValues(alpha: 0.3)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.dns_outlined, size: 13, color: color),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11, color: color),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _pick(BuildContext context) async {
    final current = BackendSwitcher.currentId;
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'Select backend',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
              ),
              ...BackendSwitcher.options.map(
                (o) => ListTile(
                  title: Text(o['label']!),
                  subtitle: Text(o['url']!, style: const TextStyle(fontSize: 12)),
                  trailing: current == o['id']
                      ? const Icon(Icons.check_circle, size: 20)
                      : null,
                  onTap: () => Navigator.pop(ctx, o['id']),
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.link, size: 20),
                title: const Text('Custom URL...'),
                onTap: () => Navigator.pop(ctx, '__custom__'),
              ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );

    if (picked == null || !context.mounted) return;

    String target;
    if (picked == '__custom__') {
      final ctrl = TextEditingController(text: BackendSwitcher.baseUrl);
      final custom = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Backend URL'),
          content: TextField(
            controller: ctrl,
            autofocus: true,
            decoration: const InputDecoration(
              hintText: 'http://192.168.1.152:5000',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
              child: const Text('Save'),
            ),
          ],
        ),
      );
      if (custom == null || custom.isEmpty) return;
      target = custom;
    } else {
      target = picked;
    }

    await BackendSwitcher.set(target);
    Config.applySelectedBackend();
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Backend set to ${BackendSwitcher.baseUrl}'),
        duration: const Duration(seconds: 2),
      ),
    );
  }
}
