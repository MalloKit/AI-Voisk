import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'catalog_repository.dart';
import 'kiosk_api.dart';
import 'order_outbox.dart';

typedef SocketFactory = WebSocketChannel Function(
  Uri uri,
  Map<String, String> headers,
);

/// 서버 → 태블릿 메뉴 동기화와 태블릿 → 서버 주문·상태 전송을 맡습니다.
///
/// - 점주가 저장하면 WebSocket 알림을 받고, 알림을 놓쳐도 30초마다 메뉴 버전을 확인합니다.
/// - 새 메뉴는 바로 바꾸지 않고 [updateAvailable]만 알립니다. 화면은 주문이 끝난 뒤 [applyUpdate]를 부릅니다.
/// - 연결이 복구되면 대기 중인 주문을 먼저 보내고 메뉴 버전을 확인합니다.
class SyncService extends ChangeNotifier {
  SyncService({
    required this.api,
    required this.catalog,
    required this.outbox,
    required this.appVersion,
    SocketFactory? socketFactory,
    this.pollInterval = const Duration(seconds: 30),
    this.heartbeatInterval = const Duration(seconds: 60),
  }) : _socketFactory = socketFactory ?? _defaultSocket;

  final KioskApi api;
  final CatalogRepository catalog;
  final OrderOutbox outbox;
  final String appVersion;
  final Duration pollInterval;
  final Duration heartbeatInterval;
  final SocketFactory _socketFactory;

  WebSocketChannel? _socket;
  StreamSubscription<Object?>? _subscription;
  Timer? _pollTimer;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;
  int _reconnectDelay = 2;
  bool _running = false;

  int? _latestVersion;
  bool online = false;

  static WebSocketChannel _defaultSocket(
    Uri uri,
    Map<String, String> headers,
  ) => IOWebSocketChannel.connect(
    uri,
    headers: headers,
    pingInterval: const Duration(seconds: 20),
  );

  int get appliedVersion => catalog.current?.menuVersion ?? -1;
  bool get updateAvailable =>
      (_latestVersion ?? -1) > appliedVersion ||
      (catalog.current?.fromCache ?? false) && online;

  void start() {
    if (_running) return;
    _running = true;
    _connect();
    _pollTimer = Timer.periodic(pollInterval, (_) => checkNow());
    _heartbeatTimer = Timer.periodic(heartbeatInterval, (_) => _heartbeat());
    unawaited(checkNow());
  }

  void _connect() {
    if (!_running) return;
    try {
      final socket = _socketFactory(api.webSocketUri, api.authHeaders);
      _socket = socket;
      _subscription = socket.stream.listen(
        _onMessage,
        onDone: _scheduleReconnect,
        onError: (Object _) => _scheduleReconnect(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onMessage(Object? message) {
    _reconnectDelay = 2;
    if (message is! String) return;
    try {
      final data = jsonDecode(message);
      if (data is Map &&
          data['type'] == 'menu_changed' &&
          data['menu_version'] is int) {
        _setLatest(data['menu_version'] as int);
      }
    } on FormatException {
      return;
    }
  }

  void _scheduleReconnect() {
    _subscription?.cancel();
    _subscription = null;
    _socket = null;
    if (!_running) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(seconds: _reconnectDelay), _connect);
    _reconnectDelay = (_reconnectDelay * 2).clamp(2, 60);
  }

  void _setLatest(int version) {
    _latestVersion = version;
    notifyListeners();
  }

  void _setOnline(bool value) {
    if (online == value) return;
    online = value;
    notifyListeners();
  }

  /// 대기 주문 전송 → 메뉴 버전 확인 순서(구상안 재연결 규칙).
  Future<void> checkNow() async {
    await outbox.flush();
    try {
      _setLatest(await api.menuVersion());
      _setOnline(true);
    } on KioskUnavailable {
      _setOnline(false);
    } on KioskApiException {
      _setOnline(false);
    }
  }

  Future<void> _heartbeat() async {
    try {
      await api.heartbeat(appliedVersion < 0 ? 0 : appliedVersion, appVersion);
      _setOnline(true);
    } on KioskUnavailable {
      _setOnline(false);
    } on KioskApiException {
      _setOnline(false);
    }
  }

  /// 새 메뉴를 받아 적용합니다. 주문 중이면 화면이 부르지 않습니다.
  Future<bool> applyUpdate() async {
    try {
      final loaded = await catalog.loadCatalog();
      _latestVersion = loaded.menuVersion;
      notifyListeners();
      unawaited(_heartbeat());
      return !loaded.fromCache;
    } on KioskUnavailable {
      return false;
    }
  }

  @override
  void dispose() {
    _running = false;
    _pollTimer?.cancel();
    _heartbeatTimer?.cancel();
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _socket?.sink.close();
    super.dispose();
  }
}
