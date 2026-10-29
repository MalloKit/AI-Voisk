// DB 컬럼 길이와 서버 검증 기준.
export const LIMITS = {
  menuName: 50, // menu_nm VARCHAR(50)
  optionName: 50, // option_nm VARCHAR(50)
  categoryName: 100, // category_nm VARCHAR(100)
  description: 500, // menu_des VARCHAR(500)
  minPrice: 1,
  maxPrice: 1_000_000,
} as const;

export function nameError(value: string, max: number, label: string) {
  if (!value.trim()) return `${label}을 입력해 주세요.`;
  if (value.length > max) return `${label}은 ${max}자 이하로 입력해 주세요.`;
  return null;
}

// 쉼표는 허용하고 정수만 받는다.
function parseWon(text: string) {
  const plain = text.replace(/,/g, "").trim();
  return /^\d+$/.test(plain) ? Number(plain) : null;
}
export function parsePrice(text: string) {
  const value = parseWon(text);
  return value !== null && value >= LIMITS.minPrice && value <= LIMITS.maxPrice
    ? { value, error: null }
    : {
        value: null,
        error: "가격은 1원부터 1,000,000원까지 숫자로 입력해 주세요.",
      };
}
export function parseExtraPrice(text: string) {
  const value = parseWon(text);
  return value !== null && value <= LIMITS.maxPrice
    ? { value, error: null }
    : {
        value: null,
        error: "추가 금액은 0원부터 1,000,000원까지 숫자로 입력해 주세요.",
      };
}

export const formatWon = (amount: number) =>
  `${amount.toLocaleString("en-US")}원`;
