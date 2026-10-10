import 'package:flutter/material.dart';

import '../theme/app_spacing.dart';

enum AdminPage {
  dashboard('운영 요약', Icons.dashboard_outlined),
  stores('매장 관리', Icons.storefront_outlined),
  owners('점주 계정', Icons.people_outline),
  orders('주문 조회', Icons.receipt_long_outlined),
  devices('기기 관리', Icons.devices_outlined),
  alerts('장애/알림', Icons.notifications_outlined);

  const AdminPage(this.label, this.icon);
  final String label;
  final IconData icon;
}

class Sidebar extends StatelessWidget {
  const Sidebar({super.key, required this.selected, required this.onSelected});
  final AdminPage selected;
  final ValueChanged<AdminPage> onSelected;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: AppSizes.sidebar,
      decoration: BoxDecoration(
        border: Border(
          right: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: Material(
        color: theme.colorScheme.surface,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.all(AppSpacing.xl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'AI-Voisk',
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: theme.colorScheme.primary,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text('회사 관리자', style: theme.textTheme.bodySmall),
                  ],
                ),
              ),
              const Divider(),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  children: AdminPage.values
                      .map(
                        (page) => Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: ListTile(
                            key: ValueKey('nav-${page.name}'),
                            selected: selected == page,
                            selectedTileColor:
                                theme.colorScheme.primaryContainer,
                            selectedColor: theme.colorScheme.onPrimaryContainer,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(
                                AppSizes.radius,
                              ),
                            ),
                            leading: Icon(page.icon),
                            title: Text(page.label),
                            onTap: () => onSelected(page),
                          ),
                        ),
                      )
                      .toList(),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(AppSpacing.xl),
                child: Text(
                  'AI-Voisk 운영 관리\n화면별 데이터 출처 확인',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
