import { numberDigits, type NumberKind } from "./koreanNumbers";

export type InputLimit = { max: number; kind: "text" | "postcode" | NumberKind; original?: string };
export function acceptsInput(next: string, current: string, rule: InputLimit, deletion = true): boolean {
  if (next === rule.original || next === "") return true;
  const valid = (value: string) => rule.kind === "text" ? Array.from(value).length <= rule.max
    : rule.kind === "postcode" ? /^[0-9]*$/.test(value) && value.length <= rule.max
    : numberDigits(value) !== null && numberDigits(value)!.length <= rule.max;
  if (valid(next)) return true;
  // Existing invalid values may be restored exactly, or reduced by deletion without inserting new characters.
  if (!deletion || valid(current) || next.length >= current.length) return false;
  const characters = Array.from(next);
  let i = 0;
  for (const char of current) if (char === characters[i]) i++;
  return i === characters.length;
}
