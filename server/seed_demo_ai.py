"""시연 매장 메뉴 보강과 AI 추천 정보 입력. 여러 번 실행해도 같은 결과입니다.

- 기존 메뉴의 이름·가격·설명·품절·판매 상태는 바꾸지 않습니다. 비어 있는 원가율·태그·동의어만 채웁니다.
- 같은 카테고리에 같은 이름의 메뉴가 없을 때만 새 메뉴를 추가합니다.
- 바뀐 것이 있으면 매장 기기의 메뉴 버전을 올려 키오스크가 다시 받게 합니다.

사용법 (server 폴더에서): .venv/Scripts/python.exe seed_demo_ai.py [--store 1] [--dry-run]
"""
import argparse
import sys

# 상황 태그 체계(구상안 "메뉴 상황 태그 체계 확정"): 상황·취향을 짧은 명사로 통일합니다.
TAGS = ('해장', '든든한', '가벼운', '매운', '안매운', '국물', '따뜻한', '시원한', '고기', '해산물', '채소',
        '건강한', '다이어트', '아이와함께', '나눠먹기', '간식', '달콤한', '바삭한', '혼밥', '보양', '음료', '커피',
        '탄산', '디저트', '세트', '담백한', '부드러운', '고단백')

# (카테고리, 이름, 가격, 설명, 원가율, 태그, 동의어, 매장 우선, 추천 제외, 옵션[(이름, 추가 금액)])
MENUS = [
    ('식사', '제육덮밥2', None, None, 35, ['든든한', '매운', '고기', '혼밥'], ['제육덮밥', '제육', '제육볶음'], False, False, []),
    ('식사', '비빔밥', None, None, 30, ['든든한', '채소', '건강한'], ['비빔'], False, False, []),
    ('식사', '김치볶음밥', 8000, '잘 익은 김치와 계란 프라이를 올린 볶음밥', 25, ['든든한', '매운', '혼밥'], ['김볶', '김볶밥'], False, False,
     [('계란 추가', 1000), ('치즈 추가', 1000)]),
    ('식사', '돈가스', 9500, '바삭한 등심 돈가스와 달콤한 소스', 38, ['든든한', '아이와함께', '안매운', '고기', '바삭한'], ['돈까스', '까스'], False, False,
     [('밥 추가', 1000)]),
    ('식사', '오므라이스', 8500, '부드러운 달걀로 감싼 케첩 볶음밥', 28, ['아이와함께', '안매운', '부드러운'], ['오므'], False, False, []),
    ('식사', '카레라이스', 8000, '감자·당근이 듬뿍 들어간 순한 카레', 24, ['아이와함께', '안매운', '든든한'], ['카레'], False, False, []),
    ('국물', '순두부찌개', None, None, 30, ['해장', '매운', '국물', '따뜻한'], ['순두부'], False, False, []),
    ('국물', '콩나물국밥', None, None, 25, ['해장', '국물', '시원한', '안매운'], ['콩나물', '국밥'], False, False, []),
    ('국물', '북엇국', 8000, '속을 풀어 주는 담백한 북엇국', 27, ['해장', '국물', '담백한', '안매운', '따뜻한'], ['북어국', '황태국'], False, False,
     [('공깃밥 추가', 1000)]),
    ('국물', '된장찌개', 8000, '구수한 된장에 두부와 애호박을 넣은 찌개', 22, ['국물', '따뜻한', '든든한', '안매운'], ['된장'], False, False,
     [('공깃밥 추가', 1000)]),
    ('국물', '김치찌개', 9000, '돼지고기와 묵은지로 끓인 얼큰한 찌개', 30, ['국물', '매운', '해장', '따뜻한', '고기'], ['김찌'], False, False,
     [('공깃밥 추가', 1000), ('라면사리 추가', 1000)]),
    ('국물', '갈비탕', 13000, '푸짐한 소갈비가 들어간 맑은 탕', 45, ['국물', '든든한', '고기', '보양', '따뜻한'], ['갈비'], True, False, []),
    ('사이드', '만두', None, None, 30, ['간식', '나눠먹기', '아이와함께'], ['군만두'], False, False, []),
    ('사이드', '계란말이', 5000, '도톰하게 부친 부드러운 계란말이', 20, ['아이와함께', '안매운', '나눠먹기', '부드러운'], [], False, False, []),
    ('사이드', '공깃밥', 1000, '갓 지은 흰쌀밥 한 공기', 15, [], ['밥', '공기밥'], False, True, []),
    ('음료', '콜라', None, None, 30, ['음료', '시원한', '탄산'], ['코카콜라', '코크'], False, False, []),
    ('음료', '사이다', None, None, 30, ['음료', '시원한', '탄산'], ['칠성사이다'], False, False, []),
    ('음료', '제로콜라', 2000, '칼로리 부담을 줄인 제로 콜라', 30, ['음료', '시원한', '탄산', '다이어트'], ['제로', '콜라 제로'], False, False, []),
    ('음료', '아이스 아메리카노', 3000, '산뜻한 원두로 내린 아이스 아메리카노', 18, ['음료', '시원한', '커피', '다이어트'], ['아아', '아이스커피'], False, False,
     [('샷 추가', 500)]),
    ('음료', '따뜻한 아메리카노', 3000, '진하게 내린 따뜻한 아메리카노', 18, ['음료', '따뜻한', '커피'], ['뜨아', '핫 아메리카노'], False, False,
     [('샷 추가', 500)]),
    ('음료', '식혜', 2500, '달콤하고 시원한 전통 식혜', 25, ['음료', '시원한', '달콤한', '해장'], [], False, False, []),
    ('음료', '아이스티', 2500, '복숭아 향 아이스티', 20, ['음료', '달콤한', '시원한', '아이와함께'], ['복숭아 아이스티'], False, False, []),
    ('면류', '잔치국수', None, None, 22, ['국물', '가벼운', '안매운', '따뜻한'], ['국수'], False, False, []),
    ('면류', '비빔국수', 7000, '새콤달콤하고 매콤한 비빔국수', 22, ['매운', '가벼운', '시원한'], ['비국'], False, False, [('곱빼기', 2000)]),
    ('면류', '냉면', 9000, '살얼음이 동동 뜬 시원한 물냉면', 30, ['시원한', '해장', '가벼운', '국물'], ['물냉면', '물냉'], False, False,
     [('곱빼기', 2000)]),
    ('구이', '불고기', None, None, 42, ['고기', '달콤한', '아이와함께', '든든한', '나눠먹기'], ['소불고기'], False, False, []),
    ('구이', '고등어구이', 11000, '노릇하게 구운 고등어 한 마리', 40, ['해산물', '든든한', '건강한'], ['고등어'], False, False, []),
    ('튀김', '새우튀김', None, None, 35, ['해산물', '바삭한', '나눠먹기', '간식'], ['새튀'], False, False, []),
    ('튀김', '치킨너겟', 5000, '한입 크기 바삭한 치킨너겟', 30, ['아이와함께', '간식', '바삭한', '안매운'], ['너겟'], False, False, []),
    ('분식', '떡볶이', None, None, 20, ['매운', '간식', '나눠먹기'], ['떡볶기', '떡뽁이'], False, False, []),
    ('분식', '김밥', 4000, '속이 꽉 찬 기본 김밥 한 줄', 25, ['가벼운', '간식', '아이와함께', '안매운'], ['김밥 한 줄'], False, False, []),
    ('분식', '라면', 5000, '계란을 풀어 넣은 얼큰한 라면', 18, ['매운', '국물', '해장', '따뜻한'], [], False, False,
     [('치즈 추가', 1000), ('공깃밥 추가', 1000)]),
    ('샐러드', '채소 샐러드', None, None, 30, ['다이어트', '가벼운', '채소', '건강한'], ['샐러드', '야채 샐러드'], False, False, []),
    ('샐러드', '닭가슴살 샐러드', 8500, '단백질 가득 닭가슴살을 올린 샐러드', 35, ['다이어트', '가벼운', '고단백', '건강한'], ['닭샐'], True, False, []),
    ('디저트', '바닐라 아이스크림', None, None, 25, ['디저트', '달콤한', '시원한', '아이와함께'], ['아이스크림'], False, False, []),
    ('디저트', '팥빙수', 7000, '우유 얼음 위에 팥과 떡을 올린 빙수', 28, ['디저트', '시원한', '달콤한', '나눠먹기'], ['빙수'], False, False, []),
    ('디저트', '호떡', 2500, '꿀이 가득한 따끈한 호떡', 25, ['디저트', '달콤한', '따뜻한', '간식'], [], False, False, []),
    ('세트', '덮밥 세트', None, None, 33, ['든든한', '세트', '혼밥'], ['덮밥세트'], False, False, []),
    ('세트', '분식 세트', 9500, '떡볶이, 김밥, 튀김을 함께 즐기는 세트', 26, ['세트', '나눠먹기', '간식', '매운'], [], False, False, []),
    ('세트', '어린이 세트', 8000, '돈가스, 주먹밥, 아이스티 구성', 30, ['아이와함께', '세트', '안매운'], ['키즈 세트'], False, False, []),
]


