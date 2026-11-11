import 'dart:io';

import 'package:flutter/material.dart';

import '../data/image_store.dart';
import '../service/models/menu_item.dart';

IconData categoryIcon(String category) => switch (category) {
  '식사' => Icons.rice_bowl,
  '국물' => Icons.soup_kitchen,
  '사이드' => Icons.restaurant,
  '음료' => Icons.local_drink,
  '면류' => Icons.ramen_dining,
  '구이' => Icons.outdoor_grill,
  '튀김' => Icons.set_meal,
  '분식' => Icons.lunch_dining,
  '샐러드' => Icons.eco,
  '디저트' => Icons.icecream,
  '세트' => Icons.fastfood,
  _ => Icons.restaurant_menu,
};

/// 메뉴 사진. 기기에 저장된 사진을 쓰고, 없거나 받는 중이면 분류 아이콘을 보여 줍니다.
class MenuImage extends StatelessWidget {
  const MenuImage({super.key, required this.menu, this.store, this.size = 92});
  final MenuItem menu;
  final ImageStore? store;
  final double size;

  Widget _icon() => Container(
    width: size,
    height: size,
    decoration: const BoxDecoration(
      color: Color(0xFFFFF0DC),
      shape: BoxShape.circle,
    ),
    child: Icon(
      categoryIcon(menu.category),
      size: size * 0.56,
      color: const Color(0xFFBB743A),
    ),
  );

  Widget _file(File file) => ClipRRect(
    borderRadius: BorderRadius.circular(size * 0.18),
    child: Image.file(
      file,
      width: size * 1.3,
      height: size,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => _icon(),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final images = store;
    if (images == null || menu.imageUrl == null) return _icon();
    final cached = images.cached(menu.imageUrl);
    if (cached != null) return _file(cached);
    return FutureBuilder<File?>(
      future: images.fileFor(menu.imageUrl),
      builder: (context, snapshot) =>
          snapshot.data == null ? _icon() : _file(snapshot.data!),
    );
  }
}
