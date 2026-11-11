import '../service/models/menu_item.dart';

/// 점주 웹에서 정한 추천 정책·음성 설정. 서버 store_ai_setting과 같은 의미입니다.
class StoreAiSettings {
  const StoreAiSettings({
    this.policyProfit = 30,
    this.pickWeight = 10,
    this.fitThreshold = 50,
    this.upsellEnabled = true,
    this.defaultMode = 'normal',
    this.speechRate = 100,
    this.voiceEnabled = true,
  });

  /// 0 = 고객 적합 우선, 100 = 매장 이익 우선
  final int policyProfit;
  final int pickWeight;
  final int fitThreshold;
  final bool upsellEnabled;
  final String defaultMode;

  /// 안내 음성 속도 % (50~150)
  final int speechRate;
  final bool voiceEnabled;

  factory StoreAiSettings.fromJson(Map<String, dynamic> json) =>
      StoreAiSettings(
        policyProfit: json['policy_profit'] as int? ?? 30,
        pickWeight: json['pick_weight'] as int? ?? 10,
        fitThreshold: json['fit_threshold'] as int? ?? 50,
        upsellEnabled: json['upsell_enabled'] as bool? ?? true,
        defaultMode: json['default_mode'] as String? ?? 'normal',
        speechRate: json['speech_rate'] as int? ?? 100,
        voiceEnabled: json['voice_enabled'] as bool? ?? true,
      );

  Map<String, dynamic> toJson() => {
    'policy_profit': policyProfit,
    'pick_weight': pickWeight,
    'fit_threshold': fitThreshold,
    'upsell_enabled': upsellEnabled,
    'default_mode': defaultMode,
    'speech_rate': speechRate,
    'voice_enabled': voiceEnabled,
  };
}

/// 매장 메뉴·설정 묶음. 서버 부트스트랩 응답 또는 기기에 저장한 마지막 응답입니다.
class KioskCatalog {
  const KioskCatalog({
    required this.menus,
    this.menuVersion = 0,
    this.aiReady = false,
    this.settings = const StoreAiSettings(),
    this.fromCache = false,
    this.popularMenuIds = const [],
  });

  final List<MenuItem> menus;
  final int menuVersion;
  final bool aiReady;
  final StoreAiSettings settings;

  /// 서버에 닿지 못해 마지막으로 저장한 메뉴를 쓰는 중이면 true.
  final bool fromCache;

  /// 최근 30일 많이 팔린 메뉴 id(서버 계산). 추천 후보가 없을 때 먼저 보여 줍니다.
  final List<String> popularMenuIds;

  factory KioskCatalog.fromJson(
    Map<String, dynamic> json, {
    bool fromCache = false,
  }) => KioskCatalog(
    menus: ((json['menus'] ?? const []) as List)
        .map((item) => MenuItem.fromJson(item as Map<String, dynamic>))
        .toList(),
    menuVersion: json['menu_version'] as int? ?? 0,
    aiReady: json['ai_ready'] as bool? ?? false,
    settings: StoreAiSettings.fromJson(
      (json['settings'] ?? const <String, dynamic>{}) as Map<String, dynamic>,
    ),
    fromCache: fromCache,
    popularMenuIds: ((json['popular_menu_ids'] ?? const []) as List)
        .map((id) => '$id')
        .toList(),
  );

  Map<String, dynamic> toJson() => {
    'menus': menus.map((menu) => menu.toJson()).toList(),
    'menu_version': menuVersion,
    'ai_ready': aiReady,
    'settings': settings.toJson(),
    'popular_menu_ids': popularMenuIds,
  };

  MenuItem? menuById(String id) {
    for (final menu in menus) {
      if (menu.id == id) return menu;
    }
    return null;
  }
}
