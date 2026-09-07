import { ulid } from 'ulid';

export function generateUlid(prefix?: string): string {
  const id = ulid();
  return prefix ? `${prefix}_${id}` : id;
}
