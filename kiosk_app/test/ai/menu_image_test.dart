import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/data/image_store.dart';
import 'package:kiosk_app/data/kiosk_api.dart';
import 'package:kiosk_app/service/models/menu_item.dart';
import 'package:kiosk_app/widgets/menu_image.dart';

const menu = MenuItem(
  id: '1',
  name: '비빔밥',
  category: '식사',
  price: 8000,
  description: '',
  imageUrl: '/media/menu/1_0123456789abcdef.jpg',
);

final api = KioskApi(
  baseUrl: 'http://10.0.0.9:8001',
  deviceId: 70,
  token: 'tok_0123456789abcdefghijklmnopqrstuvwxyzABCD',
);

Directory tempFolder() {
  final folder = Directory.systemTemp.createTempSync('menu_images_');
  addTearDown(() => folder.deleteSync(recursive: true));
  return folder;
}

void main() {
  test('첫 다운로드가 실패해도 동기화가 다시 받으면 저장하고 알립니다', () async {
    var calls = 0;
    final store = ImageStore(
      api: api,
      directory: tempFolder(),
      fetch: (_) async {
        calls++;
        if (calls == 1) throw KioskApiException(503, '잠시 후 다시 시도');
        return [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
      },
    );
    var notified = 0;
    store.addListener(() => notified++);
    expect(await store.fileFor(menu.imageUrl), isNull);
    expect(notified, 0);
    await store.sync([menu]);
    expect(store.cached(menu.imageUrl), isNotNull);
    expect(notified, 1);
  }, timeout: const Timeout(Duration(seconds: 10)));

  testWidgets('먼저 아이콘으로 그려진 카드도 사진이 받아지면 사진으로 바뀝니다', (tester) async {
    final folder = tempFolder();
    // 위젯이 시작한 다운로드는 끝나지 않게 둡니다(가짜 시간 영역에서 실제 입출력을 기다리지 않도록).
    final never = Completer<List<int>>();
    final store = ImageStore(api: api, directory: folder, fetch: (_) => never.future);
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: MenuImage(menu: menu, store: store))),
    );
    expect(find.byType(Image), findsNothing);
    expect(find.byIcon(categoryIcon('식사')), findsOneWidget);
    // 다른 경로(동기화 재시도)가 사진을 저장하고 알리면 카드가 다시 그려집니다.
    File(
      '${folder.path}${Platform.pathSeparator}1_0123456789abcdef.jpg',
    ).writeAsBytesSync([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    // ignore: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member
    store.notifyListeners();
    await tester.pump();
    expect(find.byType(Image), findsOneWidget);
  });
}
