/// 음성 안내 문장용 한국어 조사 처리.
bool hasFinalConsonant(String word) {
  final trimmed = word.trimRight();
  if (trimmed.isEmpty) return false;
  final code = trimmed.codeUnitAt(trimmed.length - 1);
  if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 != 0;
  // 숫자·영문으로 끝나면 읽는 소리 기준으로 대략 판단합니다(0,1,3,6,7,8 → 받침 있음).
  return '013678lmnLMN'.contains(trimmed[trimmed.length - 1]);
}

/// josa('콜라', '을', '를') → '콜라를'
String josa(String word, String withConsonant, String withoutConsonant) =>
    '$word${hasFinalConsonant(word) ? withConsonant : withoutConsonant}';

String eunNeun(String word) => josa(word, '은', '는');
String eulReul(String word) => josa(word, '을', '를');
String iGa(String word) => josa(word, '이', '가');

/// '으로/로': ㄹ 받침은 '로'를 씁니다.
String euro(String word) {
  final trimmed = word.trimRight();
  if (trimmed.isEmpty) return word;
  final code = trimmed.codeUnitAt(trimmed.length - 1);
  if (code >= 0xAC00 && code <= 0xD7A3) {
    final last = (code - 0xAC00) % 28;
    return '$word${last == 0 || last == 8 ? '로' : '으로'}';
  }
  return '$word${hasFinalConsonant(word) ? '으로' : '로'}';
}

/// 'A, B, C' 목록. 두 개면 'A와 B'처럼 읽기 좋게 잇습니다.
String joinNames(List<String> names) {
  if (names.isEmpty) return '';
  if (names.length == 1) return names.first;
  if (names.length == 2) return '${josa(names[0], '과', '와')} ${names[1]}';
  return '${names.sublist(0, names.length - 1).join(', ')}, ${names.last}';
}
