"""국내 주요 번호 입력 정책. 실제 개통·명의·사업자번호 체크섬은 검증하지 않습니다."""
import re

_PHONE = re.compile(r'(?:010[0-9]{8}|02[0-9]{7,8}|0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4])[0-9]{7,8}|070[0-9]{8}|080[0-9]{7}|1[568][0-9]{6})')


def digits(value):
    if not re.fullmatch(r'[0-9 ()-]*', value):
        raise ValueError('숫자 및 허용 구분자만 입력해 주세요.')
    return re.sub(r'[ ()-]', '', value)


def business_number(value):
    value = digits(value)
    if not re.fullmatch(r'[0-9]{10}', value):
        raise ValueError('사업자번호는 숫자 10자리입니다.')
    return value


def phone_number(value):
    value = digits(value)
    if not _PHONE.fullmatch(value):
        raise ValueError('지원하는 국내 전화번호 형식과 자리수를 확인해 주세요.')
    if value[0] == '1':
        return value[:4] + '-' + value[4:]
    first = 2 if value.startswith('02') else 3
    return value[:first] + '-' + value[first:-4] + '-' + value[-4:]
