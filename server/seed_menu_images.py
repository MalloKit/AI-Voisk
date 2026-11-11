"""시연 매장 메뉴 사진 넣기. menu_image_sources.json의 Wikimedia Commons 사진(자유 라이선스)을 받아
점주 웹 업로드와 같은 경로(menu_image_service.save_image)로 저장합니다.

    python seed_menu_images.py --preview <폴더>   # DB를 건드리지 않고 사진만 받아 확인
    python seed_menu_images.py --dry-run          # 받을 사진과 메뉴 대응만 확인(DB 읽기만)
    python seed_menu_images.py                    # 사진이 없는 메뉴에만 넣기
    python seed_menu_images.py --force            # 이미 사진이 있어도 바꾸기

- 사진은 긴 변 800px 썸네일(점주 웹이 줄이는 크기와 같음)로 받고 900KB를 넘으면 건너뜁니다.
- 파일은 server/media/menu(VOISK_MEDIA_ROOT)에 저장되며 저장소에는 올리지 않습니다. 저작자·라이선스는
  menu_image_credits.md에 남깁니다(CC BY·CC BY-SA는 표시 의무가 있습니다).
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCES = HERE / 'menu_image_sources.json'
CREDITS = HERE / 'menu_image_credits.md'
API = 'https://commons.wikimedia.org/w/api.php'
UA = 'AI-Voisk-capstone-edu/1.0 (educational kiosk demo)'
WIDTH = 800


def _get(url, tries=5):
    for attempt in range(tries):
        request = urllib.request.Request(url, headers={'User-Agent': UA})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == tries - 1:
                raise
            time.sleep(min(int(error.headers.get('Retry-After') or 0) or 10 * (attempt + 1), 60))


def _plain(value):
    return html.unescape(re.sub(r'<[^>]+>', '', value or '')).strip()


def image_info(title):
    params = {'action': 'query', 'format': 'json', 'titles': title, 'prop': 'imageinfo',
              'iiprop': 'url|mime|extmetadata', 'iiurlwidth': str(WIDTH)}
    data = json.loads(_get(API + '?' + urllib.parse.urlencode(params)))
    page = next(iter(data['query']['pages'].values()))
    if 'imageinfo' not in page:
        raise LookupError(f'Commons에 없는 파일: {title}')
    info = page['imageinfo'][0]
    meta = info.get('extmetadata', {})
    return {
        'thumb': info['thumburl'],
        'page': info.get('descriptionurl'),
        'license': _plain(meta.get('LicenseShortName', {}).get('value')) or '미상',
        'artist': _plain(meta.get('Artist', {}).get('value')) or '미상',
    }


def write_credits(rows):
    lines = ['# 시연 메뉴 사진 출처', '',
             '`seed_menu_images.py`가 넣은 사진입니다. 모두 Wikimedia Commons의 자유 라이선스 사진이며, '
             '키오스크 화면에 맞게 긴 변 800px로 줄였습니다. 교육용 시연에만 씁니다.', '',
             '| 메뉴 | 사진 | 저작자 | 라이선스 |', '|---|---|---|---|']
    for row in rows:
        title = row['file'].removeprefix('File:')
        artist = row['artist'].replace('|', '/').replace('\n', ' ')[:80]
        lines.append(f"| {row['menu']} | [{title}]({row['page']}) | {artist} | {row['license']} |")
    CREDITS.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', type=Path, help='DB 없이 사진만 이 폴더에 받기')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    sources = json.loads(SOURCES.read_text(encoding='utf-8'))
    store_id = sources['store_id']

    menus, owner_id, existing = {}, None, set()
    if not args.preview:
        import owner_portal_service as portal
        with portal.read_cursor() as cursor:
            cursor.execute('SELECT owner_id FROM store WHERE store_id = %s', (store_id,))
            owner_id = cursor.fetchone()['owner_id']
            cursor.execute('''SELECT m.menu_id, m.menu_nm, c.category_nm FROM menu m
                JOIN category c ON c.category_id = m.category_id WHERE c.store_id = %s''', (store_id,))
            menus = {(r['category_nm'], r['menu_nm']): r['menu_id'] for r in cursor.fetchall()}
            cursor.execute('''SELECT DISTINCT i.menu_id FROM menu_img i JOIN menu m ON m.menu_id = i.menu_id
                JOIN category c ON c.category_id = m.category_id WHERE c.store_id = %s''', (store_id,))
            existing = {r['menu_id'] for r in cursor.fetchall()}

    import menu_image_service as images
    credits, added, skipped = [], 0, 0
    for index, item in enumerate(sources['images'], start=1):
        menu_id = menus.get((item['category'], item['menu']))
        if not args.preview and menu_id is None:
            print(f"메뉴 없음, 건너뜀: {item['category']} / {item['menu']}")
            skipped += 1
            continue
        info = image_info(item['file'])
        credits.append({**item, **info})
        if not args.preview and menu_id in existing and not args.force:
            print(f"이미 사진 있음: {item['menu']}")
            skipped += 1
            continue
        if args.dry_run:
            print(f"받을 예정: {item['menu']} ← {item['file']} ({info['license']})")
            continue
        data = _get(info['thumb'])
        if len(data) > images.MAX_BYTES or images.detect(data) is None:
            print(f"크기·형식이 맞지 않아 건너뜀: {item['menu']} ({len(data)} bytes)")
            skipped += 1
            continue
        if args.preview:
            args.preview.mkdir(parents=True, exist_ok=True)
            (args.preview / f'{index:02d}.{images.detect(data)}').write_bytes(data)
        else:
            images.save_image(menu_id, owner_id, data)
        added += 1
        print(f"{'받음' if args.preview else '저장'}: {item['menu']} ({len(data) // 1024}KB, {info['license']})")
        time.sleep(1)
    write_credits(credits)
    print(f'완료: {added}개, 건너뜀 {skipped}개. 출처: {CREDITS.name}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
