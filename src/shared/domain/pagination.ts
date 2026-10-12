export interface PageRequest {
  page: number;
  perPage: number;
}

export interface PageMeta {
  total: number;
  perPage: number;
  currentPage: number;
  lastPage: number;
  firstPage: number;
}

/** Formato compatível com o `paginate()` do Lucid usado pelo frontend actual. */
export interface Page<T> {
  meta: PageMeta;
  data: T[];
}

export const buildPage = <T>(data: T[], total: number, req: PageRequest): Page<T> => ({
  meta: {
    total,
    perPage: req.perPage,
    currentPage: req.page,
    lastPage: Math.max(1, Math.ceil(total / req.perPage)),
    firstPage: 1,
  },
  data,
});

export const offsetOf = (req: PageRequest): number => (req.page - 1) * req.perPage;
