"""키오스크 앱 아이콘(안드로이드)을 만듭니다. 말풍선 안의 음성 파형 = 말로 주문하는 키오스크.

- 적응형 아이콘(Android 8+): 배경 색 + 전경(흰 말풍선, 파형은 뚫린 모양) + 테마 아이콘용 단색 레이어
- 예전 아이콘: 둥근 사각형 한 장(48~192px)
- 색은 키오스크 화면의 기본 초록(#246B58)을 씁니다.

실행: python -I kiosk_app/tool/make_app_icon.py [미리보기.png]   (Pillow 필요)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

GREEN = '#246B58'
WHITE = (255, 255, 255, 255)
RES = Path(__file__).resolve().parents[1] / 'android' / 'app' / 'src' / 'main' / 'res'
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
MASTER = 1728  # 108dp × 16. 크게 그린 뒤 줄여 가장자리를 부드럽게 합니다.


def foreground():
    """108dp 캔버스의 전경. 내용은 가운데 66dp 안전 영역(지름 0.61) 안에 둡니다."""
    size = MASTER
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    u = size / 108  # 1dp

    # 말풍선 몸통과 꼬리(왼쪽 아래).
    left, top, right, bottom = 28 * u, 33 * u, 80 * u, 71 * u
    draw.rounded_rectangle((left, top, right, bottom), radius=12 * u, fill=WHITE)
    draw.polygon([(36 * u, 66 * u), (51 * u, 66 * u), (35 * u, 81 * u)], fill=WHITE)

    # 음성 파형: 막대 5개를 투명하게 뚫어 배경 초록이 보이게 합니다(단색 테마 아이콘에서도 모양이 남음).
    heights = [8, 16, 23, 14, 8]
    bar, gap = 4.6 * u, 4.4 * u
    total = len(heights) * bar + (len(heights) - 1) * gap
    x = (left + right) / 2 - total / 2
    middle = (top + bottom) / 2
    for height in heights:
        h = height * u
        draw.rounded_rectangle((x, middle - h / 2, x + bar, middle + h / 2), radius=bar / 2, fill=(0, 0, 0, 0))
        x += bar + gap
    return image


def legacy(fore):
    """적응형을 지원하지 않는 런처용: 보이는 72dp만 잘라 둥근 사각형에 담습니다."""
    size = MASTER
    base = Image.new('RGBA', (size, size), GREEN)
    base.alpha_composite(fore)
    crop = size * 18 // 108
    base = base.crop((crop, crop, size - crop, size - crop))
    mask = Image.new('L', base.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, base.width - 1, base.height - 1), radius=base.width * 0.22, fill=255)
    out = Image.new('RGBA', base.size, (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def write_xml(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')


def main():
    fore = foreground()
    flat = legacy(fore)
    for name, scale in DENSITIES.items():
        folder = RES / f'mipmap-{name}'
        folder.mkdir(parents=True, exist_ok=True)
        fore.resize((round(108 * scale),) * 2, Image.LANCZOS).save(folder / 'ic_launcher_foreground.png', optimize=True)
        flat.resize((round(48 * scale),) * 2, Image.LANCZOS).save(folder / 'ic_launcher.png', optimize=True)
    write_xml(RES / 'mipmap-anydpi-v26' / 'ic_launcher.xml', """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
""")
    write_xml(RES / 'values' / 'ic_launcher_background.xml', f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{GREEN}</color>
</resources>
""")

    if len(sys.argv) > 1:
        # 원형·스쿼클 마스크와 작은 크기에서 어떻게 보이는지 한 장으로 봅니다.
        full = Image.new('RGBA', (MASTER, MASTER), GREEN)
        full.alpha_composite(fore)
        sheet = Image.new('RGBA', (1180, 420), (245, 247, 245, 255))
        for i, shape in enumerate(('circle', 'squircle', 'legacy')):
            tile = flat if shape == 'legacy' else full
            view = tile.resize((300, 300), Image.LANCZOS)
            if shape != 'legacy':
                mask = Image.new('L', (300, 300), 0)
                pad = 300 * 18 // 108
                box = (pad, pad, 300 - pad, 300 - pad)
                if shape == 'circle':
                    ImageDraw.Draw(mask).ellipse(box, fill=255)
                else:
                    ImageDraw.Draw(mask).rounded_rectangle(box, radius=70, fill=255)
                cut = Image.new('RGBA', (300, 300), (0, 0, 0, 0))
                cut.paste(view, (0, 0), mask)
                view = cut
            sheet.alpha_composite(view, (20 + i * 320, 20))
        for j, px in enumerate((48, 72, 96, 144)):
            sheet.alpha_composite(flat.resize((px, px), Image.LANCZOS), (980, 20 + sum((48, 72, 96, 144)[:j]) // 2 + j * 4))
        sheet.save(sys.argv[1])


if __name__ == '__main__':
    main()
