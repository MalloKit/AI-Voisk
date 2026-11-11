import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kiosk_app/core/json_file_store.dart';
import 'package:kiosk_app/core/kiosk_settings.dart';
import 'package:kiosk_app/data/catalog_repository.dart';
import 'package:kiosk_app/data/kiosk_api.dart';
import 'package:kiosk_app/data/order_outbox.dart';
import 'package:kiosk_app/data/sync_service.dart';
import 'package:kiosk_app/domain/recommendation_engine.dart';
import 'package:kiosk_app/domain/catalog.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

const token = 'tok_0123456789abcdefghijklmnopqrstuvwxyzABCD';

Map<String, dynamic> bootstrapJson({int version = 7}) => {
  'store_id': 1,
  'menu_version': version,
  'ai_ready': true,
  'device_id': 70,
  'settings': {
    'policy_profit': 60,
    'pick_weight': 10,
    'fit_threshold': 50,
    'upsell_enabled': true,
    'default_mode': 'normal',
    'speech_rate': 90,
    'voice_enabled': true,
  },
  'menus': [
    {
      'id': '1',
      'name': '제육덮밥',
      'category': '식사',
      'price': 9000,
      'description': '',
      'isSoldOut': false,
      'options': [
        {'id': '11', 'name': '밥 추가', 'price': 1000, 'isSoldOut': false},
      ],
      'tags': ['든든한'],
      'synonyms': ['제육'],
      'costRate': 35,
      'recExcluded': false,
      'storePick': true,
      'imageUrl': '/media/menu/1_0123456789abcdef.jpg',
    },
  ],
};

