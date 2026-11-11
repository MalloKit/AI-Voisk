import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../service/models/menu_item.dart';
import '../service/models/menu_option.dart';
import '../voice/voice_port.dart';
import 'catalog.dart';
import 'korean_text.dart';
import 'order_commands.dart';
import 'recommendation_engine.dart';

/// 대화 상태(State 패턴). 구상안 13장 대화 상태 정의에서 호출어 대기를 버튼 대기로 바꾼 것입니다.
enum ConversationState {
  idle, // 대기: 마이크 꺼짐
  preparing, // 권한·음성 엔진 준비
  listening, // 청취
  thinking, // 이해(서버 해석 중)
  recommending, // 추천 카드 표시, 선택 대기
  confirming, // 담기 전 확인
  choosingOption, // 재질문: 필수 옵션(맵기·사이즈) 묻기
  upsell, // 추가 제안(주문당 1회)
  checkout, // 결제 안내
  error, // 반복 실패: 터치 주문·직원 호출 안내
}

/// 서버 해석 결과(/kiosk/voice/interpret). 모든 ID는 서버가 매장 메뉴와 대조한 값입니다.
class InterpretResult {
  const InterpretResult({
    required this.intent,
    this.items = const [],
    this.situation = const [],
    this.recommendations = const [],
    this.selectIndex,
    this.question,
  });

  final String intent;
  final List<InterpretedItem> items;
  final List<String> situation;
  final List<RecommendationCandidate> recommendations;
  final int? selectIndex;
  final String? question;

  factory InterpretResult.fromJson(Map<String, dynamic> json) =>
      InterpretResult(
        intent: json['intent'] as String? ?? 'unknown',
        items: ((json['items'] ?? const []) as List)
            .map(
              (item) => InterpretedItem.fromJson(item as Map<String, dynamic>),
            )
            .toList(),
        situation: ((json['situation'] ?? const []) as List)
            .whereType<String>()
            .toList(),
        recommendations: ((json['recommendations'] ?? const []) as List).map((
          value,
        ) {
          final row = value as Map<String, dynamic>;
          return RecommendationCandidate(
            menuId: '${row['menu_id']}',
            fit: row['fit'] as int,
            reason: row['reason'] as String? ?? '',
          );
        }).toList(),
        selectIndex: json['select_index'] as int?,
        question: json['question'] as String?,
      );
}

class InterpretedItem {
  const InterpretedItem({
    required this.menuId,
    required this.quantity,
    this.optionIds = const [],
    this.entryId,
  });
  final String menuId;
  final int quantity;
  final List<String> optionIds;
  final String? entryId;

  factory InterpretedItem.fromJson(Map<String, dynamic> json) =>
      InterpretedItem(
        menuId: '${json['menu_id']}',
        quantity: json['quantity'] as int,
        optionIds: ((json['option_ids'] ?? const []) as List)
            .map((id) => '$id')
            .toList(),
        entryId: json['entry_id'] as String?,
      );
}

/// 음성 해석 서버 경계. 서버에 닿지 못하거나 LLM이 실패하면 [VoiceServiceUnavailable]을 던집니다.
abstract class VoiceInterpreter {
  Future<InterpretResult> interpret(Map<String, Object?> payload);
  Future<void> logRecommendation(Map<String, Object?> payload);
  Future<void> staffCall(String reason);
}

class VoiceServiceUnavailable implements Exception {
  const VoiceServiceUnavailable([this.reason = '']);
  final String reason;
}

class ConversationController extends ChangeNotifier {
  ConversationController({
    required this.voice,
    required this.interpreter,
    required this.bus,
    required this.catalog,
    this.viewingMenu,
    this.onHighlight,
    this.onCheckout,
    this.silenceLimit = const Duration(seconds: 8),
    this.maxFailures = 3,
    this.errorTimeout = const Duration(seconds: 20),
    this.listenAfterPrompt = false,
    DateTime Function()? clock,
    String Function()? newId,
  }) : _clock = clock ?? DateTime.now,
       _newId = newId ?? _uuid;

  final VoicePort voice;
  final VoiceInterpreter interpreter;
  final OrderCommandBus bus;
  final KioskCatalog Function() catalog;
  final MenuItem? Function()? viewingMenu;
  /// 메뉴 강조. focus가 true면 고객이 고른 메뉴라 "이거"가 가리키는 메뉴로도 씁니다.
  final void Function(Set<String> menuIds, {bool focus})? onHighlight;
  final Future<void> Function()? onCheckout;
  final Duration silenceLimit;
  final int maxFailures;

  /// 반복 실패 안내 뒤 아무 입력이 없으면 음성 주문을 닫는 시간(다음 고객에게 남지 않게).
  final Duration errorTimeout;

  /// true면 안내가 끝날 때마다 자동으로 다시 듣습니다(이전 동작, 대화 흐름 테스트용).
  /// 기본은 false: 처음 "말로 주문하기"를 누른 직후에만 바로 듣고, 그 뒤에는 마이크 버튼([talk])을 눌러야 듣습니다.
  final bool listenAfterPrompt;
  final DateTime Function() _clock;
  final String Function() _newId;
  final _engine = const RecommendationEngine();

