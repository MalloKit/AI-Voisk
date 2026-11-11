import 'package:flutter/material.dart';

import '../core/l10n.dart';
import '../data/image_store.dart';
import '../domain/conversation_controller.dart';
import '../service/models/menu_item.dart';
import '../widgets/menu_image.dart';

/// 음성 주문 상태 패널. 음성으로 처리한 내용(들은 문장, 추천, 확인)을 화면에 그대로 보여 줍니다.
class VoicePanel extends StatelessWidget {
  const VoicePanel({
    super.key,
    required this.controller,
    this.images,
    this.onStaffCalled,
  });
  final ConversationController controller;
  final ImageStore? images;
  final void Function(bool ok)? onStaffCalled;

  static String stateLabel(ConversationState state) => switch (state) {
    ConversationState.idle => tr('대기 중'),
    ConversationState.preparing => tr('준비 중'),
    ConversationState.listening => tr('듣고 있어요'),
    ConversationState.thinking => tr('알아보는 중'),
    ConversationState.recommending => tr('추천 메뉴'),
    ConversationState.confirming => tr('확인해 주세요'),
    ConversationState.choosingOption => tr('옵션을 골라 주세요'),
    ConversationState.upsell => tr('함께 드시겠어요?'),
    ConversationState.checkout => tr('결제 안내'),
    ConversationState.error => tr('도움이 필요하신가요?'),
  };

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final c = controller;
      final listening =
          c.state == ConversationState.listening ||
          (c.state == ConversationState.recommending ||
                  c.state == ConversationState.confirming ||
                  c.state == ConversationState.choosingOption ||
                  c.state == ConversationState.upsell) &&
              c.partial.isNotEmpty;
      final quote = c.partial.isNotEmpty ? c.partial : c.heard;
      return Material(
        key: const Key('voice-panel'),
        elevation: 16,
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 18, 24, 14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  _MicBadge(
                    active: listening,
                    level: c.level,
                    thinking: c.state == ConversationState.thinking,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      stateLabel(c.state),
                      key: const Key('voice-state'),
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF153E39),
                      ),
                    ),
                  ),
                  if (c.senior)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Chip(label: Text(tr('천천히 모드'))),
                    ),
                  OutlinedButton.icon(
                    onPressed: () => c.stop(),
                    icon: const Icon(Icons.close),
                    label: Text(tr('음성 주문 끝내기')),
                  ),
                ],
              ),
              if (quote.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  '“$quote”',
                  key: const Key('voice-heard'),
                  style: TextStyle(
                    fontSize: c.senior ? 24 : 20,
                    color: c.partial.isNotEmpty
                        ? const Color(0xFF6B7C76)
                        : const Color(0xFF26332F),
                  ),
                ),
              ],
              if (c.message.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  c.message,
                  key: const Key('voice-message'),
                  style: TextStyle(
                    fontSize: c.senior ? 26 : 21,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF246B58),
                  ),
                ),
              ],
              if (c.state == ConversationState.choosingOption &&
                  c.optionChoices.isNotEmpty) ...[
                const SizedBox(height: 14),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    for (final option in c.optionChoices)
                      FilledButton.tonal(
                        key: Key('voice-option-${option.id}'),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(140, 60),
                        ),
                        onPressed: () => c.chooseOption(option),
                        child: Text(
                          option.price > 0
                              ? '${option.name} +${formatWon(option.price)}'
                              : option.name,
                          style: const TextStyle(fontSize: 22),
                        ),
                      ),
                  ],
                ),
              ],
              if (c.recommendations.isNotEmpty &&
                  c.state != ConversationState.confirming &&
                  c.state != ConversationState.choosingOption) ...[
                const SizedBox(height: 14),
                SizedBox(
                  height: c.senior ? 250 : 220,
                  child: Row(
                    children: [
                      for (var i = 0; i < c.recommendations.length; i++)
                        Expanded(
                          child: Padding(
                            padding: EdgeInsets.only(left: i == 0 ? 0 : 10),
                            child: _RecommendationCard(
                              key: Key('rec-card-$i'),
                              rank: i + 1,
                              menu: c.recommendations[i].menu,
                              reason: c.recommendations[i].reason,
                              images: images,
                              onPressed: () => c.selectRecommendation(i),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
              if (c.state == ConversationState.confirming ||
                  c.state == ConversationState.upsell) ...[
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton(
                        key: const Key('voice-yes'),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 60),
                        ),
                        onPressed: () => c.handleText('네'),
                        child: Text(
                          tr('네'),
                          style: const TextStyle(fontSize: 22),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('voice-no'),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 60),
                        ),
                        onPressed: () => c.handleText('아니요'),
                        child: Text(
                          tr('아니요'),
                          style: const TextStyle(fontSize: 22),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              if (c.offerStaffCall) ...[
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        key: const Key('voice-staff-call'),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 60),
                        ),
                        onPressed: () async =>
                            onStaffCalled?.call(await c.callStaff()),
                        icon: const Icon(Icons.support_agent),
                        label: Text(
                          tr('직원 호출'),
                          style: const TextStyle(fontSize: 20),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 60),
                        ),
                        onPressed: () => c.stop(),
                        icon: const Icon(Icons.touch_app_outlined),
                        label: Text(
                          tr('화면으로 주문하기'),
                          style: const TextStyle(fontSize: 20),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 10),
              Text(
                tr('버튼을 누른 뒤의 음성만 처리하며 녹음·저장하지 않습니다.'),
                key: const Key('voice-privacy'),
                style: const TextStyle(fontSize: 13, color: Color(0xFF6B7C76)),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class _MicBadge extends StatelessWidget {
  const _MicBadge({
    required this.active,
    required this.level,
    required this.thinking,
  });
  final bool active;
  final double level;
  final bool thinking;

  @override
  Widget build(BuildContext context) {
    // 안드로이드 RMS(dB)는 대략 -2~10 범위입니다. 듣는 중에는 소리 크기에 맞춰 원이 커집니다.
    final grow = active ? ((level + 2) / 12).clamp(0.0, 1.0) * 14 : 0.0;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      width: 54 + grow,
      height: 54 + grow,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: active ? const Color(0xFFD94F3D) : const Color(0xFFE5ECE8),
      ),
      child: thinking
          ? const Padding(
              padding: EdgeInsets.all(14),
              child: CircularProgressIndicator(strokeWidth: 3),
            )
          : Icon(
              active ? Icons.mic : Icons.mic_none,
              color: active ? Colors.white : const Color(0xFF246B58),
              size: 30,
            ),
    );
  }
}

class _RecommendationCard extends StatelessWidget {
  const _RecommendationCard({
    super.key,
    required this.rank,
    required this.menu,
    required this.reason,
    required this.images,
    required this.onPressed,
  });
  final int rank;
  final MenuItem menu;
  final String reason;
  final ImageStore? images;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Card(
    margin: EdgeInsets.zero,
    color: rank == 1 ? const Color(0xFFEAF6F0) : Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(16),
      side: BorderSide(
        color: rank == 1 ? const Color(0xFF246B58) : const Color(0xFFCBDAD2),
        width: rank == 1 ? 2 : 1,
      ),
    ),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onPressed,
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          children: [
            Expanded(
              child: Center(
                child: MenuImage(menu: menu, store: images, size: 64),
              ),
            ),
            Text(
              menu.name,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 19, fontWeight: FontWeight.bold),
            ),
            Text(
              formatWon(menu.price),
              style: const TextStyle(fontSize: 16, color: Color(0xFF246B58)),
            ),
            if (reason.isNotEmpty)
              Text(
                reason,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14, color: Color(0xFF4A5A55)),
              ),
            const SizedBox(height: 4),
            Text(
              tr('눌러서 담기'),
              style: const TextStyle(fontSize: 13, color: Color(0xFF246B58)),
            ),
          ],
        ),
      ),
    ),
  );
}
