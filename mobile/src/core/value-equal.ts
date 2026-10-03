/** Object field order is not a data change; PostgreSQL JSONB may reorder keys. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  )
    return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => sameValue(value, b[i]))
    );
  const first = a as Record<string, unknown>,
    second = b as Record<string, unknown>,
    keys = Object.keys(first)
      .filter((k) => first[k] !== undefined)
      .sort(),
    other = Object.keys(second)
      .filter((k) => second[k] !== undefined)
      .sort();
  return (
    keys.length === other.length &&
    keys.every(
      (key, i) => key === other[i] && sameValue(first[key], second[key]),
    )
  );
}
