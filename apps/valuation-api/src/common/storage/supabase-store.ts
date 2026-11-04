import { NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';

const TIMEOUT_MS = 60_000;

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
  bucket: string;
}

// Reads the Supabase settings from the environment. Returns null when they are
// not set, so the local disk store is used instead (development and tests).
export function supabaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return { url, serviceKey, bucket: env.SUPABASE_BUCKET?.trim() || 'valuehub-files' };
}

// A private Supabase Storage bucket, reached through its REST API with the
// service-role key. That key stays on the server; the browser never sees it,
// and every download goes through this API's own authorisation.
export class SupabaseStore {
  constructor(private readonly config: SupabaseConfig) {}

  private endpoint(kind: 'object' | 'authenticated', key: string): string {
    const path = key.split('/').map(encodeURIComponent).join('/');
    return `${this.config.url}/storage/v1/object/${kind === 'authenticated' ? 'authenticated/' : ''}${this.config.bucket}/${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.config.serviceKey}`, apikey: this.config.serviceKey, ...extra };
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new Error(`File storage is unreachable: ${(error as Error).message}`);
    }
  }

  // A key is written once. Overwriting is refused so a stored file can never be replaced silently.
  async put(key: string, data: Buffer): Promise<void> {
    const response = await this.call(this.endpoint('object', key), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' }),
      body: new Uint8Array(data),
    });
    if (!response.ok) throw new Error(`File storage refused the upload (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }

  async stream(key: string): Promise<Readable> {
    const response = await this.call(this.endpoint('authenticated', key), { method: 'GET', headers: this.headers() });
    if (response.status === 404 || response.status === 400) throw new NotFoundException('Stored file is missing');
    if (!response.ok || !response.body) throw new Error(`File storage could not read the file (${response.status})`);
    return Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream);
  }

  async read(key: string): Promise<Buffer> {
    const response = await this.call(this.endpoint('authenticated', key), { method: 'GET', headers: this.headers() });
    if (response.status === 404 || response.status === 400) throw new NotFoundException('Stored file is missing');
    if (!response.ok) throw new Error(`File storage could not read the file (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    const response = await this.call(this.endpoint('authenticated', key), { method: 'HEAD', headers: this.headers() });
    return response.ok;
  }

  async remove(key: string): Promise<void> {
    const response = await this.call(this.endpoint('object', key), { method: 'DELETE', headers: this.headers() });
    // Already gone is the outcome that was asked for.
    if (!response.ok && response.status !== 404) throw new Error(`File storage could not delete the file (${response.status})`);
  }
}
