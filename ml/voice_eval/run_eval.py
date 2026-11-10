"""음성 주문 해석·상황 추천 평가 (구상안 14·15장).

서버의 voice_service를 그대로 써서 발화 세트를 해석하고 다음을 잽니다.
- 의도 분류 정확도(목표 90% 이상)
- 주문 품목 정확도(메뉴·수량이 모두 맞은 비율)
- 추천 적합률: 키오스크와 같은 정책으로 고른 상위 3개 중 적합 메뉴가 하나라도 있는 비율(목표 85% 이상)과 상위 3개의 적합 비율
- 응답 시간(평균·p90)

사용법 (저장소 루트에서):
  server/.venv/Scripts/python.exe ml/voice_eval/run_eval.py --backend claude_cli
  server/.venv/Scripts/python.exe ml/voice_eval/run_eval.py --backend api      # ANTHROPIC_API_KEY 필요

매장 메뉴는 공용 DB에서 읽기 전용으로 가져옵니다(--store, 기본 1). 결과는 ml/voice_eval/REPORT.md에 씁니다.
"""
import argparse
import json
import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'server'))

import ai_db  # noqa: E402
import kiosk_catalog  # noqa: E402
import voice_service  # noqa: E402


def profit_scores(menus):
    rates = [m['costRate'] for m in menus if m['costRate'] is not None]
    if not rates:
        return {}
    low, high = min(rates), max(rates)
    return {m['id']: (50.0 if high == low else (high - m['costRate']) / (high - low) * 100)
            for m in menus if m['costRate'] is not None}


def rank(recommendations, catalog, limit=3):
    """kiosk_app/lib/domain/recommendation_engine.dart와 같은 규칙."""
    settings = catalog['settings']
    menus = {m['id']: m for m in catalog['menus']}
    profits = profit_scores(catalog['menus'])
    w_profit = settings['policy_profit'] / 100 * 0.5
    w_pick = settings['pick_weight'] / 100 * 0.3
    w_fit = 1 - w_profit - w_pick
    ranked = []
    for rec in recommendations:
        menu = menus.get(str(rec['menu_id']))
        if not menu or menu['isSoldOut'] or menu['recExcluded'] or rec['fit'] < settings['fit_threshold']:
            continue
        score = rec['fit'] * w_fit + profits.get(menu['id'], 50) * w_profit + (100 if menu['storePick'] else 0) * w_pick
        ranked.append((score, rec['fit'], menu['name'], rec['reason']))
    ranked.sort(key=lambda r: (-r[0], -r[1]))
    return [(name, reason) for _, _, name, reason in ranked[:limit]]


def build_request(case, by_name):
    def line(name, quantity):
        menu = by_name[name]
        return voice_service.CartLine(entry_id=menu['id'], menu_id=int(menu['id']), quantity=quantity, option_ids=[])
    return voice_service.InterpretInput(
        text=case['text'],
        state=case.get('state', 'listening'),
        viewing_menu_id=int(by_name[case['viewing']]['id']) if case.get('viewing') else None,
        cart=[line(name, qty) for name, qty in case.get('cart', [])],
        recommended_menu_ids=[int(by_name[name]['id']) for name in case.get('recommended', [])],
    )


