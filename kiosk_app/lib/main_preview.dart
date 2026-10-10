import 'package:flutter/material.dart';

import 'home/role_select_screen.dart';

/// 공통 main.dart를 바꾸지 않고 역할 선택 화면을 확인하는 실행 파일입니다.
void main() => runApp(const PreviewApp());

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
