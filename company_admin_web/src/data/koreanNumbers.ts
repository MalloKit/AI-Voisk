/** Store input policy. This validates number shape, not allocation or ownership. */
export type NumberKind = "phone" | "business";
export function numberDigits(value: string): string | null {
  return !/[^0-9 ()-]/.test(value) ? value.replace(/[ ()-]/g, "") : null;
}
const phonePattern = /^(?:010[0-9]{8}|02[0-9]{7,8}|0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4])[0-9]{7,8}|070[0-9]{8}|080[0-9]{7}|1[568][0-9]{6})$/;
export function validPhone(value: string): boolean {
  const digits = numberDigits(value);
  return digits !== null && phonePattern.test(digits);
}
export function validBusiness(value: string): boolean {
  const digits = numberDigits(value);
  return digits !== null && /^[0-9]{10}$/.test(digits);
}
function groups(value: string, first: number, middle?: number): string {
  if (value.length <= first) return value;
  if (middle === undefined || value.length <= first + middle)
    return value.slice(0, first) + "-" + value.slice(first);
  return value.slice(0, first) + "-" + value.slice(first, first + middle) + "-" + value.slice(first + middle);
}
export function formatNumber(value: string, kind: NumberKind): string {
  const digits = numberDigits(value);
  // Invalid characters are retained for validation; never silently turn an invalid paste into a valid number.
  if (digits === null) return value;
  if (kind === "business") return groups(digits, 3, 2);
  if (/^1[568]/.test(digits)) return groups(digits, 4);
  if (digits.startsWith("02")) return groups(digits, 2, digits.length > 9 ? 4 : 3);
  const middle = /^(010|070)/.test(digits) || digits.length > 10 ? 4 : 3;
  return groups(digits, 3, middle);
}
export function canonicalNumber(value: string, kind: NumberKind): string {
  return kind === "business" ? numberDigits(value)! : formatNumber(value, kind);
}
export function sameNumber(a: string, b: string, kind: NumberKind): boolean {
  const valid = kind === "phone" ? validPhone : validBusiness;
  return valid(a) && valid(b) && numberDigits(a) === numberDigits(b);
}
