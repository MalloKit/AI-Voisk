import 'package:flutter/foundation.dart';

import 'l10n_table.dart';

/// 키오스크 화면 언어. 음성 주문(STT·TTS·안내 문장)은 한국어만 지원합니다.
enum AppLanguage {
  ko('한국어'),
  ja('日本語'),
  en('English'),
  zh('中文');

  const AppLanguage(this.label);
  final String label;
}

/// 화면 언어 상태. 번역 키는 한국어 원문이며 {이름} 자리표시자를 씁니다.
/// 메뉴·카테고리 이름처럼 매장이 입력한 값은 번역하지 않고 원문을 보여 줍니다.
class L10n extends ChangeNotifier {
  L10n._();
  static final L10n instance = L10n._();

  AppLanguage _language = AppLanguage.ko;
  AppLanguage get language => _language;

  set language(AppLanguage value) {
    if (_language == value) return;
    _language = value;
    notifyListeners();
  }

  /// 다음 고객을 위해 한국어로 되돌립니다(주문 완료·시작 화면 복귀 시).
  void reset() => language = AppLanguage.ko;

  String t(String korean, [Map<String, Object?> args = const {}]) {
    var text = korean;
    if (_language != AppLanguage.ko) {
      text = translations[korean]?[_language.name] ?? korean;
    }
    for (final entry in args.entries) {
      text = text.replaceAll('{${entry.key}}', '${entry.value}');
    }
    return text;
  }
}

String tr(String korean, [Map<String, Object?> args = const {}]) =>
    L10n.instance.t(korean, args);
