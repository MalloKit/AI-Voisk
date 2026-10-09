"""접속 설정의 실제 값이나 DB 오류 원문을 노출하지 않는 조회 검사."""
import sys
from database import query

try:
    query('SELECT 1 AS connected')
    print('DB connection OK')
    rows = query('SELECT store_id FROM store ORDER BY store_id')
    print('Store IDs:', [row['store_id'] for row in rows])
    print('Menu count:', query('SELECT COUNT(*) AS count FROM menu')[0]['count'])
except Exception as error:
    print('DB check failed:', type(error).__name__)
    code = error.args[0] if error.args and isinstance(error.args[0], int) else 'not available'
    print('Error code:', code)
    sys.exit(1)
