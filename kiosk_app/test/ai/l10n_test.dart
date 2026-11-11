import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kiosk_app/core/l10n.dart';
import 'package:kiosk_app/core/l10n_table.dart';

Set<String> placeholders(String text) =>
    RegExp(r'\{(\w+)\}').allMatches(text).map((m) => m.group(1)!).toSet();

void main() {
  test('화면 코드의 모든 tr() 문구가 번역표에 있습니다', () {
    final pattern = RegExp(r"tr\(\s*'((?:[^'\\]|\\.)*)'");
    final missing = <String>{};
    for (final file in Directory(
      'lib',
    ).listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      for (final match in pattern.allMatches(file.readAsStringSync())) {
        // 소스의 \n 이스케이프를 실제 줄바꿈으로 맞춥니다.
        final key = match.group(1)!.replaceAll(r'\n', '\n');
        if (!translations.containsKey(key)) missing.add(key);
      }
    }
    // 주문 방식 코드처럼 변수로 넘기는 문구도 표에 있어야 합니다.
    for (final key in [
      '포장',
      '매장 식사',
      '미선택',
      '주문 방식 미선택',
      '선택되지 않음',
      '카드 결제',
      '카카오페이',
      '네이버페이',
      '현금 결제',
    ]) {
      if (!translations.containsKey(key)) missing.add(key);
    }
    expect(missing, isEmpty);
  });

  test('모든 문구가 ja·en·zh를 갖고 자리표시자가 같습니다', () {
    for (final entry in translations.entries) {
      expect(entry.value.keys.toSet(), {'ja', 'en', 'zh'}, reason: entry.key);
      for (final text in entry.value.values) {
        expect(text.trim(), isNotEmpty, reason: entry.key);
        expect(
          placeholders(text),
          placeholders(entry.key),
          reason: '${entry.key} → $text',
        );
      }
    }
  });

  test('언어를 바꾸면 번역되고 reset하면 한국어로 돌아옵니다', () {
    addTearDown(L10n.instance.reset);
    expect(tr('장바구니 · {count}개', {'count': 2}), '장바구니 · 2개');
    L10n.instance.language = AppLanguage.en;
    expect(tr('장바구니 · {count}개', {'count': 2}), 'Cart · 2');
    L10n.instance.language = AppLanguage.ja;
    expect(tr('포장'), 'お持ち帰り');
    L10n.instance.reset();
    expect(tr('포장'), '포장');
  });
}
