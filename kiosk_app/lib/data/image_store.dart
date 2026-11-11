import 'dart:io';

import 'package:flutter/foundation.dart';

import '../service/models/menu_item.dart';
import 'kiosk_api.dart';

/// 메뉴 사진을 기기에 저장합니다. 파일 이름에 내용 해시가 있어 이름이 바뀐 사진만 새로 받습니다.
/// 사진을 새로 받을 때마다 알려, 먼저 그려진 메뉴 카드도 아이콘에서 사진으로 바뀌게 합니다.
class ImageStore extends ChangeNotifier {
  ImageStore({
    required this.api,
    required this.directory,
    Future<List<int>> Function(String imageUrl)? fetch,
  }) : _fetch = fetch ?? api.downloadImage;
  final KioskApi api;
  final Directory directory;

  /// 사진 바이트를 받는 함수. 기본은 서버에서 받고, 테스트는 네트워크 없이 바꿔 끼웁니다.
  final Future<List<int>> Function(String imageUrl) _fetch;
  final Map<String, Future<File?>> _pending = {};

  String? _name(String? imageUrl) {
    if (imageUrl == null || !imageUrl.startsWith('/media/menu/')) return null;
    final name = imageUrl.substring('/media/menu/'.length);
    // 서버가 만든 이름 형식만 받습니다(경로 이동 방지).
    return RegExp(r'^\d+_[0-9a-f]{16}\.(jpg|png|webp)$').hasMatch(name)
        ? name
        : null;
  }

  File? cached(String? imageUrl) {
    final name = _name(imageUrl);
    if (name == null) return null;
    final file = File('${directory.path}${Platform.pathSeparator}$name');
    return file.existsSync() ? file : null;
  }

  Future<File?> fileFor(String? imageUrl) {
    final name = _name(imageUrl);
    if (name == null) return Future.value(null);
    final hit = cached(imageUrl);
    if (hit != null) return Future.value(hit);
    // whenComplete에 화살표 함수로 remove 결과(이 Future 자신)를 돌려주면 자기 자신을 기다리며
    // 끝나지 않습니다. 블록으로 감싸 아무것도 돌려주지 않습니다.
    return _pending[name] ??= _download(imageUrl!, name).whenComplete(() {
      _pending.remove(name);
    });
  }

  Future<File?> _download(String imageUrl, String name) async {
    try {
      final bytes = await _fetch(imageUrl);
      await directory.create(recursive: true);
      final target = File('${directory.path}${Platform.pathSeparator}$name');
      final temporary = File('${target.path}.part');
      await temporary.writeAsBytes(bytes, flush: true);
      final saved = await temporary.rename(target.path);
      notifyListeners();
      return saved;
    } on KioskUnavailable {
      return null;
    } on KioskApiException {
      // 404 등으로 받지 못하면 아이콘을 보이고 다음 동기화 때 다시 받습니다.
      return null;
    } on FileSystemException {
      return null;
    }
  }

  /// 새 메뉴의 사진을 미리 받고, 더 이상 쓰지 않는 사진 파일을 지웁니다.
  Future<void> sync(List<MenuItem> menus) async {
    final wanted = menus
        .map((menu) => _name(menu.imageUrl))
        .whereType<String>()
        .toSet();
    for (final menu in menus) {
      await fileFor(menu.imageUrl);
    }
    if (!await directory.exists()) return;
    await for (final entity in directory.list()) {
      final name = entity.uri.pathSegments.last;
      if (entity is File && !wanted.contains(name)) {
        try {
          await entity.delete();
        } on FileSystemException {
          // 사용 중인 파일은 다음 동기화 때 지웁니다.
        }
      }
    }
  }
}
