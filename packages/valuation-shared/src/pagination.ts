export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