  ConversationState state = ConversationState.idle;
  bool senior = false;

  /// 화면 표시용: 지금 듣고 있는 문장(부분 인식), 마지막으로 들은 문장, 안내 문장.
  String partial = '';
  String heard = '';
  String message = '';
  double level = 0;
  List<RankedRecommendation> recommendations = const [];
  List<AddItemCommand> pendingItems = const [];
  MenuItem? upsellMenu;
  bool offerStaffCall = false;

  /// 필수 옵션을 묻는 중이면 그 메뉴와 그룹. 화면에 선택 버튼으로도 보여 줍니다.
  MenuItem? askingMenu;
  String? askingGroup;
  List<MenuOption> get optionChoices => [
    for (final option in askingMenu?.optionGroups[askingGroup] ?? const <MenuOption>[])
      if (!option.isSoldOut) option,
  ];
  int _askIndex = 0;
  Timer? _errorTimer;

  int _session = 0;
  int _promptSeq = 0;
  bool _micOpen = false;
  // 추가 제안에 이미 "네"라고 한 메뉴의 옵션을 묻는 중이면, 옵션을 고르는 즉시 담습니다.
  bool _alreadyConfirmed = false;

  /// 지금 마이크로 듣고 있는지(화면의 마이크 표시용).
  bool get micOpen => _micOpen;
  int _failures = 0;
  bool _upsellDone = false;
  bool _pendingClear = false;
  String? _recLogId;
  DateTime _lastActivity = DateTime.fromMillisecondsSinceEpoch(0);
  StreamSubscription<VoiceEvent>? _events;
  Completer<VoiceEvent>? _waiting;

  bool get active => state != ConversationState.idle;
  StoreAiSettings get _settings => catalog().settings;
  double get _rate =>
      _settings.speechRate.clamp(50, 150) / 100 * (senior ? 0.8 : 1.0);
  int get _silenceMs => senior ? 2500 : 1500;

  void _set(ConversationState next, {String? say}) {
    state = next;
    if (say != null) message = say;
    notifyListeners();
  }

  // ---------- 시작·종료 ----------

  /// "말로 주문하기" 버튼. 이미 대화 중이면 마이크 버튼([talk])과 같습니다.
  Future<void> start({bool? seniorMode}) async {
    if (active) {
      await talk();
      return;
    }
    senior = seniorMode ?? (_settings.defaultMode == 'senior');
    final session = ++_session;
    _failures = 0;
    _pendingClear = false;
    offerStaffCall = false;
    recommendations = const [];
    pendingItems = const [];
    heard = '';
    partial = '';
    if (!_settings.voiceEnabled || !catalog().aiReady) {
      _set(ConversationState.idle, say: '지금은 음성 주문을 쓸 수 없어요. 화면을 눌러 주문해 주세요.');
      return;
    }
    _set(ConversationState.preparing, say: '음성 주문을 준비하고 있어요.');
    final problem = await voice.prepare();
    if (session != _session) return;
    if (problem != null) {
      _set(
        ConversationState.idle,
        say: problem == 'permission'
            ? '마이크 권한이 필요해요. 관리자에게 권한 허용을 요청해 주세요.'
            : '이 기기에서는 음성 인식을 쓸 수 없어요. 화면을 눌러 주문해 주세요.',
      );
      return;
    }
    _events ??= voice.events.listen(_onEvent);
    _lastActivity = _clock();
    // 대화 루프는 따로 돌고, 버튼은 준비가 끝나면 바로 돌아옵니다.
    // 버튼을 누른 직후이므로 첫 안내 뒤에는 바로 듣습니다.
    unawaited(
      _prompt(
        session,
        senior ? '네, 천천히 말씀해 주세요. 메뉴 이름이나 원하시는 상황을 말씀하시면 돼요.' : '네, 말씀하세요.',
        listen: true,
      ),
    );
  }

  Future<void> stop({String? say}) async {
    _session++;
    _micOpen = false;
    _alreadyConfirmed = false;
    _waiting?.complete(const VoiceEvent(VoiceEventType.error, code: 'stopped'));
    _waiting = null;
    await voice.cancelListening();
    await voice.stopSpeaking();
    _errorTimer?.cancel();
    recommendations = const [];
    pendingItems = const [];
    upsellMenu = null;
    _clearAsk();
    partial = '';
    level = 0;
    _set(ConversationState.idle, say: say ?? '');
  }

  void _clearAsk() {
    askingMenu = null;
    askingGroup = null;
  }

  /// 결제가 끝나 새 고객이 시작할 때 부릅니다.
  void resetOrder() {
    _upsellDone = false;
  }

  @override
  void dispose() {
    _session++;
    _errorTimer?.cancel();
    _events?.cancel();
    // 화면을 떠나면 듣기·안내 음성도 멈춥니다.
    _waiting = null;
    unawaited(voice.cancelListening());
    unawaited(voice.stopSpeaking());
    super.dispose();
  }