def evaluate(case, catalog, by_name, by_id):
    request = build_request(case, by_name)
    started = time.perf_counter()
    try:
        result = voice_service.interpret(catalog, request)
        error = None
    except voice_service.VoiceUnavailable as failure:
        result, error = None, str(failure)
    elapsed = time.perf_counter() - started
    record = {'id': case['id'], 'text': case['text'], 'seconds': round(elapsed, 2), 'error': error}
    if result is None:
        record.update(intent=None, intent_ok=False)
        return record
    items = sorted((by_id[str(i['menu_id'])]['name'], i['quantity']) for i in result['items'])
    record.update(intent=result['intent'], intent_ok=result['intent'] in case['intent'], items=items,
                  question=result['question'])
    if 'items' in case:
        record['items_ok'] = items == sorted(tuple(i) for i in case['items'])
    if 'items_any' in case:
        record['items_ok'] = any(items == sorted(tuple(i) for i in option) for option in case['items_any'])
    if case.get('no_items'):
        record['items_ok'] = not items
    if 'options' in case:
        chosen = {by_id[str(i['menu_id'])]['name']: {o['name'] for o in by_id[str(i['menu_id'])]['options'] if int(o['id']) in i['option_ids']}
                  for i in result['items']}
        record['options_ok'] = all(set(opts) <= chosen.get(name, set()) for name, opts in case['options'].items())
    if 'select_index' in case:
        record['items_ok'] = result['select_index'] == case['select_index']
    if 'fit' in case:
        ranked = rank(result['recommendations'], catalog)
        top = [name for name, _ in ranked]
        good = [name for name in top if name in case['fit']]
        record.update(top3=top, reasons=[reason for _, reason in ranked],
                      rec_hit=bool(good), rec_precision=(len(good) / len(top)) if top else 0.0)
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backend', choices=['claude_cli', 'api'], default='claude_cli')
    parser.add_argument('--store', type=int, default=1)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--only', help='쉼표로 구분한 케이스 id만 실행')
    args = parser.parse_args()
    os.environ['VOICE_LLM_BACKEND'] = args.backend
    cases = json.loads((Path(__file__).with_name('cases.json')).read_text(encoding='utf-8'))
    if args.only:
        wanted = set(args.only.split(','))
        cases = [c for c in cases if c['id'] in wanted]
    with ai_db.read_cursor() as cursor:
        catalog = kiosk_catalog.read_catalog(cursor, args.store)
    by_name = {m['name']: m for m in catalog['menus']}
    by_id = {m['id']: m for m in catalog['menus']}
    missing = {n for c in cases for n in [*(i[0] for i in c.get('items', [])), *c.get('fit', []), c.get('viewing'),
                                          *(i[0] for i in c.get('cart', [])), *c.get('recommended', [])] if n and n not in by_name}
    if missing:
        sys.exit(f'매장 메뉴에 없는 이름: {sorted(missing)}')
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        records = list(pool.map(lambda case: evaluate(case, catalog, by_name, by_id), cases))

    def rate(values):
        values = list(values)
        return (sum(values) / len(values), len(values)) if values else (0.0, 0)

    intent = rate(r['intent_ok'] for r in records)
    items = rate(r['items_ok'] for r in records if 'items_ok' in r)
    options = rate(r['options_ok'] for r in records if 'options_ok' in r)
    hit = rate(r['rec_hit'] for r in records if 'rec_hit' in r)
    precision = rate(r['rec_precision'] for r in records if 'rec_precision' in r)
    times = sorted(r['seconds'] for r in records if r['error'] is None)
    errors = [r for r in records if r['error']]
    p90 = times[int(len(times) * 0.9) - 1] if times else 0
    lines = [
        '# 음성 주문 해석·추천 평가 결과',
        '',
        f'- 실행: {time.strftime("%Y-%m-%d %H:%M")} · 백엔드 `{args.backend}` · 모델 `{os.getenv("VOICE_LLM_MODEL") or voice_service.MODEL}` · 매장 {args.store} (메뉴 {len(catalog["menus"])}개)',
        f'- 발화 {len(records)}개 (`ml/voice_eval/cases.json`)',
        '',
        '| 지표 | 결과 | 목표(구상안 14장) |',
        '|---|---|---|',
        f'| 의도 분류 정확도 | {intent[0]:.1%} ({intent[1]}개) | 90% 이상 |',
        f'| 주문 품목·수량 정확도 | {items[0]:.1%} ({items[1]}개) | - |',
        f'| 옵션 인식 | {options[0]:.1%} ({options[1]}개) | - |',
        f'| 추천 적합률(상위 3개 중 적합 메뉴 포함) | {hit[0]:.1%} ({hit[1]}개) | 85% 이상 |',
        f'| 상위 3개 중 적합 메뉴 비율 | {precision[0]:.1%} | - |',
        f'| 응답 시간 평균 / p90 | {statistics.mean(times) if times else 0:.2f}초 / {p90:.2f}초 | 발화 종료 → 첫 응답 2초 이내 |',
        f'| 서버 오류 | {len(errors)}건 | - |',
        '',
        '응답 시간에는 백엔드 호출 시간이 포함됩니다. `claude_cli`는 CLI 실행 비용이 더해져 실제 API보다 깁니다.',
        '',
        '## 틀린 항목',
        '',
    ]
    wrong = [r for r in records if not r['intent_ok'] or r.get('items_ok') is False or r.get('options_ok') is False
             or r.get('rec_hit') is False]
    if not wrong:
        lines.append('없음')
    for r in wrong:
        lines.append(f'- `{r["id"]}` "{r["text"]}" → 의도 `{r["intent"]}`, 품목 {r.get("items")}, '
                     f'상위3 {r.get("top3")}, 되묻기 "{r.get("question") or ""}"{", 오류 " + r["error"] if r["error"] else ""}')
    lines += ['', '## 추천 결과', '']
    for r in records:
        if 'top3' in r:
            lines.append(f'- `{r["id"]}` "{r["text"]}" → {", ".join(r["top3"]) or "(없음)"}'
                         f' · 이유: {" / ".join(x for x in r["reasons"] if x)}')
    report = Path(__file__).with_name('REPORT.md')
    report.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (Path(__file__).with_name('last_run.json')).write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding='utf-8')
    print('\n'.join(lines[:16]))


if __name__ == '__main__':
    main()
