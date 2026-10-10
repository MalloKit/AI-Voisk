import 'package:flutter/material.dart';

import '../service/screens/order_screen.dart';

/// 고객이 포장 또는 매장 식사를 선택하는 시작 화면.
class RoleSelectScreen extends StatelessWidget {
  const RoleSelectScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F7F5),
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          physics: const ClampingScrollPhysics(),
          child: Wrap(
            alignment: WrapAlignment.center,
            spacing: 20,
            runSpacing: 20,
            children: [
              for (final mode in ['포장', '매장 식사'])
                _RoleButton(
                  label: mode,
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => OrderScreen(orderMode: mode),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _RoleButton extends StatelessWidget {
  const _RoleButton({required this.label, required this.onPressed});
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 180,
    height: 170,
    child: FilledButton(
      style: FilledButton.styleFrom(
        backgroundColor: const Color(0xFF246B58),
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
      ),
      onPressed: onPressed,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            label == '포장' ? Icons.shopping_bag_outlined : Icons.restaurant,
            size: 56,
          ),
          const SizedBox(height: 16),
          Text(label),
        ],
      ),
    ),
  );
}