  /// 화면 버튼(네·아니요·추천 카드·옵션)으로 답하면 듣고 있던 인식을 끊습니다.
  /// 그대로 두면 안내 음성을 고객 발화로 인식하거나 무음 시간 초과로 대화가 끝납니다.
  Future<void> _interrupt() async {
    _lastActivity = _clock();
    // 말하던 안내가 끝난 뒤 이 버튼의 결과(해석 중·다음 질문) 상태를 덮지 않게 합니다.
    _promptSeq++;
    final waiting = _waiting;
    _waiting = null;
    waiting?.complete(
      const VoiceEvent(VoiceEventType.error, code: 'superseded'),
    );
    await voice.cancelListening();
  }

  // ---------- 음성 입출력 ----------

  void _onEvent(VoiceEvent event) {
    switch (event.type) {
      case VoiceEventType.partial:
        partial = event.text ?? '';
        _lastActivity = _clock();
        notifyListeners();
      case VoiceEventType.level:
        level = event.level ?? 0;
        notifyListeners();
      case VoiceEventType.speechBegin:
        _lastActivity = _clock();
      case VoiceEventType.finalResult || VoiceEventType.error:
        final waiting = _waiting;
        _waiting = null;
        waiting?.complete(event);
      default:
        break;
    }
  }

  /// 안내를 말한 뒤 고객 발화를 기다립니다.
  ///
  /// 마이크는 고객이 누를 때만 켭니다. 안내가 끝나면 [listenAfterPrompt]가 아니면 듣지 않고,
  /// 고객이 마이크 버튼([talk])이나 화면 버튼(추천 카드·네/아니요·옵션)을 누르기를 기다립니다.
  /// [listen]이 true면 바로 듣고(말로 주문하기를 누른 직후), false면 설정과 관계없이 듣지 않습니다.
  Future<void> _prompt(int session, String text, {bool? listen}) async {
    // 추천·확인·추가 제안 상태는 유지한 채 듣습니다. 그 밖에는 일반 청취입니다.
    final keep = _isWaitingState(state) ? state : ConversationState.listening;
    final prompt = ++_promptSeq;
    message = text;
    notifyListeners();
    await voice.speak(text, rate: _rate);
    // 말하는 사이에 고객이 마이크·화면 버튼을 눌렀으면 그쪽 흐름이 이어 갑니다.
    if (session != _session || prompt != _promptSeq || _micOpen) return;
    if (listen ?? listenAfterPrompt) {
      await _listen(session, keep);
    } else {
      partial = '';
      level = 0;
      _set(keep);
    }
  }

  /// 지금 마이크 버튼을 누를 수 있는지(대화 중이고, 듣거나 준비·해석 중이 아님).
  bool get canTalk =>
      active &&
      !_micOpen &&
      state != ConversationState.preparing &&
      state != ConversationState.thinking;

  /// 마이크 버튼. 누를 때마다 한 번 듣고, 들은 말을 처리합니다.
  Future<void> talk() async {
    if (!canTalk) return;
    // 아직 말하던 안내가 끝난 뒤 상태를 덮지 않게 합니다.
    _promptSeq++;
    _errorTimer?.cancel();
    if (state == ConversationState.error) {
      offerStaffCall = false;
      _failures = 0;
      state = ConversationState.listening;
    }
    _lastActivity = _clock();
    final keep = _isWaitingState(state) ? state : ConversationState.listening;
    await _listen(_session, keep);
  }

  bool _isWaitingState(ConversationState s) =>
      s == ConversationState.recommending ||
      s == ConversationState.confirming ||
      s == ConversationState.choosingOption ||
      s == ConversationState.upsell;

  Future<void> _listen(int session, ConversationState listeningState) async {
    while (session == _session) {
      partial = '';
      level = 0;
      _micOpen = true;
      _set(listeningState);
      final waiting = Completer<VoiceEvent>();
      _waiting = waiting;
      try {
        await voice.listen(silenceMs: _silenceMs);
      } catch (_) {
        _waiting = null;
        _micOpen = false;
        await _fail(session, '음성 인식을 시작하지 못했어요.');
        return;
      }
      final event = await waiting.future;
      _micOpen = false;
      if (session != _session) return;
      // 화면 버튼으로 이미 답했으면 이 듣기는 끝입니다.
      if (event.code == 'superseded') return;
      if (event.type == VoiceEventType.finalResult &&
          (event.text ?? '').trim().isNotEmpty) {
        _lastActivity = _clock();
        await handleText(event.text!.trim(), session: session);
        return;
      }
      final code = event.code ?? 'client';
      if (code == 'no_speech' || code == 'busy' || code == 'client') {
        if (!listenAfterPrompt) {
          // 누를 때마다 한 번만 듣습니다. 못 들었으면 다시 누르도록 안내합니다.
          await _prompt(
            session,
            senior
                ? '잘 들리지 않았어요. 마이크 버튼을 누르고 천천히 말씀해 주세요.'
                : '잘 들리지 않았어요. 마이크 버튼을 누르고 다시 말씀해 주세요.',
          );
          return;
        }
        if (_clock().difference(_lastActivity) >= silenceLimit) {
          await stop(say: '말씀이 없어 음성 주문을 마칠게요. 필요하시면 다시 버튼을 눌러 주세요.');
          return;
        }
        continue;
      }
      if (code == 'permission') {
        await stop(say: '마이크 권한이 필요해요. 관리자에게 권한 허용을 요청해 주세요.');
      } else if (code == 'network' || code == 'language') {
        // 인식 서비스가 잠깐 안 되어도 고르던 메뉴(옵션 질문·추가 제안)는 버리지 않습니다.
        // 화면 버튼은 그대로 쓸 수 있고, 마이크는 다시 누르면 다시 시도합니다.
        await _prompt(
          session,
          '음성 인식 서비스에 연결하지 못했어요. 화면 버튼으로 고르시거나 잠시 뒤 마이크 버튼을 다시 눌러 주세요.',
          listen: false,
        );
      } else {
        await _fail(session, '잘 들리지 않았어요.');
      }
      return;
    }
  }

