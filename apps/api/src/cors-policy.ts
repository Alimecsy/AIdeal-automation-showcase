export function isAllowedCorsOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
) {
  return !origin || allowedOrigins.has(origin);
}
