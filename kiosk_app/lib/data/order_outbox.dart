import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/json_file_store.dart';
import 'kiosk_api.dart';

enum OutboxStatus { pending, sent, rejected }

/// 대기열의 주문 한 건. body는 처음 인코딩한 그대로 재전송해 서버가 같은 주문 UUID로 한 번만 저장합니다.
class OutboxEntry {
  OutboxEntry({
    required this.clientOrderId,
    required this.path,
    required this.body,
    required this.createdAt,
    required this.summary,
    required this.total,
    this.status = OutboxStatus.pending,
    this.orderId,
    this.error,
    this.attempts = 0,
  });

  final String clientOrderId;
  final String path;
  final String body;
  final DateTime createdAt;

  /// 주문내역 화면용 요약(메뉴 이름·수량). 서버에는 보내지 않습니다.
  final String summary;
  final int total;
  OutboxStatus status;
  int? orderId;
  String? error;
  int attempts;

  factory OutboxEntry.fromJson(Map<String, dynamic> json) => OutboxEntry(
    clientOrderId: json['client_order_id'] as String,
    path: json['path'] as String,
    body: json['body'] as String,
    createdAt: DateTime.parse(json['created_at'] as String),
    summary: json['summary'] as String? ?? '',
    total: json['total'] as int? ?? 0,
    status: OutboxStatus.values.byName(json['status'] as String? ?? 'pending'),
    orderId: json['order_id'] as int?,
    error: json['error'] as String?,
    attempts: json['attempts'] as int? ?? 0,
  );

  Map<String, dynamic> toJson() => {
    'client_order_id': clientOrderId,
    'path': path,
    'body': body,
    'created_at': createdAt.toIso8601String(),
    'summary': summary,
    'total': total,
    'status': status.name,
    'order_id': orderId,
    'error': error,
    'attempts': attempts,
  };
}

typedef OrderSender = Future<Map<String, dynamic>> Function(
  String path,
  String body,
);

/// 주문 전송 대기열(Outbox). 주문을 먼저 기기에 저장하고 순서대로 서버에 보냅니다.
/// 네트워크 실패·서버 5xx는 남겨 두었다가 다시 보내고, 서버가 거절한 주문만 실패로 표시합니다.
class OrderOutbox extends ChangeNotifier {
  OrderOutbox({required this.send, required this.store, this.keepHistory = 30});

  final OrderSender send;
  final JsonFileStore store;
  final int keepHistory;
  final List<OutboxEntry> _entries = [];
  Future<void>? _flushing;
  bool _loaded = false;

  List<OutboxEntry> get entries => List.unmodifiable(_entries.reversed);
  int get pendingCount =>
      _entries.where((e) => e.status == OutboxStatus.pending).length;

  Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    final saved = await store.read();
    if (saved is List) {
      _entries
        ..clear()
        ..addAll(
          saved.whereType<Map<String, dynamic>>().map(OutboxEntry.fromJson),
        );
      notifyListeners();
    }
  }

  Future<void> _save() async {
    // 보낸 주문은 최근 기록만 남기고, 아직 보내지 못한 주문은 절대 지우지 않습니다.
    final done = _entries
        .where((e) => e.status != OutboxStatus.pending)
        .toList();
    if (done.length > keepHistory) {
      final drop = done.take(done.length - keepHistory).toSet();
      _entries.removeWhere(drop.contains);
    }
    await store.write(_entries.map((e) => e.toJson()).toList());
  }

  /// 대기열에 넣고 바로 한 번 보냅니다. 결과가 정해질 때까지(전송·거절·보류) 기다립니다.
  Future<OutboxEntry> submit(OutboxEntry entry) async {
    await load();
    final existing = _entries.where(
      (e) => e.clientOrderId == entry.clientOrderId,
    );
    if (existing.isEmpty) {
      _entries.add(entry);
      await _save();
      notifyListeners();
    }
    await flush();
    return _entries.firstWhere((e) => e.clientOrderId == entry.clientOrderId);
  }

  /// 앞의 주문이 보류되면 뒤 주문도 보내지 않아 주문 순서를 지킵니다.
  Future<void> flush() {
    final running = _flushing;
    if (running != null) return running;
    final work = _flushAll();
    _flushing = work;
    return work.whenComplete(() => _flushing = null);
  }

  Future<void> _flushAll() async {
    await load();
    for (final entry in List.of(_entries)) {
      if (entry.status != OutboxStatus.pending) continue;
      entry.attempts++;
      try {
        final result = await send(entry.path, entry.body);
        entry
          ..status = OutboxStatus.sent
          ..orderId = result['order_id'] as int?
          ..error = null;
      } on KioskApiException catch (error) {
        entry
          ..status = OutboxStatus.rejected
          ..error = error.message;
      } on KioskUnavailable catch (error) {
        entry.error = error.reason;
        await _save();
        notifyListeners();
        return;
      }
      await _save();
      notifyListeners();
    }
  }
}