  // ---------- 발화 처리 ----------

  /// 인식된 문장을 처리합니다. 화면 버튼(네/아니요/추천 카드)도 이 흐름을 씁니다.
  Future<void> handleText(String text, {int? session}) async {
    if (session == null) await _interrupt();
    final current = session ?? _session;
    heard = text;
    partial = '';
    if (state == ConversationState.choosingOption) {
      final option = _matchOption(text);
      if (option != null) {
        await _applyOption(current, option);
        return;
      }
    }
    final local = _localIntent(text);
    if (local != null) {
      await _handle(current, local);
      return;
    }
    final waitingState = state;
    _set(ConversationState.thinking, say: '알아보는 중이에요…');
    InterpretResult result;
    try {
      result = await interpreter.interpret(_payload(text, waitingState));
    } on VoiceServiceUnavailable {
      if (current != _session) return;
      await stop(say: '지금은 음성 주문을 쓸 수 없어요. 화면을 눌러 주문해 주세요.');
      return;
    }
    if (current != _session) return;
    // 해석 중에 바뀐 상태 대신 발화 당시 상태 기준으로 처리합니다.
    state = waitingState;
    await _handle(current, result);
  }

  static const _yes = {
    '네',
    '예',
    '응',
    '어',
    '그래',
    '좋아',
    '좋아요',
    '맞아',
    '맞아요',
    '네맞아요',
    '네좋아요',
    '담아',
    '담아줘',
    '담아주세요',
    '주세요',
    '그걸로',
    '그걸로줘',
    '그걸로주세요',
    '네주세요',
    '예스',
    '오케이',
  };
  static const _no = {
    '아니',
    '아니요',
    '아뇨',
    '아니오',
    '됐어',
    '됐어요',
    '괜찮아',
    '괜찮아요',
    '아니괜찮아요',
    '싫어',
    '취소',
    '안할게요',
    '필요없어요',
    '없어요',
    '아니요괜찮아요',
  };

  static const _yesStarts = ['네', '예', '응', '좋아', '그래', '맞아', '오케이'];
  static const _noStarts = ['아니', '아뇨', '됐', '괜찮', '싫', '안할', '필요없'];

  /// "네 그걸로 주세요"처럼 긍정·부정으로 시작하는 짧은 대답(8자 이하).
  /// 더 길면 "네, 그리고 콜라도"처럼 새 주문이 섞였을 수 있어 서버 해석에 맡깁니다.
  bool _shortReply(String normalized, List<String> starts) =>
      normalized.length <= 8 &&
      !RegExp(r'\d').hasMatch(normalized) &&
      starts.any(normalized.startsWith) &&
      !(starts == _yesStarts && _noStarts.any(normalized.contains));

  /// 확인·추가 제안 단계의 짧은 예/아니요는 서버 없이 바로 처리합니다(응답 지연 단축).
  InterpretResult? _localIntent(String text) {
    final normalized = text.replaceAll(RegExp(r'[\s.,!?~]'), '');
    if (state == ConversationState.confirming ||
        state == ConversationState.upsell) {
      if (_yes.contains(normalized) || _shortReply(normalized, _yesStarts)) {
        return const InterpretResult(intent: 'confirm');
      }
      if (_no.contains(normalized) || _shortReply(normalized, _noStarts)) {
        return const InterpretResult(intent: 'deny');
      }
    }
    // "더 필요하신 게 있으세요?"에 "없어요/아니요"라고 하면 다 고른 것으로 보고 결제 안내로 넘어갑니다.
    if (state == ConversationState.listening &&
        bus.cart.entries.isNotEmpty &&
        _no.contains(normalized)) {
      return const InterpretResult(intent: 'checkout');
    }
    if (const {
      '결제',
      '결제할게요',
      '결제해주세요',
      '결제할게',
      '계산할게요',
      '계산해주세요',
    }.contains(normalized)) {
      return const InterpretResult(intent: 'checkout');
    }
    if (const {'그만', '그만할게요', '끝', '종료', '음성주문끝'}.contains(normalized)) {
      return const InterpretResult(intent: 'cancel');
    }
    return null;
  }

