export function parseJsonInput(input: string, fallback: unknown) {
  const value = input.trim();

  if (!value) {
    return fallback;
  }

  return JSON.parse(value) as unknown;
}
