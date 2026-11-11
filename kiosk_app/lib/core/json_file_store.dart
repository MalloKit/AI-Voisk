import 'dart:convert';
import 'dart:io';

/// 앱 전용 폴더의 JSON 파일 하나. 임시 파일에 쓴 뒤 이름을 바꿔 쓰기 도중 종료돼도 이전 내용이 남습니다.
class JsonFileStore {
  JsonFileStore(this.file);
  final File file;

  Future<Object?> read() async {
    try {
      if (!await file.exists()) return null;
      return jsonDecode(await file.readAsString());
    } on FormatException {
      return null;
    } on FileSystemException {
      return null;
    }
  }

  Future<void> write(Object? value) async {
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(value), flush: true);
    await temporary.rename(file.path);
  }
}

/// 테스트·미리보기용 메모리 저장소.
class MemoryJsonStore implements JsonFileStore {
  MemoryJsonStore([this.value]);
  Object? value;

  @override
  File get file => throw UnsupportedError('memory');

  @override
  Future<Object?> read() async =>
      value == null ? null : jsonDecode(jsonEncode(value));

  @override
  Future<void> write(Object? value) async =>
      this.value = jsonDecode(jsonEncode(value));
}
