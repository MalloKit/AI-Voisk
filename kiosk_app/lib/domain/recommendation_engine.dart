import '../service/models/menu_item.dart';
import 'catalog.dart';

/// 서버(Claude Haiku)가 준 적합도 후보.
class RecommendationCandidate {
  const RecommendationCandidate({
    required this.menuId,
    required this.fit,
    this.reason = '',
  });
  final String menuId;
  final int fit;
  final String reason;
}

class RankedRecommendation {
  const RankedRecommendation({
    required this.menu,
    required this.fit,
    required this.profit,
    required this.pick,
    required this.score,
    required this.reason,
  });
  final MenuItem menu;
  final int fit;
  final double profit;
  final double pick;
  final double score;
  final String reason;
}

/// 정책 가중치. 슬라이더(policy_profit)가 이익 비중을, pick_weight가 매장 우선 비중을 정합니다.
class PolicyWeights {
  const PolicyWeights(this.fit, this.profit, this.pick);
  final double fit;
  final double profit;
  final double pick;

  factory PolicyWeights.from(StoreAiSettings settings) {
    final profit = settings.policyProfit.clamp(0, 100) / 100 * 0.5;
    final pick = settings.pickWeight.clamp(0, 100) / 100 * 0.3;
    return PolicyWeights(1 - profit - pick, profit, pick);
  }
}

/// 추천 엔진(Pipeline). 각 단계는 결정론적이며 AI는 적합도 판단에만 쓰입니다.
///
/// 1. 후보 필터: 품절·추천 제외·매장에 없는 메뉴 제거
/// 2. 적합도 기준선: fit < 기준선이면 이익이 높아도 제외
/// 3. 점수: fit × w1 + 이익 점수 × w2 + 매장 우선 × w3
/// 4. 정렬 후 상위 [limit]개
class RecommendationEngine {
  const RecommendationEngine();

  List<RankedRecommendation> rank(
    List<RecommendationCandidate> candidates,
    List<MenuItem> menus,
    StoreAiSettings settings, {
    int limit = 3,
  }) {
    final byId = {for (final menu in menus) menu.id: menu};
    final profits = profitScores(menus);
    final weights = PolicyWeights.from(settings);
    final seen = <String>{};
    final ranked = <RankedRecommendation>[];
    for (final candidate in candidates) {
      final menu = byId[candidate.menuId];
      if (menu == null ||
          menu.isSoldOut ||
          menu.recExcluded ||
          !seen.add(menu.id)) {
        continue;
      }
      final fit = candidate.fit.clamp(0, 100);
      if (fit < settings.fitThreshold) continue;
      final profit = profits[menu.id] ?? 50;
      final pick = menu.storePick ? 100.0 : 0.0;
      ranked.add(
        RankedRecommendation(
          menu: menu,
          fit: fit,
          profit: profit,
          pick: pick,
          score:
              fit * weights.fit + profit * weights.profit + pick * weights.pick,
          reason: candidate.reason,
        ),
      );
    }
    ranked.sort((a, b) {
      final byScore = b.score.compareTo(a.score);
      return byScore != 0 ? byScore : b.fit.compareTo(a.fit);
    });
    return ranked.take(limit).toList();
  }

  /// 매장 메뉴의 원가율을 0~100 이익 점수로 정규화합니다. 원가율이 낮을수록 높고, 모르면 50입니다.
  Map<String, double> profitScores(List<MenuItem> menus) {
    final rates = menus
        .where((m) => m.costRate != null)
        .map((m) => m.costRate!)
        .toList();
    if (rates.isEmpty) return {};
    final low = rates.reduce((a, b) => a < b ? a : b);
    final high = rates.reduce((a, b) => a > b ? a : b);
    return {
      for (final menu in menus)
        if (menu.costRate != null)
          menu.id: high == low
              ? 50.0
              : (high - menu.costRate!) / (high - low) * 100,
    };
  }

  /// 추천 결과가 없을 때 보여 줄 메뉴: 매장 우선 → 이익 점수 순.
  List<MenuItem> fallback(List<MenuItem> menus, {int limit = 3}) {
    final profits = profitScores(menus);
    final available =
        menus.where((m) => !m.isSoldOut && !m.recExcluded).toList()
          ..sort((a, b) {
            if (a.storePick != b.storePick) return a.storePick ? -1 : 1;
            return (profits[b.id] ?? 50).compareTo(profits[a.id] ?? 50);
          });
    return available.take(limit).toList();
  }

  /// 주문당 1회 추가 제안 후보: 장바구니에 없는 음료·사이드·디저트 중 정책 점수가 가장 높은 메뉴.
  MenuItem? upsell(
    List<MenuItem> menus,
    Set<String> inCart,
    StoreAiSettings settings,
  ) {
    const categories = {'음료', '사이드', '디저트'};
    final cartCategories = menus
        .where((m) => inCart.contains(m.id))
        .map((m) => m.category)
        .toSet();
    final profits = profitScores(menus);
    final weights = PolicyWeights.from(settings);
    MenuItem? best;
    var bestScore = double.negativeInfinity;
    for (final menu in menus) {
      if (!categories.contains(menu.category) ||
          cartCategories.contains(menu.category)) {
        continue;
      }
      if (menu.isSoldOut || menu.recExcluded || inCart.contains(menu.id)) {
        continue;
      }
      // 추가 제안에는 상황 적합도가 없으므로 이익·매장 우선만 비교합니다.
      final score =
          (profits[menu.id] ?? 50) * (weights.profit + 0.1) +
          (menu.storePick ? 100 : 0) * weights.pick;
      if (score > bestScore) {
        best = menu;
        bestScore = score;
      }
    }
    return best;
  }
}