  Map<String, Object?> _payload(String text, ConversationState current) => {
    'text': text.length > 200 ? text.substring(0, 200) : text,
    'state': switch (current) {
      ConversationState.recommending => 'recommending',
      ConversationState.confirming => 'confirming',
      ConversationState.upsell => 'upsell',
      // 옵션 질문에 선택지 이름이 아닌 말을 하면 새 발화로 해석합니다.
      _ => 'listening',
    },
    'viewing_menu_id': int.tryParse(viewingMenu?.call()?.id ?? ''),
    'cart': [
      for (final entry in bus.cart.entries)
        if (int.tryParse(entry.menu.id) != null)
          {
            'entry_id': entry.id,
            'menu_id': int.parse(entry.menu.id),
            'quantity': entry.quantity,
            'option_ids': entry.options
                .map((o) => int.tryParse(o.id))
                .whereType<int>()
                .toList(),
          },
    ],
    'recommended_menu_ids': [
      for (final rec in recommendations)
        if (int.tryParse(rec.menu.id) != null) int.parse(rec.menu.id),
    ],
    'mode': senior ? 'senior' : 'normal',
  };

  Future<void> _handle(int session, InterpretResult result) async {
    if (state == ConversationState.choosingOption) {
      // 옵션을 묻는 중인데 알아듣지 못하면 같은 질문을 다시 합니다. 다른 주문을 말하면 그 주문으로 넘어갑니다.
      if (const {'unknown', 'clarify', 'help'}.contains(result.intent)) {
        _failures++;
        if (_failures >= maxFailures) {
          await _fail(session, '');
        } else {
          await _askAgain(session);
        }
        return;
      }
      _alreadyConfirmed = false;
      if (result.intent == 'deny') {
        _clearAsk();
        pendingItems = const [];
        state = ConversationState.listening;
        await _prompt(session, '알겠어요. 원하시는 메뉴를 다시 말씀해 주세요.');
        return;
      }
      _clearAsk();
      pendingItems = const [];
      state = ConversationState.listening;
    }
    switch (result.intent) {
      case 'order':
        await _confirmItems(session, _toCommands(result.items));
      case 'select':
        final index = result.selectIndex;
        if (index != null && index >= 0 && index < recommendations.length) {
          await selectRecommendation(index, viaVoice: true);
        } else {
          await _confirmItems(session, _toCommands(result.items));
        }
      case 'recommend':
        await _recommend(session, result);
      case 'modify':
        await _modify(session, result.items);
      case 'remove':
        await _remove(session, result.items);
      case 'clear':
        if (bus.cart.entries.isEmpty) {
          await _prompt(session, '장바구니가 이미 비어 있어요. 드시고 싶은 메뉴를 말씀해 주세요.');
        } else {
          _pendingClear = true;
          state = ConversationState.confirming;
          await _prompt(session, '장바구니에 담긴 메뉴를 모두 뺄까요?');
        }
      case 'confirm':
        await _onConfirm(session, true);
      case 'deny':
        await _onConfirm(session, false);
      case 'checkout':
        await _checkout(session);
      case 'cancel':
        await stop(say: '음성 주문을 마칠게요. 필요하시면 다시 버튼을 눌러 주세요.');
      case 'help':
        _failures = 0;
        await _prompt(session, result.question ?? _helpText);
      case 'clarify':
        _failures = 0;
        await _prompt(
          session,
          result.question ?? '어떤 메뉴를 말씀하신 건지 다시 한 번 말씀해 주세요.',
        );
      default:
        await _fail(session, '잘 알아듣지 못했어요.');
    }
  }

  String get _helpText => senior
      ? '드시고 싶은 메뉴 이름과 개수를 천천히 말씀해 주세요. 무엇을 드실지 모르겠으면 해장에 좋은 거 추천해 줘처럼 말씀하셔도 돼요.'
      : '메뉴 이름과 개수를 말씀하시거나, 해장에 좋은 거 추천해 줘처럼 상황을 말씀해 주세요.';

  Future<void> _fail(int session, String reason) async {
    _failures++;
    if (_failures >= maxFailures) {
      offerStaffCall = true;
      _clearAsk();
      _set(
        ConversationState.error,
        say: '음성으로 주문하기 어려우시면 화면을 눌러 주문하시거나 직원을 불러 드릴게요.',
      );
      await voice.speak(message, rate: _rate);
      _errorTimer?.cancel();
      _errorTimer = Timer(errorTimeout, () {
        if (session == _session && state == ConversationState.error) {
          unawaited(stop());
        }
      });
      return;
    }
    await _prompt(
      session,
      '$reason ${senior ? '메뉴 이름을 천천히 다시 말씀해 주세요.' : '다시 말씀해 주세요.'}',
    );
  }

  // ---------- 주문 ----------

