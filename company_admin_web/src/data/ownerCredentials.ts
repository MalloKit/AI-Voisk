// Creation policy; future owner login must agree on the same rules without rewriting existing IDs.
export const ownerPasswordMin = 8, ownerPasswordMax = 128;
export function validOwnerLogin(value: string) {
  return value.length >= 4 && value.length <= 100 && !/[^a-z0-9._-]/.test(value);
}
export function validOwnerPassword(value: string) {
  const characters = Array.from(value);
  return !!value.replace(/[\s\u0085]/gu, "") && characters.length >= ownerPasswordMin && characters.length <= ownerPasswordMax &&
    !characters.some((c) => { const code = c.codePointAt(0)!; return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff); });
}
