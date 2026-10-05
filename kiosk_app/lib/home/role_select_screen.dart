import 'package:flutter/material.dart';

import '../service/screens/order_screen.dart';

/// 팀 통합·시연용 선택 화면. 관리자·점주 화면은 담당자 구현 후 연결합니다.
class RoleSelectScreen extends StatelessWidget {
  const RoleSelectScreen({super.key});

  void _showPending(BuildContext context, String role) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('$role 기능'),
        content: const Text('준비 중입니다.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('닫기'),
          ),
        ],
      ),
    );
  }

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
              _RoleButton(
                label: '관리자',
                onPressed: () => _showPending(context, '관리자'),
              ),
              _RoleButton(
                label: '점주',
                onPressed: () => _showPending(context, '점주'),
              ),
              _RoleButton(
                label: '고객 서비스',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const OrderScreen()),
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
    height: 80,
    child: FilledButton(
      style: FilledButton.styleFrom(
        backgroundColor: const Color(0xFF246B58),
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
      ),
      onPressed: onPressed,
      child: Text(label),
    ),
  );
}
