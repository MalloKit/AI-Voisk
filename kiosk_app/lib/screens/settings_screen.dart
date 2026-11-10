import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/kiosk_services.dart';
import '../core/kiosk_settings.dart';
import '../data/kiosk_api.dart';

/// 관리자 PIN 확인. 처음 실행이면 새 PIN을 정하게 합니다. 성공하면 true.
Future<bool> askAdminPin(BuildContext context, KioskSettings settings) async {
  final creating = !settings.hasPin;
  final controller = TextEditingController();
  final confirm = TextEditingController();
  String? error;
  final ok = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (context) => StatefulBuilder(
      builder: (context, update) => AlertDialog(
        title: Text(creating ? '관리자 PIN 만들기' : '관리자 PIN 입력'),
        content: SizedBox(
          width: 360,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (creating) const Text('키오스크 설정을 보호할 숫자 4~8자리 PIN을 정해 주세요.'),
              TextField(
                key: const Key('pin-field'),
                controller: controller,
                autofocus: true,
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
          FilledButton(
            onPressed: () async {
              final pin = controller.text;
              if (creating) {
                if (!KioskSettings.validPin(pin)) {
                  update(() => error = '숫자 4~8자리로 정해 주세요.');
                  return;
                }
                if (pin != confirm.text) {
                  update(() => error = '두 PIN이 다릅니다.');
                  return;
                }
                await settings.setPin(pin);
                if (context.mounted) Navigator.pop(context, true);
                return;
              }
              final locked = settings.pinLockRemaining(DateTime.now());
              if (locked != null) {
                update(
                  () => error = '여러 번 틀려 ${locked.inMinutes + 1}분 동안 잠겼습니다.',
                );
                return;
              }
              if (await settings.checkPin(pin)) {
                if (context.mounted) Navigator.pop(context, true);
              } else {
                controller.clear();
                update(() => error = 'PIN이 맞지 않습니다.');
              }
            },
            child: const Text('확인'),
          ),
        ],
      ),
    ),
  );
  controller.dispose();
  confirm.dispose();
  return ok ?? false;
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
    return KioskConfig(
      serverUrl: server.text.trim().replaceFirst(RegExp(r'/$'), ''),
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
      setState(
        () => status =
            '연결 성공: 메뉴 $menus개, 메뉴 버전 ${data['menu_version']}, '
            'AI 설정 ${data['ai_ready'] == true ? '적용됨' : '미적용'}',
      );
    } on KioskApiException catch (error) {
      setState(
        () => status = error.status == 401
            ? '기기 토큰이 맞지 않습니다. 회사 관리자 웹에서 다시 발급해 주세요.'
            : error.message,
      );
    } on KioskUnavailable {
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
    final controller = TextEditingController();
    final pin = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
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
      ),
    );
    controller.dispose();
    if (pin == null) return;
    if (!KioskSettings.validPin(pin)) {
      setState(() => status = 'PIN은 숫자 4~8자리입니다.');
      return;
    }
    await settings.setPin(pin);
    setState(() => status = '관리자 PIN을 바꿨습니다.');
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
          const ListTile(title: Text('앱 버전'), subtitle: Text(appVersion)),
        ],
      ),
    );
  }
}
