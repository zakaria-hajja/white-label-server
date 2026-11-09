function hasCode(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === code;
}

export const isUniqueViolation = (e: unknown): boolean => hasCode(e, "P2002");
export const isNotFound = (e: unknown): boolean => hasCode(e, "P2025");
