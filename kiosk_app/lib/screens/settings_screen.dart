import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/kiosk_services.dart';
import '../core/kiosk_settings.dart';
import '../data/kiosk_api.dart';
import '../data/usability_log.dart';
import 'order_history_dialog.dart';

/// 관리자 PIN 확인. 처음 실행이면 새 PIN을 정하게 합니다. 성공하면 true.
///
/// 이미 서버에 연결된 키오스크(기기 토큰 있음)인데 PIN이 없으면, 고객이 PIN을 만들어
/// 설정에 들어가지 못하도록 저장된 기기 토큰을 입력해야 PIN을 만들 수 있습니다.
Future<bool> askAdminPin(
  BuildContext context,
  KioskSettings settings, {
  String deviceToken = '',
}) async {
  final ok = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) =>
        _AdminPinDialog(settings: settings, deviceToken: deviceToken),
  );
  return ok ?? false;
}

/// 입력칸 컨트롤러는 대화상자 State가 갖고 dispose에서 정리합니다.
/// showDialog는 닫히는 애니메이션이 시작될 때 돌아오므로, 그 직후에 정리하면
/// 아직 그려지는 입력칸이 정리된 컨트롤러를 써서 오류 화면이 납니다.
class _AdminPinDialog extends StatefulWidget {
  const _AdminPinDialog({required this.settings, required this.deviceToken});

  final KioskSettings settings;
  final String deviceToken;

  @override
  State<_AdminPinDialog> createState() => _AdminPinDialogState();
}

class _AdminPinDialogState extends State<_AdminPinDialog> {
  final controller = TextEditingController();
  final confirm = TextEditingController();
  final tokenField = TextEditingController();
  late final bool creating = !widget.settings.hasPin;
  late final bool needToken = creating && widget.deviceToken.isNotEmpty;
  String? error;

  @override
  void dispose() {
    controller.dispose();
    confirm.dispose();
    tokenField.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final settings = widget.settings;
    final pin = controller.text;
    if (creating) {
      if (needToken &&
          !_sameSecret(tokenField.text.trim(), widget.deviceToken)) {
        setState(() => error = '기기 토큰이 맞지 않습니다.');
        return;
      }
      if (!KioskSettings.validPin(pin)) {
        setState(() => error = '숫자 4~8자리로 정해 주세요.');
        return;
      }
      if (pin != confirm.text) {
        setState(() => error = '두 PIN이 다릅니다.');
        return;
      }
      await settings.setPin(pin);
      if (mounted) Navigator.pop(context, true);
      return;
    }
    final locked = settings.pinLockRemaining(DateTime.now());
    if (locked != null) {
      setState(
        () => error = '여러 번 틀려 ${locked.inMinutes + 1}분 동안 잠겼습니다.',
      );
      return;
    }
    if (await settings.checkPin(pin)) {
      if (mounted) Navigator.pop(context, true);
    } else if (mounted) {
      controller.clear();
      setState(() => error = 'PIN이 맞지 않습니다.');
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(creating ? '관리자 PIN 만들기' : '관리자 PIN 입력'),
    content: SizedBox(
      width: 360,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (creating) const Text('키오스크 설정을 보호할 숫자 4~8자리 PIN을 정해 주세요.'),
          if (needToken)
            TextField(
              key: const Key('pin-token-field'),
              controller: tokenField,
              autofocus: true,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: '기기 토큰 (회사 관리자 웹에서 발급한 값)',
              ),
            ),
          TextField(
            key: const Key('pin-field'),
            controller: controller,
            autofocus: !needToken,
            obscureText: true,
            keyboardType: TextInputType.number,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(8),
            ],
            decoration: const InputDecoration(labelText: 'PIN'),
          ),
          if (creating)
            TextField(
              key: const Key('pin-confirm-field'),
              controller: confirm,
              obscureText: true,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(8),
              ],
              decoration: const InputDecoration(labelText: 'PIN 확인'),
            ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                error!,
                style: const TextStyle(color: Color(0xFFB3261E)),
              ),
            ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context, false),
        child: const Text('취소'),
      ),
      FilledButton(onPressed: _submit, child: const Text('확인')),
    ],
  );
}

