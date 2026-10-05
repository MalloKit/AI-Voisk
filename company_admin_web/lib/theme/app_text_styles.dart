import 'package:flutter/material.dart';

abstract final class AppTextStyles {
  // System fonts avoid an external network dependency.
  static const fontFamily = 'Malgun Gothic';
  static const fontFallback = [
    'Apple SD Gothic Neo',
    'Noto Sans KR',
    'sans-serif',
  ];
  static const textTheme = TextTheme(
    headlineMedium: TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
    titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
    titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
    bodyLarge: TextStyle(fontSize: 15, height: 1.6),
    bodyMedium: TextStyle(fontSize: 14, height: 1.5),
    bodySmall: TextStyle(fontSize: 12, height: 1.5),
    labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
  );
}
