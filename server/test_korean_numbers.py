"""프론트엔드와 같은 번호 계약 사례 및 격리 DB 저장 검증."""
import json
from pathlib import Path
import unittest
from korean_numbers import phone_number, business_number
import test_store_writes as fixtures

CASES = json.loads((Path(__file__).resolve().parents[1] /
                   'company_admin_web/src/test/number-cases.json').read_text(encoding='utf-8'))


class NumberContractTests(unittest.TestCase):
    def test_shared_valid_phone_cases(self):
        for case in CASES['phone']:
            with self.subTest(value=case['input']):
                self.assertEqual(phone_number(case['input']), case['expected'])

    def test_shared_invalid_phone_cases(self):
        for value in CASES['invalidPhone']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                phone_number(value)

    def test_shared_business_cases(self):
        for case in CASES['business']:
            self.assertEqual(business_number(case['input']), case['expected'])
        for value in CASES['invalidBusiness']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                business_number(value)


class StoreNumberApiTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.StoreWriteTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def test_create_all_supported_phone_formats_and_get_canonical_storage(self):
        f = self.fixture
        for case in CASES['phone']:
            response = f.create({**f.input, 'phone': case['input']})
            self.assertEqual(response.status_code, 201, response.text)
            row = response.json()
            self.assertEqual(row['phone'], case['expected'])
            self.assertEqual(f.client.get('/admin/stores/' + str(row['store_id'])).json()['phone'], case['expected'])
            self.assertEqual(f.db.execute('SELECT store_phone FROM store WHERE store_id=?', (row['store_id'],)).fetchone()[0], case['expected'])

    def test_create_and_patch_business_strip_hyphens_before_char10_storage(self):
        f = self.fixture
        for case in CASES['business']:
            response = f.create({**f.input, 'business_no': case['input']})
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()['business_no'], case['expected'])
            response = f.modify({'business_no': case['input']})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['business_no'], case['expected'])
            self.assertEqual(f.db.execute('SELECT business_no FROM store WHERE store_id=10').fetchone()[0], case['expected'])

    def test_invalid_create_and_patch_numbers_never_write(self):
        f = self.fixture
        for key, values in [('phone', CASES['invalidPhone']), ('business_no', CASES['invalidBusiness'])]:
            for value in values:
                with self.subTest(field=key, value=value):
                    self.assertEqual(f.create({**f.input, key: value}).status_code, 422)
                    self.assertEqual(f.modify({key: value}).status_code, 422)
        self.assertEqual(f.commits, 0)
        self.assertEqual(f.count(), 1)

    def test_unchanged_legacy_columns_are_not_normalized_during_other_edits(self):
        f = self.fixture
        f.db.execute("UPDATE store SET store_phone=?, business_no=?, store_code=? WHERE store_id=10",
                     ('legacy-phone', 'OLD', 'T0001'))
        f.db.commit()
        row = f.modify({'store_name': '이름만 수정'}).json()
        self.assertEqual((row['phone'], row['business_no'], row['store_code']), ('legacy-phone', 'OLD', 'T0001'))
        response = f.modify({'phone': '0212345678'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['phone'], '02-1234-5678')
        self.assertEqual(response.json()['business_no'], 'OLD')

    def test_numeric_json_values_are_rejected_and_never_lose_leading_zeroes(self):
        f = self.fixture
        for key in ('phone', 'business_no'):
            self.assertEqual(f.create({**f.input, key: 1234567890}).status_code, 422)
            self.assertEqual(f.modify({key: None}).status_code, 422)
        self.assertEqual(f.commits, 0)


if __name__ == '__main__':
    unittest.main()