/// 새 PIN 입력. 컨트롤러 정리 시점은 [_AdminPinDialog]와 같은 이유로 State.dispose입니다.
class _NewPinDialog extends StatefulWidget {
  const _NewPinDialog();

  @override
  State<_NewPinDialog> createState() => _NewPinDialogState();
}

class _NewPinDialogState extends State<_NewPinDialog> {
  final controller = TextEditingController();

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('새 관리자 PIN'),
    content: TextField(
      controller: controller,
      obscureText: true,
      keyboardType: TextInputType.number,
      inputFormatters: [
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(8),
      ],
      decoration: const InputDecoration(labelText: '숫자 4~8자리'),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('취소'),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, controller.text),
        child: const Text('변경'),
      ),
    ],
  );
}

/// 길이와 관계없이 끝까지 비교합니다(입력 시간으로 토큰을 추측하지 못하게).
bool _sameSecret(String a, String b) {
  if (a.isEmpty || b.isEmpty) return false;
  var diff = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) {
    diff |= (i < a.length ? a.codeUnitAt(i) : 0) ^ b.codeUnitAt(i);
  }
  return diff == 0;
}

/// 매장 직원용 키오스크 설정. 서버 주소·매장·기기 번호·기기 토큰, 화면 고정, 연결 확인.
/// 저장하면 앱을 다시 시작하라는 안내를 띄웁니다(새 설정으로 동기화를 다시 시작).
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.services});
  final KioskServices services;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController server;
  late final TextEditingController store;
  late final TextEditingController device;
  final token = TextEditingController();
  String? status;
  bool busy = false;
  late bool lockTask;

  KioskSettings get settings => widget.services.settings!;

  @override
  void initState() {
    super.initState();
    final config = widget.services.config;
    server = TextEditingController(text: config.serverUrl);
    store = TextEditingController(
      text: config.storeId > 0 ? '${config.storeId}' : '',
    );
    device = TextEditingController(
      text: config.deviceId > 0 ? '${config.deviceId}' : '',
    );
    lockTask = settings.lockTask;
  }

  @override
  void dispose() {
    for (final controller in [server, store, device, token]) {
      controller.dispose();
    }
    super.dispose();
  }

  KioskConfig? _form() {
    final url = Uri.tryParse(server.text.trim());
    final storeId = int.tryParse(store.text.trim()) ?? 0;
    final deviceId = int.tryParse(device.text.trim()) ?? 0;
    if (url == null ||
        !['http', 'https'].contains(url.scheme) ||
        url.host.isEmpty) {
      setState(() => status = '서버 주소를 http://192.168.0.10:8001 형식으로 입력해 주세요.');
      return null;
    }
    if (storeId < 1 || deviceId < 1) {
      setState(() => status = '매장 번호와 기기 번호를 확인해 주세요.');
      return null;
    }
    final newToken = token.text.trim();
    final serverUrl = server.text.trim().replaceFirst(RegExp(r'/$'), '');
    final previous = Uri.tryParse(widget.services.config.serverUrl);
    // 서버 주소(호스트·포트)를 바꾸면 저장된 토큰을 새 주소로 보내지 않도록 다시 입력받습니다.
    final sameServer =
        previous != null &&
        previous.scheme == url.scheme &&
        previous.host == url.host &&
        previous.port == url.port;
    if (newToken.isEmpty && !sameServer) {
      setState(() => status = '서버 주소를 바꾸면 기기 토큰도 다시 입력해 주세요.');
      return null;
    }
    return KioskConfig(
      serverUrl: serverUrl,
      storeId: storeId,
      deviceId: deviceId,
      token: newToken.isEmpty ? widget.services.config.token : newToken,
    );
  }

  Future<void> _test() async {
    final config = _form();
    if (config == null) return;
    setState(() {
      busy = true;
      status = '연결 확인 중…';
    });
    try {
      final api = KioskApi(
        baseUrl: config.serverUrl,
        deviceId: config.deviceId,
        token: config.token,
      );
      final data = await api.bootstrap();
      final menus = (data['menus'] as List).length;
      if (!mounted) return;
      setState(
        () => status =
            '연결 성공: 메뉴 $menus개, 메뉴 버전 ${data['menu_version']}, '
            'AI 설정 ${data['ai_ready'] == true ? '적용됨' : '미적용'}',
      );
    } on KioskApiException catch (error) {
      if (!mounted) return;
      setState(
        () => status = error.status == 401
            ? '기기 토큰이 맞지 않습니다. 회사 관리자 웹에서 다시 발급해 주세요.'
            : error.message,
      );
    } on KioskUnavailable {
      if (!mounted) return;
      setState(
        () =>
            status = '서버에 연결하지 못했습니다. 같은 와이파이인지, 서버가 0.0.0.0으로 실행 중인지 확인해 주세요.',
      );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _save() async {
    final config = _form();
    if (config == null) return;
    await settings.saveConfig(config);
    await settings.setLockTask(lockTask);
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('저장했습니다'),
        content: const Text('새 설정은 앱을 다시 시작하면 적용됩니다.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('확인'),
          ),
        ],
      ),
    );
  }

  Future<void> _changePin() async {
    final pin = await showDialog<String>(
      context: context,
      builder: (_) => const _NewPinDialog(),
    );
    if (pin == null) return;
    if (!KioskSettings.validPin(pin)) {
      setState(() => status = 'PIN은 숫자 4~8자리입니다.');
      return;
    }
    await settings.setPin(pin);
    if (mounted) setState(() => status = '관리자 PIN을 바꿨습니다.');
  }

  @override
  Widget build(BuildContext context) {
    final services = widget.services;
    final outbox = services.outbox;
    return Scaffold(
      appBar: AppBar(title: const Text('키오스크 설정')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text(
            '서버 연결',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          TextField(
            controller: server,
            decoration: const InputDecoration(
              labelText: '서버 주소 (예: http://192.168.0.10:8001)',
            ),
          ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: store,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: '매장 번호'),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: TextField(
                  controller: device,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: '기기 번호'),
                ),
              ),
            ],
          ),
          TextField(
            controller: token,
            obscureText: true,
            decoration: InputDecoration(
              labelText: services.config.token.isEmpty
                  ? '기기 토큰'
                  : '기기 토큰 (저장됨, 바꿀 때만 입력)',
              helperText: '회사 관리자 웹 > 기기 > 토큰 발급에서 받은 값을 입력합니다.',
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            children: [
              OutlinedButton(
                onPressed: busy ? null : _test,
                child: const Text('연결 확인'),
              ),
              FilledButton(
                onPressed: busy ? null : _save,
                child: const Text('저장'),
              ),
            ],
          ),
          if (status != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(status!, key: const Key('settings-status')),
            ),
          const Divider(height: 40),
          const Text(
            '키오스크 모드',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          SwitchListTile(
            value: lockTask,
            onChanged: (value) async {
              setState(() => lockTask = value);
              if (value) {
                final started = await services.system.startLockTask();
                if (!started && mounted) {
                  setState(
                    () => status =
                        '화면 고정을 시작하지 못했습니다. 안드로이드 설정 > 보안 > 화면 고정을 켜 주세요.',
                  );
                }
              } else {
                await services.system.stopLockTask();
              }
              await settings.setLockTask(value);
            },
            title: const Text('화면 고정(Lock Task)'),
            subtitle: const Text('켜면 고객이 홈·최근 앱 버튼으로 앱을 벗어나지 못합니다.'),
          ),
          ListTile(
            title: const Text('관리자 PIN 변경'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _changePin,
          ),
          ListTile(
            title: const Text('배터리 최적화 제외'),
            subtitle: const Text(
              '절전 때문에 앱이 꺼지지 않도록 예외로 등록합니다. 빅스비 음성 호출은 기기 설정에서 꺼 주세요.',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final ok = await services.system.requestIgnoreBatteryOptimizations();
              if (!mounted) return;
              setState(
                () => status = ok
                    ? '배터리 최적화 예외 요청 화면을 열었습니다.'
                    : '이 기기에서는 요청 화면을 열지 못했습니다. 설정 > 앱 > AI 보이스크 > 배터리에서 바꿔 주세요.',
              );
            },
          ),
          const Divider(height: 40),
          const Text(
            '상태',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          ListTile(
            title: const Text('실행 모드'),
            subtitle: Text(
              services.config.isKioskMode ? '서버 연결(기기 토큰)' : '로컬 시연(기기 토큰 없음)',
            ),
          ),
          if (services.sync != null)
            ListenableBuilder(
              listenable: services.sync!,
              builder: (context, _) => ListTile(
                title: const Text('서버 연결'),
                subtitle: Text(
                  '${services.sync!.online ? '연결됨' : '연결 안 됨'} · '
                  '적용한 메뉴 버전 ${services.sync!.appliedVersion}',
                ),
                trailing: TextButton(
                  onPressed: services.sync!.checkNow,
                  child: const Text('지금 확인'),
                ),
              ),
            ),
          if (outbox != null)
            ListenableBuilder(
              listenable: outbox,
              builder: (context, _) => ListTile(
                title: const Text('전송 대기 주문'),
                subtitle: Text('${outbox.pendingCount}건'),
                trailing: TextButton(
                  onPressed: outbox.flush,
                  child: const Text('다시 보내기'),
                ),
              ),
            ),
          // 최근 주문 기록(주문번호·금액)은 이전 고객 정보라 고객 화면이 아닌 관리자 설정에서만 봅니다.
          ListTile(
            key: const Key('settings-order-history'),
            title: const Text('최근 주문 내역'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => showDialog<void>(
              context: context,
              builder: (_) => OrderHistoryDialog(outbox: outbox),
            ),
          ),
          if (services.usability != null) _UsabilityTile(log: services.usability!),
          const ListTile(title: Text('앱 버전'), subtitle: Text(appVersion)),
        ],
      ),
    );
  }
}

