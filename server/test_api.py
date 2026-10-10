import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app


class MenuApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "dataSource": "mock"})

    def test_menu_contract(self):
        response = self.client.get("/menus")
        self.assertEqual(response.status_code, 200)
        menus = response.json()
        self.assertEqual(len(menus), 14)
        self.assertEqual(len({menu["id"] for menu in menus}), 14)
        rice = next(menu for menu in menus if menu["id"] == "rice-1")
        self.assertEqual(rice["price"], 9000)
        self.assertFalse(rice["isSoldOut"])
        soda = next(menu for menu in menus if menu["id"] == "drink-2")
        self.assertTrue(soda["isSoldOut"])

    def test_category_filter(self):
        menus = self.client.get("/menus", params={"category": "식사"}).json()
        self.assertEqual(len(menus), 2)
        self.assertTrue(all(menu["category"] == "식사" for menu in menus))
        self.assertEqual(self.client.get("/menus", params={"category": "없는 분류"}).json(), [])

    def test_database_menu_mapping(self):
        row = {'menu_id': 12, 'menu_nm': '테스트 메뉴', 'menu_price': 8000,
               'menu_des': None, 'is_sold_out': 1, 'category_nm': '식사'}
        option = {'option_id': 3, 'menu_id': 12, 'option_nm': '밥 추가',
                  'extra_price': 1000, 'is_sold_out': 1}
        with patch('database.query', side_effect=[[row], [option]]) as query:
            response = self.client.get('/stores/7/menus')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), [{'id': '12', 'name': '테스트 메뉴',
                'category': '식사', 'price': 8000, 'description': '', 'isSoldOut': True,
                'options': [{'id': '3', 'name': '밥 추가', 'price': 1000, 'isSoldOut': True}]}])
            self.assertEqual(query.call_args.args[1], (7,))

    def test_database_failure_hides_details(self):
        with patch('database.query', side_effect=RuntimeError('private connection details')):
            response = self.client.get('/stores/1/menus')
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('private connection details', response.text)

    def test_empty_database_and_invalid_store(self):
        with patch('database.query', return_value=[]):
            self.assertEqual(self.client.get('/stores/1/menus').json(), [])
            self.assertEqual(self.client.get('/stores/0/menus').status_code, 422)


if __name__ == "__main__":
    unittest.main()