  List<AddItemCommand> _toCommands(
    List<InterpretedItem> items, {
    bool recommended = false,
  }) {
    final current = catalog();
    final recIds = recommendations.map((r) => r.menu.id).toSet();
    final commands = <AddItemCommand>[];
    for (final item in items) {
      final menu = current.menuById(item.menuId);
      if (menu == null || menu.isSoldOut) continue;
      commands.add(
        AddItemCommand(
          menu,
          item.quantity.clamp(1, 99),
          options: _options(menu, item.optionIds),
          recommended: recommended || recIds.contains(menu.id),
        ),
      );
    }
    return commands;
  }

  List<MenuOption> _options(MenuItem menu, List<String> ids) =>
      menu.options.where((o) => ids.contains(o.id) && !o.isSoldOut).toList();

  String _describe(List<AddItemCommand> commands) => joinNames([
    for (final command in commands)
      '${command.menu.name}${command.options.isEmpty ? '' : ' ${command.options.map((o) => o.name).join(' ')}'} ${command.quantity}개',
  ]);

  Future<void> _confirmItems(int session, List<AddItemCommand> commands) async {
    if (commands.isEmpty) {
      await _fail(session, '말씀하신 메뉴를 찾지 못했어요.');
      return;
    }
    _failures = 0;
    for (final (index, command) in commands.indexed) {
      final missing = command.menu.missingGroups(command.options);
      if (missing.isNotEmpty) {
        pendingItems = commands;
        _askIndex = index;
        askingMenu = command.menu;
        askingGroup = missing.first;
        onHighlight?.call({command.menu.id}, focus: true);
        state = ConversationState.choosingOption;
        await _askAgain(session);
        return;
      }
    }
    _clearAsk();
    if (_alreadyConfirmed) {
      _alreadyConfirmed = false;
      pendingItems = const [];
      state = ConversationState.listening;
      _execute(commands);
      await _afterAdd(session, '${_describe(commands)} 담았어요. ');
      return;
    }
    pendingItems = commands;
    onHighlight?.call(commands.map((c) => c.menu.id).toSet(), focus: true);
    state = ConversationState.confirming;
    await _prompt(session, '${_describe(commands)} 담을까요?');
  }

  /// 필수 옵션 질문(구상안 13장 재질문: 필요한 항목만 묻기).
  Future<void> _askAgain(int session) async {
    final menu = askingMenu;
    final group = askingGroup;
    if (menu == null || group == null) return;
    final names = optionChoices.map((o) => o.name).toList();
    await _prompt(
      session,
      '${eulReul('${menu.name} $group')} 골라 주세요. ${joinNames(names)} 중에 말씀하시거나 화면에서 눌러 주세요.',
    );
  }

  static const _ordinals = {
    '첫번째': 0, '첫째': 0, '1번': 0, '일번': 0,
    '두번째': 1, '둘째': 1, '2번': 1, '이번': 1,
    '세번째': 2, '셋째': 2, '3번': 2, '삼번': 2,
    '네번째': 3, '넷째': 3, '4번': 3,
  };

  /// "매운맛", "보통으로", "두 번째 거"처럼 묻는 그룹의 선택지 하나를 가리키면 그 옵션.
  /// 둘 이상에 걸리거나 아무것도 아니면 null(서버 해석으로 넘어감).
  MenuOption? _matchOption(String text) {
    final choices = optionChoices;
    final normalized = text.replaceAll(RegExp(r'[\s.,!?~]'), '');
    for (final entry in _ordinals.entries) {
      if (normalized.contains(entry.key) && entry.value < choices.length) {
        return choices[entry.value];
      }
    }
    MenuOption? best;
    var bestLength = 0;
    var tie = false;
    for (final option in choices) {
      final name = option.name.replaceAll(RegExp(r'\s'), '');
      final stems = {
        name,
        if (name.endsWith('맛') && name.length > 2)
          name.substring(0, name.length - 1),
      };
      for (final stem in stems) {
        if (stem.length < 2 || !normalized.contains(stem)) continue;
        if (stem.length > bestLength) {
          best = option;
          bestLength = stem.length;
          tie = false;
        } else if (stem.length == bestLength && best != option) {
          tie = true;
        }
      }
    }
    return tie ? null : best;
  }

  Future<void> _applyOption(int session, MenuOption option) async {
    final commands = List.of(pendingItems);
    if (_askIndex >= commands.length) return;
    final command = commands[_askIndex];
    commands[_askIndex] = AddItemCommand(
      command.menu,
      command.quantity,
      options: [...command.options.where((o) => o.group != option.group), option],
      recommended: command.recommended,
    );
    _clearAsk();
    await _confirmItems(session, commands);
  }

  /// 화면의 옵션 버튼을 눌렀을 때.
  Future<void> chooseOption(MenuOption option) async {
    if (state != ConversationState.choosingOption) return;
    await _interrupt();
    await _applyOption(_session, option);
  }

