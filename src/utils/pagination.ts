export interface PaginationOptions {
  page?: number;
  limit?: number;
  sort?: string;
}

export interface PaginationResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export function parsePagination(query: any): { page: number; limit: number; skip: number; sort: any } {
  const page = Math.max(1, parseInt(query.page || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
  const skip = (page - 1) * limit;
  const sortParam = query.sort || "-createdAt";
  const sort: any = {};
  for (const field of String(sortParam).split(",")) {
    const f = field.trim();
    if (!f) continue;
    if (f.startsWith("-")) sort[f.slice(1)] = -1;
    else sort[f] = 1;
  }
  return { page, limit, skip, sort };
}
