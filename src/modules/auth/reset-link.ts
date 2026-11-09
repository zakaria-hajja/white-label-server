/** Appends `token` to the base URL, preserving any existing query string (works for custom schemes). */
export function buildResetLink(linkBaseUrl: string, token: string): string {
  const url = new URL(linkBaseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}
