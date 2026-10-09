import 'dart:convert';
import 'dart:io';

// ignore: depend_on_referenced_packages
import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/service/data/api_menu_repository.dart';

void main() {
  test('API 메뉴 필드와 빈 목록, 서버 오류 처리', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    var status = 200;
    var body = jsonEncode([
      {'id': '3', 'name': '테스트 메뉴', 'category': '식사', 'price': 8500,
       'description': '설명', 'isSoldOut': true},
    ]);
    final subscription = server.listen((request) async {
      expect(request.uri.path, '/stores/7/menus');
      request.response.statusCode = status;
      request.response.headers.contentType = ContentType.json;
      request.response.write(body);
      await request.response.close();
    });
    addTearDown(subscription.cancel);
    final repository = ApiMenuRepository(baseUrl: 'http://127.0.0.1:${server.port}', storeId: 7);
    final menus = await repository.loadMenus();
    expect(menus.single.id, '3');
    expect(menus.single.name, '테스트 메뉴');
    expect(menus.single.price, 8500);
    expect(menus.single.isSoldOut, isTrue);
    body = '[]';
    expect(await repository.loadMenus(), isEmpty);
    status = 503;
    await expectLater(repository.loadMenus(), throwsA(isA<HttpException>()));
    status = 200;
    body = '{}';
    await expectLater(repository.loadMenus(), throwsFormatException);
  });
}