def seed(cursor, store_id):
    changes = {'menus_added': 0, 'options_added': 0, 'ai_filled': 0, 'tags_added': 0, 'synonyms_added': 0}
    cursor.execute('SELECT category_id, category_nm FROM category WHERE store_id = %s', (store_id,))
    categories = {row['category_nm']: row['category_id'] for row in cursor.fetchall()}
    for category, name, price, description, cost, tags, synonyms, pick, excluded, options in MENUS:
        assert all(tag in TAGS for tag in tags), name
        if category not in categories:
            raise RuntimeError(f'카테고리 없음: {category}')
        category_id = categories[category]
        cursor.execute('SELECT menu_id, cost_rate FROM menu WHERE category_id = %s AND menu_nm = %s', (category_id, name))
        row = cursor.fetchone()
        if row is None:
            if price is None:
                raise RuntimeError(f'기존 메뉴가 없음: {name}')
            cursor.execute('SELECT COALESCE(MAX(menu_sort), 0) + 1 AS next_sort FROM menu WHERE category_id = %s', (category_id,))
            sort = cursor.fetchone()['next_sort']
            cursor.execute('''INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort,
                cost_rate, is_rec_excluded, is_store_pick) VALUES (%s, %s, %s, %s, 1, 0, %s, %s, %s, %s)''',
                           (category_id, name, price, description, sort, cost, excluded, pick))
            menu_id = cursor.lastrowid
            changes['menus_added'] += 1
            for index, (option_name, extra) in enumerate(options, start=1):
                cursor.execute('''INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, is_active, is_sold_out, extra_price)
                    VALUES (%s, %s, %s, 1, 0, %s)''', (menu_id, option_name, index, extra))
                changes['options_added'] += 1
        else:
            menu_id = row['menu_id']
            if row['cost_rate'] is None:
                cursor.execute('UPDATE menu SET cost_rate = %s, is_rec_excluded = %s, is_store_pick = %s WHERE menu_id = %s',
                               (cost, excluded, pick, menu_id))
                changes['ai_filled'] += 1
        for table, column, values, key in (('menu_tag', 'tag_nm', tags, 'tags_added'),
                                           ('menu_synonym', 'synonym_nm', synonyms, 'synonyms_added')):
            cursor.execute(f'SELECT COUNT(*) AS n FROM {table} WHERE menu_id = %s', (menu_id,))
            if cursor.fetchone()['n']:
                continue
            for value in values:
                cursor.execute(f'INSERT INTO {table} (menu_id, {column}) VALUES (%s, %s)', (menu_id, value))
                changes[key] += 1
    if any(changes.values()):
        cursor.execute('UPDATE kiosk_device SET current_menu_version = current_menu_version + 1 WHERE store_id = %s', (store_id,))
    return changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--store', type=int, default=1)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    from database import connect
    connection = connect()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION')
            # 주문·메뉴판 저장과 같은 잠금 순서(기기 → 메뉴)를 따릅니다.
            cursor.execute('SELECT device_id FROM kiosk_device WHERE store_id = %s FOR UPDATE', (args.store,))
            changes = seed(cursor, args.store)
            cursor.execute('''SELECT COUNT(*) AS n FROM menu m JOIN category c ON c.category_id = m.category_id
                WHERE c.store_id = %s AND m.is_active = TRUE''', (args.store,))
            total = cursor.fetchone()['n']
        if args.dry_run:
            connection.rollback()
        else:
            connection.commit()
        print(('미리보기(저장 안 함): ' if args.dry_run else '저장 완료: ') + ', '.join(f'{k}={v}' for k, v in changes.items()))
        print(f'판매 중인 메뉴: {total}개')
        return 0
    except Exception as error:
        connection.rollback()
        code = error.args[0] if error.args and isinstance(error.args[0], int) else '-'
        print(f'실패: {type(error).__name__} ({code}) {error if isinstance(error, (RuntimeError, AssertionError)) else ""}',
              file=sys.stderr)
        return 1
    finally:
        connection.close()


if __name__ == '__main__':
    sys.exit(main())
