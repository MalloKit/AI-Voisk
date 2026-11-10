import '../core/json_file_store.dart';
import '../domain/catalog.dart';
import '../service/data/menu_repository.dart';
import '../service/models/menu_item.dart';
import 'kiosk_api.dart';

/// 오프라인 우선 메뉴 저장소(Repository). 화면은 이 저장소만 읽고, 서버 응답은 기기에 저장해 두었다가
/// 서버에 닿지 못하면 마지막으로 받은 메뉴로 주문을 받습니다.
abstract class CatalogSource implements MenuRepository {
  KioskCatalog? get current;
  Future<KioskCatalog> loadCatalog();
}

class CatalogRepository implements CatalogSource {
  CatalogRepository({required this.api, required this.cache});
  final KioskApi api;
  final JsonFileStore cache;

  @override
  KioskCatalog? current;

  @override
  Future<KioskCatalog> loadCatalog() async {
    try {
      final json = await api.bootstrap();
      // 먼저 읽어 보고 성공한 응답만 저장합니다. 깨진 응답이 마지막 정상 메뉴를 덮지 않게 합니다.
      final catalog = KioskCatalog.fromJson(json);
      await cache.write(json);
      return current = catalog;
    } on KioskUnavailable {
      return current = await _cached() ?? (throw KioskUnavailable('offline'));
    } on KioskApiException catch (error) {
      // 토큰 재발급·기기 비활성 등 인증 문제면 마지막 메뉴로 계속 받고, 주문은 대기열에 둡니다.
      if (error.status != 401 && error.status != 403) rethrow;
      return current = await _cached() ?? (throw error);
    }
  }

  Future<KioskCatalog?> _cached() async {
    final saved = await cache.read();
    if (saved is! Map<String, dynamic>) return null;
    try {
      return KioskCatalog.fromJson(saved, fromCache: true);
    } on Object {
      return null;
    }
  }

  @override
  Future<List<MenuItem>> loadMenus() async => (await loadCatalog()).menus;
}

/// 기기 토큰 없이 실행할 때(로컬 시연·Mock)의 저장소. 음성·추천 정보는 없습니다.
class PlainCatalogSource implements CatalogSource {
  PlainCatalogSource(this.repository);
  final MenuRepository repository;

  @override
  KioskCatalog? current;

  @override
  Future<KioskCatalog> loadCatalog() async =>
      current = KioskCatalog(menus: await repository.loadMenus());

  @override
  Future<List<MenuItem>> loadMenus() async => (await loadCatalog()).menus;
}
