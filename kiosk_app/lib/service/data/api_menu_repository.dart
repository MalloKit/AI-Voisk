import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../models/menu_item.dart';
import 'menu_repository.dart';

/// DB 비밀번호 없이 API 주소와 매장 번호로 메뉴를 조회합니다.
class ApiMenuRepository implements MenuRepository {
  ApiMenuRepository({required this.baseUrl, required this.storeId});
  final String baseUrl;
  final int storeId;

  @override
  Future<List<MenuItem>> loadMenus() async {
    final uri = Uri.parse(baseUrl);
    if (!['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        storeId < 1) {
      throw const FormatException('API 주소와 매장 번호를 확인해 주세요.');
    }
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 10);
    try {
      return await (() async {
        final request = await client.getUrl(
          uri.replace(
            path:
                '${uri.path.replaceFirst(RegExp(r'/$'), '')}/stores/$storeId/menus',
            query: null,
          ),
        );
        final response = await request.close();
        if (response.statusCode != 200) {
          throw const HttpException('메뉴를 불러오지 못했습니다.');
        }
        final data = jsonDecode(await utf8.decoder.bind(response).join());
        if (data is! List) throw const FormatException('메뉴 응답 형식을 확인해 주세요.');
        return data.map((item) {
          final row = item as Map<String, dynamic>;
          final price = row['price'] as int;
          if (price < 0) throw const FormatException('잘못된 메뉴 가격입니다.');
          return MenuItem(
            id: row['id'] as String,
            name: row['name'] as String,
            category: row['category'] as String,
            price: price,
            description: row['description'] as String,
            isSoldOut: row['isSoldOut'] as bool,
          );
        }).toList();
      })().timeout(const Duration(seconds: 15));
    } finally {
      client.close(force: true);
    }
  }
}

MenuRepository configuredMenuRepository() {
  const address = String.fromEnvironment('MENU_API_BASE_URL');
  const storeId = int.fromEnvironment('STORE_ID', defaultValue: 1);
  return address.isEmpty
      ? const MockMenuRepository()
      : ApiMenuRepository(baseUrl: address, storeId: storeId);
}
