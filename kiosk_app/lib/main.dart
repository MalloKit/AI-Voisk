import 'package:flutter/material.dart';

import 'core/app_boot.dart';
import 'home/role_select_screen.dart';

Future<void> main() async {
  await bootKiosk();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'AI 보이스크',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
      useMaterial3: true,
    ),
    home: const RoleSelectScreen(),
  );
}
