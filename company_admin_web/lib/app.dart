import 'package:flutter/material.dart';

import 'layout/admin_shell.dart';
import 'theme/app_theme.dart';
import 'data/repositories/admin_repository.dart';
import 'data/repositories/mock_admin_repository.dart';
import 'data/sources/mock_admin_data_source.dart';

class CompanyAdminApp extends StatelessWidget {
  const CompanyAdminApp({super.key, this.repository});
  final AdminRepository? repository;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'AI-Voisk | 회사 관리자',
    debugShowCheckedModeBanner: false,
    theme: AppTheme.light,
    // Composition root: replace only this injection with an API repository later.
    home: AdminShell(
      repository: repository ?? MockAdminRepository(MockAdminDataSource()),
    ),
  );
}
