"""음성 상황 추천 시나리오 평가(실제 Claude API 호출, 공용 DB는 읽기만).

손님 발화마다 '괜찮은 메뉴'와 '나오면 안 되는 메뉴'를 정해 두고, 키오스크가 실제로 보여 주는
상위 3개(서버 해석 → 키오스크 정책 순위)가 맞는지 봅니다. 비용이 드니 필요할 때만 실행합니다.

실행: .venv/Scripts/python.exe -I -X utf8 tools/voice_recommend_eval.py [반복횟수] [매장ID]
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_db  # noqa: E402
import kiosk_catalog  # noqa: E402
import voice_service  # noqa: E402

SOUPS = {'순두부찌개', '콩나물국밥', '북엇국', '된장찌개', '김치찌개', '갈비탕', '라면', '잔치국수'}
SWEETS = {'팥빙수', '바닐라 아이스크림', '호떡', '식혜', '아이스티', '불고기'}
DESSERT_DRINK = {'팥빙수', '바닐라 아이스크림', '호떡', '식혜', '아이스티', '콜라', '제로콜라',
                 '아이스 아메리카노', '따뜻한 아메리카노'}
SPICY = {'제육덮밥', '김치볶음밥', '순두부찌개', '김치찌개', '비빔국수', '떡볶이', '라면', '분식 세트'}

# (발화, 괜찮은 메뉴, 상위 3개에 나오면 안 되는 메뉴)
SCENARIOS = [
    ('어제 술 먹었는데 해장 메뉴 추천해줘.', {'콩나물국밥', '북엇국', '순두부찌개', '김치찌개', '라면', '냉면', '식혜', '된장찌개', '갈비탕'},
     DESSERT_DRINK - {'식혜'} | {'치킨너겟', '돈가스', '새우튀김'}),
    ('달달한게 땡기는데 달달한 거 없나?', SWEETS, SOUPS | SPICY),
    ('지금 술 안주로 먹을만한 베스트 추천해줘', {'계란말이', '만두', '새우튀김', '치킨너겟', '떡볶이', '고등어구이', '불고기',
                                       '김치찌개', '순두부찌개', '분식 세트', '갈비탕', '된장찌개'},
     DESSERT_DRINK | {'어린이 세트', '공깃밥', '채소 샐러드', '닭가슴살 샐러드'}),
    ('아이랑 같이 먹을 건데 안 매운 걸로 추천해 주세요', {'돈가스', '오므라이스', '카레라이스', '계란말이', '어린이 세트', '치킨너겟',
                                          '김밥', '바닐라 아이스크림', '불고기', '만두', '아이스티', '잔치국수', '콩나물국밥', '북엇국', '된장찌개'},
     SPICY),
    ('다이어트 중이라 가볍게 먹고 싶어요', {'채소 샐러드', '닭가슴살 샐러드', '제로콜라', '아이스 아메리카노', '잔치국수', '비빔국수',
                                 '냉면', '김밥', '고등어구이', '비빔밥'},
     {'돈가스', '갈비탕', '팥빙수', '치킨너겟', '새우튀김', '호떡', '덮밥 세트', '분식 세트', '콜라'}),
    ('날이 추워서 뜨끈한 국물 땡기네', SOUPS, {'냉면', '팥빙수', '바닐라 아이스크림', '아이스 아메리카노', '채소 샐러드', '비빔국수'}),
    ('더워 죽겠는데 시원한 거 뭐 있어요?', {'냉면', '팥빙수', '바닐라 아이스크림', '아이스 아메리카노', '아이스티', '콜라', '제로콜라',
                                   '비빔국수', '식혜', '콩나물국밥'},
     SOUPS - {'콩나물국밥'} | {'따뜻한 아메리카노', '호떡'}),
    ('매운 거 잘 먹어요. 제일 매운 걸로 추천해 줘', SPICY, {'바닐라 아이스크림', '계란말이', '어린이 세트', '오므라이스', '돈가스', '카레라이스'}),
    ('밥 말고 면 요리 뭐 있어요?', {'잔치국수', '비빔국수', '냉면', '라면'}, {'제육덮밥', '비빔밥', '김치볶음밥', '콩나물국밥', '덮밥 세트'}),
    ('배고파 죽겠어 든든한 걸로 추천', {'갈비탕', '돈가스', '제육덮밥', '덮밥 세트', '불고기', '비빔밥', '카레라이스', '김치볶음밥',
                                 '고등어구이', '된장찌개', '오므라이스', '분식 세트'},
     DESSERT_DRINK | {'채소 샐러드', '닭가슴살 샐러드', '김밥', '만두'}),
    ('혼자 왔는데 간단하게 먹을 만한 거', {'제육덮밥', '김치볶음밥', '덮밥 세트', '김밥', '라면', '비빔밥', '카레라이스', '오므라이스',
                                  '잔치국수', '비빔국수', '돈가스', '채소 샐러드', '닭가슴살 샐러드'},
     {'팥빙수', '분식 세트', '불고기', '갈비탕'}),
    ('커피 말고 시원한 음료 추천해 줘', {'콜라', '제로콜라', '식혜', '아이스티'}, {'아이스 아메리카노', '따뜻한 아메리카노'} | SOUPS),
    # 뺀 것을 지키는지
    ('해장하고 싶은데 매운 건 말고요', {'콩나물국밥', '북엇국', '된장찌개', '냉면', '식혜', '갈비탕', '잔치국수'},
     SPICY | DESSERT_DRINK - {'식혜'}),
    ('고기 빼고 든든한 거 추천해 줘', {'비빔밥', '김치볶음밥', '카레라이스', '오므라이스', '된장찌개', '고등어구이', '비빔밥',
                                 '순두부찌개', '콩나물국밥', '북엇국', '잔치국수', '분식 세트', '김밥', '라면', '냉면'},
     {'제육덮밥', '돈가스', '갈비탕', '불고기', '김치찌개', '덮밥 세트', '치킨너겟'}),
    ('탄산 말고 마실 거 뭐 있어요?', {'식혜', '아이스티', '아이스 아메리카노', '따뜻한 아메리카노'}, {'콜라', '제로콜라', '사이다'}),
]


def kiosk_top3(recommendations, menus, settings):
    """키오스크 RecommendationEngine.rank와 같은 순서(적합도 기준선 → 적합도·이익·매장 우선 가중합)."""
    rates = [m['costRate'] for m in menus.values() if m.get('costRate') is not None]
    low, high = (min(rates), max(rates)) if rates else (0, 0)

    def profit(menu):
        if menu.get('costRate') is None:
            return 50.0
        return 50.0 if high == low else (high - menu['costRate']) / (high - low) * 100

    w_profit = min(max(settings.get('policy_profit', 0), 0), 100) / 100 * 0.5
    w_pick = min(max(settings.get('pick_weight', 0), 0), 100) / 100 * 0.3
    w_fit = 1 - w_profit - w_pick
    ranked = []
    for rec in recommendations:
        menu = menus.get(rec['menu_id'])
        if menu is None or rec['fit'] < settings.get('fit_threshold', 0):
            continue
        score = rec['fit'] * w_fit + profit(menu) * w_profit + (100 if menu['storePick'] else 0) * w_pick
        ranked.append((score, rec['fit'], menu['name']))
    ranked.sort(key=lambda row: (-row[0], -row[1]))
    return [name for _, _, name in ranked[:3]]


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    store_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    with ai_db.read_cursor() as cursor:
        catalog = kiosk_catalog.read_catalog(cursor, store_id)
    menus = {int(m['id']): m for m in catalog['menus']}
    passed, total, times = 0, 0, []
    for round_no in range(1, rounds + 1):
        print(f'== {round_no}회차')
        for text, good, bad in SCENARIOS:
            started = time.monotonic()
            result = voice_service.interpret(catalog, voice_service.InterpretInput(text=text))
            times.append(time.monotonic() - started)
            top = kiosk_top3(result['recommendations'], menus, catalog['settings'])
            wrong = [name for name in top if name in bad]
            odd = [name for name in top if name not in good and name not in bad]
            # 카드가 3개보다 적어도 맞는 메뉴만 보여 주면 통과입니다(적은 개수는 따로 표시).
            ok = result['intent'] == 'recommend' and len(top) >= 1 and not wrong
            passed += ok
            total += 1
            model = [menus[r['menu_id']]['name'] + f"({r['fit']})" for r in result['recommendations']]
            short = f'  ({len(top)}개)' if len(top) < 3 else ''
            print(f"{'OK  ' if ok else 'FAIL'} {times[-1]:4.1f}s {text}\n     화면 상위3 {top}{short}"
                  f"{'  ✗나오면 안 됨 ' + str(wrong) if wrong else ''}{'  ?애매 ' + str(odd) if odd else ''}"
                  f"\n     모델 {result['intent']} {model} 태그 {result['situation']}")
    times.sort()
    print(f'\n통과 {passed}/{total}, 응답 중앙값 {times[len(times) // 2]:.1f}s, 최대 {times[-1]:.1f}s')


if __name__ == '__main__':
    main()
