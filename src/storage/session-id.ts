import { createHash } from 'node:crypto';

export function piInventoryId(file: string): string {
  const digest = createHash('sha256').update(`pi-session:${file}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}