  Future<void> _onConfirm(int session, bool yes) async {
    if (state == ConversationState.upsell) {
      final menu = upsellMenu;
      upsellMenu = null;
      if (yes && menu != null && menu.optionGroups.isNotEmpty) {
        // 맵기·사이즈처럼 골라야 할 옵션이 있으면 먼저 묻습니다.
        // 이미 "네"라고 했으므로 옵션을 고르면 다시 묻지 않고 바로 담습니다.
        state = ConversationState.listening;
        _alreadyConfirmed = true;
        await _confirmItems(session, [AddItemCommand(menu, 1, recommended: true)]);
      } else if (yes && menu != null) {
        _execute([AddItemCommand(menu, 1, recommended: true)]);
        state = ConversationState.listening;
        await _afterAdd(session, '${eulReul(menu.name)} 담았어요. ');
      } else {
        state = ConversationState.listening;
        await _prompt(session, _nextPrompt);
      }
      return;
    }
    if (_pendingClear) {
      _pendingClear = false;
      state = ConversationState.listening;
      if (yes) {
        bus.run(const ClearCartCommand(), source: CommandSource.voice);
        await _prompt(session, '장바구니를 비웠어요. 드시고 싶은 메뉴를 말씀해 주세요.');
      } else {
        await _prompt(session, '그대로 둘게요. $_nextPrompt');
      }
      return;
    }
    if (state == ConversationState.confirming && pendingItems.isNotEmpty) {
      final items = pendingItems;
      pendingItems = const [];
      state = ConversationState.listening;
      if (yes) {
        _execute(items);
        await _afterAdd(session, '담았어요. ');
      } else {
        await _prompt(session, '알겠어요. 원하시는 메뉴를 다시 말씀해 주세요.');
      }
      return;
    }
    // 확인할 내용이 없는데 "네"라고 하면 다음 안내를 합니다.
    await _prompt(session, yes ? _nextPrompt : '알겠어요. 더 필요하신 게 있으면 말씀해 주세요.');
  }

  void _execute(List<AddItemCommand> commands) {
    bus.runAll(commands, source: CommandSource.voice);
    onHighlight?.call(commands.map((c) => c.menu.id).toSet(), focus: true);
    for (final command in commands.where((c) => c.recommended)) {
      _logSelection(command.menu.id);
    }
    recommendations = const [];
  }

  String get _nextPrompt => senior
      ? '더 드실 메뉴가 있으면 말씀해 주세요. 다 고르셨으면 결제라고 말씀해 주세요.'
      : '더 필요하신 게 있으세요? 다 고르셨으면 결제라고 말씀해 주세요.';

  Future<void> _afterAdd(int session, String prefix) async {
    final settings = _settings;
    if (!_upsellDone && settings.upsellEnabled && !senior) {
      final menu = _engine.upsell(
        catalog().menus,
        bus.cart.entries.map((e) => e.menu.id).toSet(),
        settings,
      );
      if (menu != null) {
        _upsellDone = true;
        upsellMenu = menu;
        onHighlight?.call({menu.id});
        state = ConversationState.upsell;
        await _prompt(session, '$prefix${menu.name}도 같이 하시겠어요?');
        return;
      }
    }
    await _prompt(session, '$prefix$_nextPrompt');
  }

  // ---------- 추천 ----------

  Future<void> _recommend(int session, InterpretResult result) async {
    _failures = 0;
    final current = catalog();
    final ranked = _engine.rank(
      result.recommendations,
      current.menus,
      current.settings,
    );
    if (ranked.isEmpty) {
      final fallback = _engine.fallback(
        current.menus,
        popular: current.popularMenuIds,
      );
      recommendations = [
        for (final menu in fallback)
          RankedRecommendation(
            menu: menu,
            fit: 0,
            profit: 0,
            pick: menu.storePick ? 100 : 0,
            score: 0,
            reason: '',
          ),
      ];
      _recLogId = null;
      onHighlight?.call(fallback.map((m) => m.id).toSet());
      state = ConversationState.recommending;
      await _prompt(
        session,
        fallback.isEmpty
            ? '딱 맞는 메뉴를 찾지 못했어요. 드시고 싶은 메뉴를 말씀해 주세요.'
            : '딱 맞는 메뉴를 찾지 못했어요. ${joinNames(fallback.map((m) => m.name).toList())}는 어떠세요?',
      );
      return;
    }
    recommendations = ranked;
    onHighlight?.call(ranked.map((r) => r.menu.id).toSet());
    _recLogId = _newId();
    unawaited(
      _safeLog({
        'client_log_id': _recLogId,
        'situation': result.situation,
        'shown_menu_ids': ranked
            .map((r) => int.tryParse(r.menu.id))
            .whereType<int>()
            .toList(),
        'policy_profit': current.settings.policyProfit,
      }),
    );
    final first = ranked.first;
    final others = ranked.skip(1).map((r) => r.menu.name).toList();
    final reason = first.reason.isEmpty
        ? ''
        : '${first.reason.replaceAll(RegExp(r'[.。]$'), '')}. ';
    state = ConversationState.recommending;
    await _prompt(
      session,
      '$reason${first.menu.name} 어떠세요?${others.isEmpty ? '' : ' ${joinNames(others)}도 있어요.'}',
    );
  }