void main() {
  group('KioskApi', () {
    test('기기 토큰을 헤더로만 보내고 오류를 거절·일시 실패로 나눕니다', () async {
      final requests = <http.Request>[];
      final api = KioskApi(
        baseUrl: 'http://192.168.0.10:8001/',
        deviceId: 70,
        token: token,
        client: MockClient((request) async {
          requests.add(request);
          return switch (request.url.path) {
            '/kiosk/bootstrap' => http.Response(
              jsonEncode(bootstrapJson()),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            ),
            '/kiosk/orders' => http.Response.bytes(
              utf8.encode(jsonEncode({'detail': '주문할 수 없는 메뉴입니다.'})),
              422,
            ),
            '/kiosk/voice/interpret' => http.Response.bytes(
              utf8.encode(
                jsonEncode({
                  'detail': {
                    'code': 'voice_unavailable',
                    'message': '지금은 음성 주문을 쓸 수 없어요.',
                  },
                }),
              ),
              503,
            ),
            _ => http.Response('', 401),
          };
        }),
      );
      expect((await api.bootstrap())['menu_version'], 7);
      expect(requests.single.headers['X-Device-Id'], '70');
      expect(requests.single.headers['Authorization'], 'Bearer $token');
      expect(
        requests.single.url.toString(),
        'http://192.168.0.10:8001/kiosk/bootstrap',
      );
      expect(requests.single.url.toString(), isNot(contains(token)));
      await expectLater(
        api.postRaw('/kiosk/orders', '{}'),
        throwsA(
          isA<KioskApiException>().having(
            (e) => e.isRejection,
            'rejection',
            isTrue,
          ),
        ),
      );
      await expectLater(
        api.interpret({'text': '제육'}),
        throwsA(
          isA<KioskUnavailable>().having(
            (e) => e.code,
            'code',
            'voice_unavailable',
          ),
        ),
      );
      await expectLater(
        api.menuVersion(),
        throwsA(
          isA<KioskApiException>().having((e) => e.status, 'status', 401),
        ),
      );
      expect(api.webSocketUri.toString(), 'ws://192.168.0.10:8001/kiosk/ws');
    });

    test('네트워크 실패는 KioskUnavailable입니다', () async {
      final api = KioskApi(
        baseUrl: 'http://10.0.0.9:8001',
        deviceId: 1,
        token: token,
        client: MockClient((_) async => throw http.ClientException('down')),
      );
      await expectLater(api.bootstrap(), throwsA(isA<KioskUnavailable>()));
    });
  });

  group('CatalogRepository (오프라인 우선)', () {
    test('받은 메뉴를 저장하고, 서버가 끊기면 저장한 메뉴를 씁니다', () async {
      var online = true;
      final api = KioskApi(
        baseUrl: 'http://10.0.0.9:8001',
        deviceId: 70,
        token: token,
        client: MockClient((_) async {
          if (!online) throw http.ClientException('offline');
          return http.Response(
            jsonEncode(bootstrapJson()),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final store = MemoryJsonStore();
      final repository = CatalogRepository(api: api, cache: store);
      final first = await repository.loadCatalog();
      expect(first.fromCache, isFalse);
      expect(first.settings.policyProfit, 60);
      expect(first.menus.single.synonyms, ['제육']);
      online = false;
      final cached = await repository.loadCatalog();
      expect(cached.fromCache, isTrue);
      expect(cached.menus.single.name, '제육덮밥');
      expect(cached.menus.single.options.single.price, 1000);
      final empty = CatalogRepository(api: api, cache: MemoryJsonStore());
      await expectLater(empty.loadCatalog(), throwsA(isA<KioskUnavailable>()));
    });
  });

  group('OrderOutbox', () {
    OutboxEntry order(String id) => OutboxEntry(
      clientOrderId: id,
      path: '/kiosk/orders',
      body: '{"client_order_id":"$id"}',
      createdAt: DateTime(2026, 11, 11),
      summary: '제육덮밥 1',
      total: 9000,
    );

    test('끊기면 기기에 남기고, 복구되면 순서대로 같은 본문을 보냅니다', () async {
      final sent = <String>[];
      var online = false;
      final store = MemoryJsonStore();
      Future<Map<String, dynamic>> send(String path, String body) async {
        if (!online) throw KioskUnavailable('offline');
        sent.add(body);
        return {'order_id': sent.length};
      }

      final outbox = OrderOutbox(send: send, store: store);
      expect((await outbox.submit(order('a'))).status, OutboxStatus.pending);
      expect((await outbox.submit(order('b'))).status, OutboxStatus.pending);
      expect(outbox.pendingCount, 2);
      // 앱을 다시 켜도 대기 주문이 남아 있습니다.
      final restarted = OrderOutbox(send: send, store: store);
      await restarted.load();
      expect(restarted.pendingCount, 2);
      online = true;
      await restarted.flush();
      expect(sent, ['{"client_order_id":"a"}', '{"client_order_id":"b"}']);
      expect(
        restarted.entries.map((e) => (e.clientOrderId, e.status, e.orderId)),
        [('b', OutboxStatus.sent, 2), ('a', OutboxStatus.sent, 1)],
      );
    });

    test('서버가 거절한 주문만 실패로 표시하고 다음 주문은 보냅니다', () async {
      final outbox = OrderOutbox(
        send: (path, body) async {
          if (body.contains('"bad"')) {
            throw KioskApiException(422, '주문할 수 없는 메뉴입니다.');
          }
          return {'order_id': 9};
        },
        store: MemoryJsonStore(),
      );
      final rejected = await outbox.submit(order('bad'));
      expect(
        (rejected.status, rejected.error),
        (OutboxStatus.rejected, '주문할 수 없는 메뉴입니다.'),
      );
      expect((await outbox.submit(order('good'))).status, OutboxStatus.sent);
      // 같은 주문 UUID를 다시 넣어도 한 건만 남습니다.
      await outbox.submit(order('good'));
      expect(
        outbox.entries.where((e) => e.clientOrderId == 'good'),
        hasLength(1),
      );
    });
  });

  group('SyncService', () {
    test('메뉴 버전이 오르면 업데이트를 알리고, 적용하면 새 메뉴를 받습니다', () async {
      var version = 7;
      final api = KioskApi(
        baseUrl: 'http://10.0.0.9:8001',
        deviceId: 70,
        token: token,
        client: MockClient(
          (request) async => switch (request.url.path) {
            '/kiosk/menu-version' => http.Response(
              jsonEncode({'menu_version': version}),
              200,
            ),
            '/kiosk/bootstrap' => http.Response(
              jsonEncode(bootstrapJson(version: version)),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            ),
            _ => http.Response(
              jsonEncode({'menu_version': version, 'synced': true}),
              200,
            ),
          },
        ),
      );
      final catalog = CatalogRepository(api: api, cache: MemoryJsonStore());
      await catalog.loadCatalog();
      final sync = SyncService(
        api: api,
        catalog: catalog,
        outbox: OrderOutbox(send: api.postRaw, store: MemoryJsonStore()),
        appVersion: 'test',
      );
      await sync.checkNow();
      expect((sync.online, sync.updateAvailable), (true, false));
      version = 8;
      await sync.checkNow();
      expect(sync.updateAvailable, isTrue);
      expect(await sync.applyUpdate(), isTrue);
      expect((catalog.current!.menuVersion, sync.updateAvailable), (8, false));
      sync.dispose();
    });
  });

  group('RecommendationEngine', () {
    const engine = RecommendationEngine();
    test('원가율을 매장 안에서 0~100 이익 점수로 정규화합니다', () {
      final scores = engine.profitScores(demoMenus);
      expect(scores['7'], 100); // 원가율 10%(최저)
      expect(scores['1'], 0); // 원가율 35%(최고)
      expect(scores['4'], closeTo(40, 0.01));
    });

    test('정책 가중치 합은 1이고 슬라이더에 따라 이익 비중이 커집니다', () {
      final balanced = PolicyWeights.from(
        const StoreAiSettings(policyProfit: 0, pickWeight: 0),
      );
      final profit = PolicyWeights.from(
        const StoreAiSettings(policyProfit: 100, pickWeight: 100),
      );
      expect(balanced.fit, 1);
      expect(profit.fit + profit.profit + profit.pick, closeTo(1, 1e-9));
      expect(profit.profit, 0.5);
    });

    test('결과가 없으면 매장 우선 메뉴부터 보여 줍니다', () {
      expect(engine.fallback(demoMenus).first.id, '15');
      expect(
        engine.fallback(demoMenus).map((m) => m.id),
        isNot(contains('30')),
      );
    });
  });

  group('KioskSettings', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('기기 토큰은 보안 저장소에만, 나머지는 일반 설정에 저장합니다', () async {
      final secrets = MemorySecretStore();
      final settings = KioskSettings(
        await SharedPreferences.getInstance(),
        secrets,
      );
      await settings.saveConfig(
        const KioskConfig(
          serverUrl: 'http://10.0.0.9:8001',
          storeId: 1,
          deviceId: 70,
          token: token,
        ),
      );
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getKeys().any((key) => prefs.get(key).toString().contains(token)),
        isFalse,
      );
      expect(secrets.values['device_token'], token);
      final loaded = await settings.loadConfig();
      expect(
        (loaded.deviceId, loaded.token, loaded.isKioskMode),
        (70, token, true),
      );
    });

    test('관리자 PIN은 해시로 저장하고 5번 틀리면 5분 잠급니다', () async {
      final settings = KioskSettings(
        await SharedPreferences.getInstance(),
        MemorySecretStore(),
      );
      expect(settings.hasPin, isFalse);
      expect(() => settings.setPin('12'), throwsArgumentError);
      await settings.setPin('482913');
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getKeys().any(
          (key) => prefs.get(key).toString().contains('482913'),
        ),
        isFalse,
      );
      final now = DateTime(2026, 11, 11, 12);
      expect(await settings.checkPin('482913', now: now), isTrue);
      for (var i = 0; i < 5; i++) {
        expect(await settings.checkPin('000000', now: now), isFalse);
      }
      expect(settings.pinLockRemaining(now), isNotNull);
      expect(await settings.checkPin('482913', now: now), isFalse);
      expect(
        await settings.checkPin(
          '482913',
          now: now.add(const Duration(minutes: 6)),
        ),
        isTrue,
      );
    });
  });
}
