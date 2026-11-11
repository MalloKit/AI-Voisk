import '../core/json_file_store.dart';

/// 주문 한 건의 사용성 측정값(구상안 15장: 터치 주문과 음성 주문의 탭 수·소요 시간 비교).
/// 메뉴·금액·발화 같은 고객 정보는 담지 않고 숫자만 기기에 남깁니다.
class UsabilityRecord {
  const UsabilityRecord({
    required this.channel,
    required this.taps,
    required this.seconds,
    required this.items,
    required this.senior,
  });

  /// touch 또는 voice(음성으로 하나라도 담았으면 voice).
  final String channel;
  final int taps;
  final int seconds;
  final int items;
  final bool senior;

  factory UsabilityRecord.fromJson(Map<String, dynamic> json) => UsabilityRecord(
    channel: json['channel'] as String? ?? 'touch',
    taps: json['taps'] as int? ?? 0,
    seconds: json['seconds'] as int? ?? 0,
    items: json['items'] as int? ?? 0,
    senior: json['senior'] as bool? ?? false,
  );

  Map<String, dynamic> toJson() => {
    'channel': channel,
    'taps': taps,
    'seconds': seconds,
    'items': items,
    'senior': senior,
  };
}

/// 방식별 평균.
class UsabilitySummary {
  const UsabilitySummary(this.count, this.averageTaps, this.averageSeconds);
  final int count;
  final double averageTaps;
  final double averageSeconds;
}

/// 완료한 주문의 측정값을 최근 [keep]건까지 저장합니다.
class UsabilityLog {
  UsabilityLog(this.store, {this.keep = 500});
  final JsonFileStore store;
  final int keep;

  Future<List<UsabilityRecord>> records() async {
    final saved = await store.read();
    if (saved is! List) return [];
    return saved
        .whereType<Map<String, dynamic>>()
        .map(UsabilityRecord.fromJson)
        .toList();
  }

  Future<void> add(UsabilityRecord record) async {
    final all = [...await records(), record];
    final kept = all.length > keep ? all.sublist(all.length - keep) : all;
    await store.write(kept.map((r) => r.toJson()).toList());
  }

  Future<void> clear() => store.write(const []);

  /// 방식(touch/voice)과 시니어 모드별 평균. 측정값이 없으면 그 칸은 빠집니다.
  Future<Map<String, UsabilitySummary>> summary() async {
    final groups = <String, List<UsabilityRecord>>{};
    for (final record in await records()) {
      final key = '${record.channel}${record.senior ? '/senior' : ''}';
      groups.putIfAbsent(key, () => []).add(record);
    }
    return {
      for (final entry in groups.entries)
        entry.key: UsabilitySummary(
          entry.value.length,
          entry.value.fold<int>(0, (sum, r) => sum + r.taps) / entry.value.length,
          entry.value.fold<int>(0, (sum, r) => sum + r.seconds) / entry.value.length,
        ),
    };
  }
}