/// 사용성 측정 결과(구상안 15장). 같은 주문 과제를 터치·음성으로 해 본 뒤 평균 탭 수와 시간을 비교합니다.
class _UsabilityTile extends StatefulWidget {
  const _UsabilityTile({required this.log});
  final UsabilityLog log;

  @override
  State<_UsabilityTile> createState() => _UsabilityTileState();
}

class _UsabilityTileState extends State<_UsabilityTile> {
  late Future<Map<String, UsabilitySummary>> _summary = widget.log.summary();

  static const _labels = {
    'touch': '터치 주문',
    'voice': '음성 주문',
    'touch/senior': '터치 주문 · 천천히 모드',
    'voice/senior': '음성 주문 · 천천히 모드',
  };

  @override
  Widget build(BuildContext context) => FutureBuilder(
    future: _summary,
    builder: (context, snapshot) {
      final data = snapshot.data ?? const <String, UsabilitySummary>{};
      return ListTile(
        key: const Key('settings-usability'),
        title: const Text('사용성 측정 (주문 완료까지 평균)'),
        subtitle: Text(
          data.isEmpty
              ? '아직 기록이 없습니다. 주문을 끝까지 하면 탭 수와 시간이 쌓입니다.'
              : [
                  for (final key in _labels.keys)
                    if (data[key] case final s?)
                      '${_labels[key]}: ${s.count}건 · 탭 ${s.averageTaps.toStringAsFixed(1)}회 · '
                          '${s.averageSeconds.toStringAsFixed(0)}초',
                ].join('\n'),
        ),
        trailing: TextButton(
          onPressed: () async {
            await widget.log.clear();
            if (mounted) setState(() => _summary = widget.log.summary());
          },
          child: const Text('기록 지우기'),
        ),
      );
    },
  );
}
