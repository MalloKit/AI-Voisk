"""메뉴 사진. 점주가 올린 이미지를 서버 디스크(server/media/menu)에 저장하고 menu_img에 대표 사진으로 기록합니다.

- 본문은 이미지 바이트 그대로(Content-Type: image/jpeg|png|webp). 점주 웹이 업로드 전에 크기를 줄입니다.
- 형식은 Content-Type이 아니라 파일 시그니처로 판정합니다.
- 파일 이름은 내용 해시를 포함하므로 키오스크는 이름이 바뀐 사진만 다시 받습니다.
"""
import hashlib
import os
from pathlib import Path

from fastapi import HTTPException

import owner_portal_service as portal
import sync_hub

MAX_BYTES = 900 * 1024
MEDIA_ROOT = Path(os.getenv('VOISK_MEDIA_ROOT') or Path(__file__).with_name('media'))
MENU_DIR = 'menu'


def detect(data):
    if data.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if len(data) > 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    return None


def image_url(file_name):
    return f'/media/{MENU_DIR}/{file_name}' if file_name else None


def _owned_menu(cursor, menu_id, owner_id):
    cursor.execute('''SELECT m.menu_id, c.store_id FROM menu m JOIN category c ON c.category_id = m.category_id
        JOIN store s ON s.store_id = c.store_id WHERE m.menu_id = %s AND s.owner_id = %s FOR UPDATE''', (menu_id, owner_id))
    row = cursor.fetchone()
    if row is None:
        raise portal.OwnerResourceNotFound()
    return row


def owned_store(menu_id, owner_id):
    """점주의 메뉴면 매장 번호. 잠그지 않는 확인입니다."""
    with portal.read_cursor() as cursor:
        cursor.execute('''SELECT c.store_id FROM menu m JOIN category c ON c.category_id = m.category_id
            JOIN store s ON s.store_id = c.store_id WHERE m.menu_id = %s AND s.owner_id = %s''', (menu_id, owner_id))
        row = cursor.fetchone()
    if row is None:
        raise portal.OwnerResourceNotFound()
    return row['store_id']


def _replace(menu_id, owner_id, new_name, store_id):
    """menu_img 행을 바꾸고 이전 파일 이름 목록을 돌려줍니다. 파일 삭제는 커밋 뒤에 합니다."""
    connection = portal.connection_factory()
    try:
        with connection.cursor() as cursor:
            cursor.execute('START TRANSACTION')
            # 잠금 순서: 기기 → 메뉴(주문·메뉴판 저장과 같음)
            cursor.execute('SELECT device_id FROM kiosk_device WHERE store_id = %s ORDER BY device_id FOR UPDATE',
                           (store_id,))
            cursor.fetchall()
            row = _owned_menu(cursor, menu_id, owner_id)
            cursor.execute('SELECT img_nm FROM menu_img WHERE menu_id = %s', (menu_id,))
            old = [r['img_nm'] for r in cursor.fetchall()]
            cursor.execute('DELETE FROM menu_img WHERE menu_id = %s', (menu_id,))
            if new_name:
                cursor.execute('INSERT INTO menu_img (menu_id, img_nm, is_main) VALUES (%s, %s, 1)', (menu_id, new_name))
            cursor.execute('UPDATE kiosk_device SET current_menu_version = current_menu_version + 1 WHERE store_id = %s',
                           (row['store_id'],))
        connection.commit()
        return row['store_id'], [name for name in old if name != new_name]
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _remove_files(names):
    folder = MEDIA_ROOT / MENU_DIR
    for name in names:
        # DB 값이 경로를 벗어나지 못하게 이름만 사용합니다.
        target = folder / Path(name).name
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass


def save_image(menu_id, owner_id, data):
    if not data:
        raise HTTPException(422, '사진 파일이 비어 있습니다.')
    if len(data) > MAX_BYTES:
        raise HTTPException(413, '사진은 900KB 이하로 올려 주세요.')
    extension = detect(data)
    if extension is None:
        raise HTTPException(415, 'JPG, PNG, WEBP 사진만 올릴 수 있습니다.')
    # 소유를 먼저 확인해 다른 점주의 요청이 파일을 만들거나 지우지 못하게 합니다.
    store_id = owned_store(menu_id, owner_id)
    name = f'{menu_id}_{hashlib.sha256(data).hexdigest()[:16]}.{extension}'
    folder = MEDIA_ROOT / MENU_DIR
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    # 같은 사진을 다시 올리면 이미 쓰이는 파일과 이름이 같습니다. 실패해도 원래 있던 파일은 지우지 않습니다.
    existed = target.exists()
    if not existed:
        temporary = folder / f'.{name}.{os.getpid()}.tmp'
        temporary.write_bytes(data)
        os.replace(temporary, target)
    try:
        store_id, old = _replace(menu_id, owner_id, name, store_id)
    except Exception:
        if not existed:
            _remove_files([name])
        raise
    _remove_files(old)
    sync_hub.menu_changed(store_id)
    return {'menu_id': menu_id, 'image_url': image_url(name)}


def delete_image(menu_id, owner_id):
    store_id, old = _replace(menu_id, owner_id, None, owned_store(menu_id, owner_id))
    _remove_files(old)
    sync_hub.menu_changed(store_id)
    return {'menu_id': menu_id, 'image_url': None}


def images_for_store(cursor, store_id):
    cursor.execute('''SELECT i.menu_id, i.img_nm FROM menu_img i JOIN menu m ON m.menu_id = i.menu_id
        JOIN category c ON c.category_id = m.category_id WHERE c.store_id = %s AND i.is_main = TRUE
        ORDER BY i.img_id''', (store_id,))
    return {row['menu_id']: image_url(row['img_nm']) for row in cursor.fetchall()}
