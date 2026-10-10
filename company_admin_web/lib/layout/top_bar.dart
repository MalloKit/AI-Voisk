import 'package:flutter/material.dart';

import '../theme/app_spacing.dart';

class TopBar extends StatelessWidget {
  const TopBar({
    super.key,
    required this.title,
    this.onMenu,
    this.sourceLabel = '시연 데이터',
  });
  final String sourceLabel;
  final String title;
  final VoidCallback? onMenu;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final compact =
        MediaQuery.sizeOf(context).width < AppSizes.compactBreakpoint;
    return Container(
      color: theme.colorScheme.surface,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.xl,
            vertical: AppSpacing.md,
          ),
          child: Row(
            children: [
              if (onMenu != null) ...[
                IconButton(
                  tooltip: '메뉴 열기',
                  onPressed: onMenu,
                  icon: const Icon(Icons.menu),
                ),
                const SizedBox(width: AppSpacing.sm),
              ],
              Expanded(child: Text(title, style: theme.textTheme.titleMedium)),
              Chip(
                label: Text(sourceLabel),
                backgroundColor: theme.colorScheme.secondaryContainer,
              ),
              if (!compact) ...[
                const SizedBox(width: AppSpacing.xl),
                const Icon(Icons.account_circle_outlined),
                const SizedBox(width: AppSpacing.sm),
                const Text('회사 관리자 · 시연 모드'),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
