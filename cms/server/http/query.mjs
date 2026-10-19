/** Pagination : ?page=2&pageSize=25 bornés. */
export function pageParams(query, defaultSize = 25, maxSize = 100) {
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.get("page"), 10) || 1));
  const pageSize = Math.max(1, Math.min(maxSize, Number.parseInt(query.get("pageSize"), 10) || defaultSize));
  return { page, pageSize };
}
