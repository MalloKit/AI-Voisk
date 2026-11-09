import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../data/kakaopay_repository.dart';

/// 공식 PC 결제창의 QR을 앱 안에서 표시합니다. 가짜 QR을 생성하지 않습니다.
class KakaoCheckoutView extends StatefulWidget {
  const KakaoCheckoutView({
    super.key,
    required this.repository,
    required this.paymentId,
    required this.checkoutUrl,
    required this.onResult,
    this.expiresIn,
    this.webViewBuilder,
  });
  final KakaoTestRepository repository;
  final String paymentId;
  final String checkoutUrl;
  final ValueChanged<Map<String, dynamic>> onResult;
  final int? expiresIn;

  /// 플랫폼 WebView 없이 자동 테스트할 때만 주입합니다.
  final Widget Function(Future<void> Function(String) callback)? webViewBuilder;

  @override
  State<KakaoCheckoutView> createState() => _KakaoCheckoutViewState();
}

class _KakaoCheckoutViewState extends State<KakaoCheckoutView>
    with WidgetsBindingObserver {
  Widget? nativeView;
  Timer? timer;
  Timer? countdownTimer;
  final remaining = ValueNotifier<int?>(null);
  int syncedAtTick = 0;
  int? remainingAtSync;
  bool checking = false;
  bool handlingCallback = false;
  bool stopping = false;
  DialogRoute<bool>? cancelDialog;
  bool loading = true;
  bool terminal = false;
  String? error;
  int failures = 0;
  static const connectionDelay = '서버 연결이 지연되고 있습니다. 결제 상태를 계속 확인합니다.';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    syncRemaining(widget.expiresIn);
    countdownTimer = Timer.periodic(const Duration(seconds: 1), (ticker) {
      final initial = remainingAtSync;
      if (initial == null || terminal) return;
      remaining.value = (initial - (ticker.tick - syncedAtTick)).clamp(
        0,
        initial,
      );
    });
    if (widget.webViewBuilder == null) unawaited(initialize());
    timer = Timer.periodic(const Duration(seconds: 2), (_) => check());
  }

  void syncRemaining(int? seconds) {
    if (seconds == null) return;
    remainingAtSync = seconds < 0 ? 0 : seconds;
    syncedAtTick = countdownTimer?.tick ?? 0;
    remaining.value = remainingAtSync;
  }

  Future<void> initialize() async {
    final uri = Uri.tryParse(widget.checkoutUrl);
    if (uri == null || !KakaoTestRepository.isProviderUrl(uri)) {
      setState(() {
        error = '공식 결제창 주소를 확인해 주세요.';
        loading = false;
      });
      return;
    }
    try {
      final view = WebViewController();
      await view.setJavaScriptMode(JavaScriptMode.unrestricted);
      // Flutter 스크롤 설정은 네이티브 WebView의 Android 늘어남에 적용되지 않습니다.
      await view.setOverScrollMode(WebViewOverScrollMode.never);
      // 공용 태블릿에서 고객 휴대폰으로 결제하므로 PC QR 화면을 사용합니다.
      await view.setUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      );
      await view.setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (navigation) async {
            if (widget.repository.callbackUri(
                  navigation.url,
                  widget.paymentId,
                ) !=
                null) {
              unawaited(callback(navigation.url));
              return NavigationDecision.prevent;
            }
            final target = Uri.tryParse(navigation.url);
            if (navigation.url == 'about:blank' ||
                (target != null && KakaoTestRepository.isProviderUrl(target))) {
              return NavigationDecision.navigate;
            }
            if (mounted) {
              setState(() => error = '이동을 지원하지 않는 주소입니다. 공식 QR 화면에서 진행해 주세요.');
            }
            return NavigationDecision.prevent;
          },
          onPageFinished: (_) async {
            // 공식 결제창 전체를 현재 영역에 맞춰 표시합니다.
            try {
              await view.runJavaScript('''
                (() => {
                  const id = 'voisk-payment-viewport';
                  if (document.getElementById(id) || !document.body) return;
                  const viewport = document.createElement('div');
                  viewport.id = id;
                  viewport.style.cssText = 'position:fixed;inset:0;overflow:clip;';
                  const content = document.createElement('div');
                  content.style.cssText =
                    'position:absolute;top:8px;left:8px;width:calc(100% - 16px);transform-origin:top center;';
                  while (document.body.firstChild) {
                    content.appendChild(document.body.firstChild);
                  }
                  viewport.appendChild(content);
                  document.body.appendChild(viewport);
                  const style = document.createElement('style');
                  style.textContent = `
                    html, body {
                      height: 100% !important;
                      min-height: 0 !important;
                      overflow: hidden !important;
                      overscroll-behavior: none !important;
                      overflow-anchor: none !important;
                    }
                    body { margin: 0 !important; }
                  `;
                  document.head.appendChild(style);
                  const fit = () => {
                    const height = Math.max(content.scrollHeight, content.offsetHeight);
                    const width = Math.max(content.scrollWidth, content.offsetWidth);
                    const availableHeight = viewport.clientHeight - 16;
                    const availableWidth = viewport.clientWidth - 16;
                    if (!height || !width || availableHeight <= 0 || availableWidth <= 0) return;
                    const scale = Math.min(1, availableHeight / height, availableWidth / width);
                    content.style.transform = 'scale(' + scale + ')';
                    content.style.top =
                      Math.max(8, (viewport.clientHeight - height * scale) / 2) + 'px';
                  };
                  const observer = new ResizeObserver(fit);
                  observer.observe(content);
                  observer.observe(viewport);
                  new MutationObserver(fit).observe(content, {
                    childList: true, subtree: true, characterData: true
                  });
                  content.addEventListener('load', fit, true);
                  if (document.fonts) document.fonts.ready.then(fit);
                  window.addEventListener('resize', fit);
                  window.scrollTo(0, 0);
                  fit();
                })();
              ''');
            } catch (_) {
              // 표시 크기 조정 실패는 결제 진행을 막지 않습니다.
            }
            if (mounted) setState(() => loading = false);
          },
          onWebResourceError: (event) {
            if (event.isForMainFrame == true && mounted) {
              setState(() {
                loading = false;
                error = '결제창 연결을 확인해 주세요. 인증서를 우회하지 말고 다시 열어 주세요.';
              });
            }
          },
        ),
      );
      if (!mounted) return;
      final params = PlatformWebViewWidgetCreationParams(
        controller: view.platform,
      );
      final webView = view.platform is AndroidWebViewController
          ? WebViewWidget.fromPlatformCreationParams(
              params:
                  AndroidWebViewWidgetCreationParams.fromPlatformWebViewWidgetCreationParams(
                    params,
                    displayWithHybridComposition: true,
                  ),
            )
          : WebViewWidget(controller: view);
      // 결제 상태 확인이나 안내 갱신 시에도 동일한 네이티브 뷰를 재사용합니다.
      setState(() => nativeView = webView);
      await view.loadRequest(uri);
    } catch (_) {
      if (mounted) {
        setState(() {
          loading = false;
          error = '이 기기에서 결제창을 열지 못했습니다. 앱을 완전히 다시 실행해 주세요.';
        });
      }
    }
  }

  void accept(Map<String, dynamic> result) {
    if (!mounted || result['payment_id'] != widget.paymentId) return;
    if (result['status'] == 'ready') {
      syncRemaining(result['expires_in'] as int?);
    }
    if (result['status'] != 'ready') {
      terminal = true;
      timer?.cancel();
      final dialog = cancelDialog;
      if (dialog != null && dialog.isActive) {
        dialog.navigator?.removeRoute(dialog, false);
      }
      widget.onResult(result);
    }
  }

  Future<void> callback(String url) async {
    if (handlingCallback || terminal) return;
    handlingCallback = true;
    try {
      accept(await widget.repository.finishCallback(url, widget.paymentId));
    } catch (_) {
      if (mounted) {
        setState(() => error = '승인 응답이 지연되고 있습니다. 결제 상태를 자동으로 확인합니다.');
      }
    } finally {
      handlingCallback = false;
    }
  }

  Future<void> check() async {
    if (checking || handlingCallback || terminal || stopping || !mounted) {
      return;
    }
    checking = true;
    try {
      accept(await widget.repository.status(widget.paymentId));
      failures = 0;
      if (mounted && error == connectionDelay) {
        setState(() => error = null);
      }
    } catch (_) {
      failures++;
      if (failures >= 3 && mounted && error != connectionDelay) {
        setState(() => error = connectionDelay);
      }
    } finally {
      checking = false;
    }
  }

  Future<void> cancel() async {
    if (stopping || handlingCallback || terminal || cancelDialog != null) {
      return;
    }
    final dialog = DialogRoute<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('결제 대기를 취소할까요?'),
        content: const Text('QR 결제 대기를 종료합니다.\n장바구니의 메뉴는 그대로 유지됩니다.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('계속 결제하기'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('결제 취소하기'),
          ),
        ],
      ),
    );
    cancelDialog = dialog;
    final confirmed = await Navigator.of(context).push(dialog);
    cancelDialog = null;
    if (!mounted || terminal || confirmed != true) return;
    setState(() => stopping = true);
    try {
      accept(await widget.repository.abandon(widget.paymentId));
    } catch (_) {
      // 승인과 취소가 경합하면 서버 상태를 다시 확인합니다.
      try {
        accept(await widget.repository.status(widget.paymentId));
      } catch (_) {}
      if (mounted && !terminal) {
        setState(() => error = '취소 응답이 지연되고 있습니다. 결제 상태를 자동으로 확인합니다.');
      }
    } finally {
      if (mounted) setState(() => stopping = false);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(check());
  }

  @override
  void dispose() {
    timer?.cancel();
    countdownTimer?.cancel();
    remaining.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Expanded(
            flex: 3,
            child: Text(
              '휴대폰으로 QR을 스캔해 주세요',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            flex: 2,
            child: Align(
              alignment: Alignment.topRight,
              child: ValueListenableBuilder<int?>(
                valueListenable: remaining,
                builder: (context, seconds, _) => seconds == null
                    ? const Text(
                        '남은 시간 정보 없음 · API 서버를 재시작해 주세요.',
                        textAlign: TextAlign.right,
                        style: TextStyle(fontSize: 15),
                      )
                    : Text(
                        seconds == 0
                            ? '남은 시간 00:00 · 만료 여부 확인 중'
                            : '남은 시간 ${(seconds ~/ 60).toString().padLeft(2, '0')}:${(seconds % 60).toString().padLeft(2, '0')}',
                        key: const Key('kakaopay-countdown'),
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 4),
      const Text(
        '휴대폰 인증 후 결제창에 확인 버튼이 나오면 눌러 주세요. 승인 결과는 자동 확인합니다.',
        style: TextStyle(fontSize: 15),
      ),
      const SizedBox(height: 8),
      Expanded(
        child: ValueListenableBuilder<int?>(
          valueListenable: remaining,
          builder: (context, seconds, child) => seconds == 0
              ? const Center(
                  child: Text(
                    '결제 대기 시간이 지났습니다.\n서버에서 결제 상태를 확인하고 있습니다.',
                    textAlign: TextAlign.center,
                  ),
                )
              : child!,
          child: Stack(
            children: [
              Positioned.fill(
                child:
                    widget.webViewBuilder?.call(callback) ??
                    nativeView ??
                    const ColoredBox(color: Colors.white),
              ),
              if (loading && widget.webViewBuilder == null)
                const Center(child: CircularProgressIndicator()),
            ],
          ),
        ),
      ),
      if (error != null)
        Text(
          error!,
          style: TextStyle(
            color: Theme.of(context).colorScheme.error,
            fontSize: 15,
          ),
        ),
      const SizedBox(height: 8),
      OutlinedButton(
        onPressed: stopping ? null : cancel,
        style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
        child: Text(stopping ? '취소 확인 중…' : '결제 취소'),
      ),
    ],
  );
}
