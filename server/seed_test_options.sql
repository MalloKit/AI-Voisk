-- T0001 테스트 매장의 메뉴에 옵션 10개를 추가합니다.

-- 기존 옵션은 수정하지 않으며, 동일 이름의 옵션은 중복 추가하지 않습니다.

USE voisk;

START TRANSACTION;

SET @option_store = (SELECT MIN(store_id) FROM store WHERE store_code = 'T0001');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '밥 추가', 1, 1000, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '제육덮밥'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '밥 추가');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '계란 추가', 2, 1000, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '제육덮밥'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '계란 추가');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '고기 추가', 3, 2000, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '제육덮밥'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '고기 추가');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '밥 추가', 1, 1000, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '비빔밥'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '밥 추가');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '계란 추가', 2, 1000, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '비빔밥'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '계란 추가');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '고기 추가', 3, 2000, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '비빔밥'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '고기 추가');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '공깃밥 추가', 1, 1000, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '순두부찌개'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '공깃밥 추가');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '두부 추가', 2, 1500, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '순두부찌개'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '두부 추가');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '공깃밥 추가', 1, 1000, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '콩나물국밥'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '공깃밥 추가');

INSERT INTO menu_option (menu_id, option_nm, menu_option_sort, extra_price, is_active, is_sold_out)
SELECT m.menu_id, '소스 추가', 1, 500, TRUE, FALSE
FROM menu m JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store AND m.menu_nm = '만두'
AND NOT EXISTS (SELECT 1 FROM menu_option o WHERE o.menu_id = m.menu_id AND o.option_nm = '소스 추가');

COMMIT;

SELECT m.menu_nm, o.option_nm, o.extra_price, o.is_sold_out
FROM menu_option o JOIN menu m ON m.menu_id = o.menu_id
JOIN category c ON c.category_id = m.category_id
WHERE c.store_id = @option_store
ORDER BY m.menu_sort, o.menu_option_sort;
