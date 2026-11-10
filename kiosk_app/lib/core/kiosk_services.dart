import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import '../data/catalog_repository.dart';
import '../data/image_store.dart';
import '../data/kiosk_api.dart';
import '../data/order_outbox.dart';
import '../data/sync_service.dart';
import '../domain/conversation_controller.dart';
import '../service/data/api_menu_repository.dart';
import '../service/data/order_repository.dart';
import '../voice/voice_port.dart';
import 'json_file_store.dart';
import 'kiosk_settings.dart';

const appVersion = '1.1.0+2';

/// 주문 전송 결과. queued는 기기에 저장했고 연결이 복구되면 자동으로 보냅니다.
sealed class OrderSubmitResult {
  const OrderSubmitResult();
}

class OrderSent extends OrderSubmitResult {
  const OrderSent(this.orderId);
  final int? orderId;
}

class OrderQueued extends OrderSubmitResult {
  const OrderQueued();
}

class OrderRejected extends OrderSubmitResult {
  const OrderRejected(this.message);
  final String message;
}

/// 주문·시연 결제를 Outbox로 보냅니다(기기 토큰 모드).
class OrderGateway {
  OrderGateway(this.outbox);
  final OrderOutbox outbox;

  Future<OrderSubmitResult> submit(
    PendingOrder order, {
    String path = '/kiosk/orders',
    String? body,
  }) async {
    final entry = await outbox.submit(
      OutboxEntry(
        clientOrderId: order.clientOrderId,
        path: path,
        body: body ?? order.body,
        createdAt: DateTime.now(),
        summary: order.summary,
        total: order.total,
      ),
    );
    return switch (entry.status) {
      OutboxStatus.sent => OrderSent(entry.orderId),
      OutboxStatus.pending => const OrderQueued(),
      OutboxStatus.rejected => OrderRejected(entry.error ?? '주문 정보를 확인해 주세요.'),
    };
  }
}

class ApiVoiceInterpreter implements VoiceInterpreter {
  ApiVoiceInterpreter(this.api);
  final KioskApi api;

  @override
  Future<InterpretResult> interpret(Map<String, Object?> payload) async {
    try {
      return InterpretResult.fromJson(await api.interpret(payload));
    } on KioskUnavailable catch (error) {
      throw VoiceServiceUnavailable(error.reason);
    } on KioskApiException catch (error) {
      throw VoiceServiceUnavailable(error.code ?? '${error.status}');
    }
  }

  @override
  Future<void> logRecommendation(Map<String, Object?> payload) =>
      api.recommendationLog(payload);

  @override
  Future<void> staffCall(String reason) => api.staffCall(reason);
}

/// 안드로이드 키오스크 기능(화면 고정·화면 켜짐). MainActivity의 kiosk/system 채널을 씁니다.
class KioskSystem {
  const KioskSystem();
  static const _channel = MethodChannel('kiosk/system');

  Future<bool> startLockTask() async {
    try {
      return await _channel.invokeMethod<bool>('startLockTask') ?? false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }

  Future<void> stopLockTask() async {
    try {
      await _channel.invokeMethod<void>('stopLockTask');
    } on MissingPluginException {
      return;
    } on PlatformException {
      return;
    }
  }
}

/// 앱 전체에서 공유하는 서비스 묶음. main에서 한 번 만들고 화면은 [KioskServices.current]를 읽습니다.
/// 위젯 테스트는 이 값을 만들지 않으며, 그 경우 화면은 기존 로컬 시연 방식으로 동작합니다.
class KioskServices {
  KioskServices({
    required this.config,
    required this.settings,
    required this.catalog,
    this.api,
    this.outbox,
    this.sync,
    this.images,
    this.voice,
    this.interpreter,
    this.system = const KioskSystem(),
  });

  static KioskServices? current;

  final KioskConfig config;
  final KioskSettings? settings;
  final CatalogSource catalog;
  final KioskApi? api;
  final OrderOutbox? outbox;
  final SyncService? sync;
  final ImageStore? images;
  final VoicePort? voice;
  final VoiceInterpreter? interpreter;
  final KioskSystem system;

  OrderGateway? get orders => outbox == null ? null : OrderGateway(outbox!);

  static Future<KioskServices> boot(KioskSettings settings) async {
    final config = await settings.loadConfig();
    if (!config.isKioskMode) {
      return KioskServices(
        config: config,
        settings: settings,
        catalog: PlainCatalogSource(configuredMenuRepository()),
      );
    }
    final folder = await getApplicationSupportDirectory();
    final api = KioskApi(
      baseUrl: config.serverUrl,
      deviceId: config.deviceId,
      token: config.token,
    );
    final catalog = CatalogRepository(
      api: api,
      cache: JsonFileStore(File('${folder.path}/catalog.json')),
    );
    final outbox = OrderOutbox(
      send: api.postRaw,
      store: JsonFileStore(File('${folder.path}/order_outbox.json')),
    );
    await outbox.load();
    final sync = SyncService(
      api: api,
      catalog: catalog,
      outbox: outbox,
      appVersion: appVersion,
    );
    return KioskServices(
      config: config,
      settings: settings,
      catalog: catalog,
      api: api,
      outbox: outbox,
      sync: sync,
      images: ImageStore(
        api: api,
        directory: Directory('${folder.path}/menu_images'),
      ),
      voice: PluginVoicePort(),
      interpreter: ApiVoiceInterpreter(api),
    );
  }

  void dispose() {
    sync?.dispose();
  }
}
