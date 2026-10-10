/** Joins class names, skipping falsy parts. Callers never pass two classes that set the same property. */
export function classes(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