  /// 추천 카드를 누르거나 "두 번째 거"처럼 말했을 때.
  Future<void> selectRecommendation(int index, {bool viaVoice = false}) async {
    if (index < 0 || index >= recommendations.length) return;
    if (!viaVoice) await _interrupt();
    final session = _session;
    final menu = recommendations[index].menu;
    final command = AddItemCommand(menu, 1, recommended: _recLogId != null);
    if (viaVoice || menu.optionGroups.isNotEmpty) {
      unawaited(_confirmItems(session, [command]));
      return;
    }
    // 화면을 직접 눌렀으면 확인 없이 담습니다.
    pendingItems = const [];
    _execute([command]);
    state = ConversationState.listening;
    if (active) unawaited(_afterAdd(session, '${eulReul(menu.name)} 담았어요. '));
  }

  void _logSelection(String menuId) {
    final logId = _recLogId;
    final id = int.tryParse(menuId);
    if (logId == null || id == null) return;
    final shown = recommendations
        .map((r) => int.tryParse(r.menu.id))
        .whereType<int>()
        .toList();
    if (!shown.contains(id)) return;
    unawaited(
      _safeLog({
        'client_log_id': logId,
        'shown_menu_ids': shown,
        'selected_menu_id': id,
        'policy_profit': catalog().settings.policyProfit,
      }),
    );
    _recLogId = null;
  }

  Future<void> _safeLog(Map<String, Object?> payload) async {
    try {
      await interpreter.logRecommendation(payload);
    } catch (_) {
      // 추천 기록 실패는 주문 흐름에 영향을 주지 않습니다.
    }
  }

  // ---------- 정정 ----------

  Future<void> _modify(int session, List<InterpretedItem> items) async {
    final done = <String>[];
    for (final item in items) {
      final entryId = item.entryId;
      final entry = entryId == null ? null : bus.cart.entry(entryId);
      if (entry == null) continue;
      final options = _options(entry.menu, item.optionIds);
      final sameOptions =
          options
              .map((o) => o.id)
              .toSet()
              .containsAll(entry.options.map((o) => o.id)) &&
          options.length == entry.options.length;
      bus.run(
        sameOptions
            ? SetQuantityCommand(
                entry.id,
                item.quantity.clamp(1, 99),
                entry.menu.name,
              )
            : UpdateEntryCommand(
                entry.id,
                item.quantity.clamp(1, 99),
                options,
                entry.menu.name,
              ),
        source: CommandSource.voice,
      );
      done.add('${entry.menu.name} ${item.quantity}개');
    }
    if (done.isEmpty) {
      await _prompt(session, '바꿀 메뉴를 찾지 못했어요. 장바구니에 있는 메뉴 이름을 말씀해 주세요.');
      return;
    }
    _failures = 0;
    // '…2개'로 끝나므로 조사는 항상 '로'입니다.
    await _prompt(session, '${joinNames(done)}로 바꿨어요. $_nextPrompt');
  }

  Future<void> _remove(int session, List<InterpretedItem> items) async {
    final done = <String>[];
    for (final item in items) {
      final entry = item.entryId == null ? null : bus.cart.entry(item.entryId!);
      if (entry == null) continue;
      bus.run(
        RemoveEntryCommand(entry.id, entry.menu.name),
        source: CommandSource.voice,
      );
      done.add(entry.menu.name);
    }
    if (done.isEmpty) {
      await _prompt(session, '뺄 메뉴를 찾지 못했어요. 장바구니에 있는 메뉴 이름을 말씀해 주세요.');
      return;
    }
    _failures = 0;
    await _prompt(session, '${eulReul(joinNames(done))} 뺐어요. $_nextPrompt');
  }

  // ---------- 결제 안내 ----------

  Future<void> _checkout(int session) async {
    if (bus.cart.entries.isEmpty) {
      await _prompt(session, '아직 담은 메뉴가 없어요. 드시고 싶은 메뉴를 말씀해 주세요.');
      return;
    }
    _set(
      ConversationState.checkout,
      say: senior
          ? '결제 화면으로 넘어갈게요. 화면에서 결제 방법을 골라 주세요. 카드는 화면 아래 단말기에 꽂아 주시면 돼요.'
          : '결제 화면으로 넘어갈게요. 결제 방법을 골라 주세요.',
    );
    await voice.speak(message, rate: _rate);
    if (session != _session) return;
    await stop(say: '');
    await onCheckout?.call();
  }

  /// 반복 실패 화면의 직원 호출 버튼.
  Future<bool> callStaff() async {
    try {
      await interpreter.staffCall('voice_help');
      await stop(say: '직원을 불렀어요. 잠시만 기다려 주세요.');
      return true;
    } catch (_) {
      await stop(say: '직원 호출을 보내지 못했어요. 카운터에 말씀해 주세요.');
      return false;
    }
  }
}

String _uuid() {
  final random = Random.secure();
  final bytes = List.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
