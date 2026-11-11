# voice_engine

AI 보이스크 키오스크의 음성 엔진 Flutter 플러그인입니다(Android 전용, Kotlin).
안드로이드 내장 음성 인식(`SpeechRecognizer`)과 음성 안내(`TextToSpeech`)를 하나의 인터페이스(Facade)로 묶습니다.

## 원칙

- 마이크는 앱이 `startListening`을 부른 동안만 씁니다. 상시 청취·호출어 감지는 없습니다.
- 오디오는 Kotlin 밖(Dart, 파일, 네트워크)으로 내보내지 않습니다. Dart에는 인식된 텍스트와 상태만 보냅니다.
- 안내 음성이 나오는 중에 듣기를 시작하면 안내를 멈춰, 자기 목소리를 인식하지 않게 합니다.

## Dart API (`lib/voice_engine.dart`)

| 메서드 | 설명 |
|---|---|
| `isRecognitionAvailable()` | 기기에 음성 인식 서비스가 있는지 |
| `hasPermission()`, `requestPermission()` | 마이크(RECORD_AUDIO) 권한 확인·요청 |
| `initializeTts()` | 한국어 음성 안내 준비. 한국어 음성이 없으면 false |
| `startListening({locale, completeSilenceMs, preferOffline})` | 한 번 듣기. 말이 끝나고 무음이 이어지면 스스로 끝남 |
| `stopListening()`, `cancelListening()` | 듣기 종료(결과 받음) / 취소 |
| `speak(text, {rate, pitch})` | 안내 재생. 재생 id를 돌려주고 끝나면 같은 id의 `speechDone` 이벤트 |
| `stopSpeaking()` | 안내 중지 |

이벤트(`events` 스트림): `listening`, `speechBegin`, `speechEnd`, `partial(text)`, `finalResult(text, alternatives)`,
`error(code: no_speech|audio|permission|network|busy|language|client)`, `level(rms dB, 초당 10회)`, `speechStart`, `speechDone`.

## 기기 준비

- 태블릿에 음성 인식 서비스(Google 앱 또는 제조사 음성 서비스)와 한국어 TTS 음성이 있어야 합니다.
- 오프라인 인식을 쓰려면 기기 설정에서 한국어 오프라인 음성 인식 팩을 내려받고 `preferOffline: true`로 부릅니다.
- 빅스비 음성 호출을 끄면 마이크 충돌을 줄일 수 있습니다.

## 테스트

```powershell
cd packages\voice_engine
flutter test
```

채널 계약(메서드 이름·인자, 이벤트 변환)을 확인합니다. 실제 마이크·음성 인식은 실기기에서 확인합니다.
