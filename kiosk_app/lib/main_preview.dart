import 'package:flutter/material.dart';

import 'core/app_boot.dart';
import 'home/role_select_screen.dart';

/// 기존 실행 명령(main_preview.dart) 호환용. main.dart와 같은 시작 화면을 띄웁니다.
Future<void> main() async {
  await bootKiosk();
  runApp(const PreviewApp());
}

class PreviewApp extends StatelessWidget {
  const PreviewApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'AI 보이스크 · 통합 화면 미리보기',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
      useMaterial3: true,
    ),
    home: const RoleSelectScreen(),
  );
}
