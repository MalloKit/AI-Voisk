-- 테스트 매장과 메뉴만 추가합니다. 기존 데이터는 변경하지 않습니다.

USE voisk;

START TRANSACTION;

INSERT INTO admin (admin_nm, admin_pw) SELECT '테스트관리자', 'DISABLED_TEST_ACCOUNT' WHERE NOT EXISTS (SELECT 1 FROM admin WHERE admin_nm = '테스트관리자');

SET @seed_admin = (SELECT MIN(admin_id) FROM admin WHERE admin_nm = '테스트관리자');

INSERT INTO store (store_nm, store_add1, store_code, store_phone, business_no, store_owner_nm, store_type, admin_id) SELECT '보이스크 테스트 매장', '테스트 주소', 'T0001', '000-0000-0000', '0000000000', '테스트점주', '음식점', @seed_admin WHERE NOT EXISTS (SELECT 1 FROM store WHERE store_code = 'T0001');

SET @seed_store = (SELECT MIN(store_id) FROM store WHERE store_code = 'T0001');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '식사', 1 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '식사');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '국물', 2 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '국물');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '사이드', 3 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '사이드');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '음료', 4 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '음료');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '면류', 5 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '면류');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '구이', 6 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '구이');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '튀김', 7 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '튀김');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '분식', 8 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '분식');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '샐러드', 9 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '샐러드');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '디저트', 10 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '디저트');

INSERT INTO category (store_id, category_nm, category_sort) SELECT @seed_store, '세트', 11 WHERE NOT EXISTS (SELECT 1 FROM category WHERE store_id = @seed_store AND category_nm = '세트');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '제육덮밥', 9000, '매콤한 제육과 따뜻한 밥', TRUE, FALSE, 1 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '식사') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '제육덮밥');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '비빔밥', 8000, '다양한 채소를 곁들인 한 그릇', TRUE, FALSE, 2 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '식사') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '비빔밥');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '순두부찌개', 8500, '부드러운 순두부와 얼큰한 국물', TRUE, FALSE, 3 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '국물') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '순두부찌개');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '콩나물국밥', 7500, '콩나물이 들어간 시원한 국밥', TRUE, FALSE, 4 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '국물') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '콩나물국밥');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '만두', 4000, '따뜻한 만두 한 접시', TRUE, FALSE, 5 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '사이드') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '만두');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '콜라', 2000, '시원한 콜라', TRUE, FALSE, 6 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '음료') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '콜라');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '사이다', 2000, '시원한 사이다', TRUE, TRUE, 7 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '음료') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '사이다');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '잔치국수', 7000, '따뜻한 국물의 잔치국수', TRUE, FALSE, 8 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '면류') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '잔치국수');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '불고기', 12000, '달콤한 양념 불고기', TRUE, FALSE, 9 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '구이') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '불고기');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '새우튀김', 6000, '바삭한 새우튀김', TRUE, FALSE, 10 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '튀김') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '새우튀김');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '떡볶이', 5000, '매콤한 떡볶이', TRUE, FALSE, 11 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '분식') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '떡볶이');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '채소 샐러드', 6500, '신선한 채소 샐러드', TRUE, FALSE, 12 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '샐러드') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '채소 샐러드');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '바닐라 아이스크림', 3000, '부드러운 바닐라 아이스크림', TRUE, FALSE, 13 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '디저트') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '바닐라 아이스크림');

INSERT INTO menu (category_id, menu_nm, menu_price, menu_des, is_active, is_sold_out, menu_sort) SELECT c.category_id, '덮밥 세트', 11000, '덮밥과 음료를 함께 제공하는 세트', TRUE, FALSE, 14 FROM category c WHERE c.category_id = (SELECT MIN(c2.category_id) FROM category c2 WHERE c2.store_id = @seed_store AND c2.category_nm = '세트') AND NOT EXISTS (SELECT 1 FROM menu m WHERE m.category_id = c.category_id AND m.menu_nm = '덮밥 세트');

COMMIT;

SELECT @seed_store AS store_id;

SELECT m.menu_id, m.menu_nm, m.menu_price FROM menu m JOIN category c ON c.category_id = m.category_id WHERE c.store_id = @seed_store ORDER BY c.category_sort, m.menu_sort;
