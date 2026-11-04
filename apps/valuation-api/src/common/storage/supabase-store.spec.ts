import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SupabaseStore, supabaseConfigFromEnv } from './supabase-store.js';
import { StorageService } from './storage.service.js';

const config = { url: 'https://abc.supabase.co', serviceKey: 'service-key', bucket: 'valuehub-files' };

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('supabaseConfigFromEnv', () => {
  it('is off unless both the URL and the key are set', () => {
    expect(supabaseConfigFromEnv({})).toBeNull();
    expect(supabaseConfigFromEnv({ SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
  });
  it('trims a trailing slash and defaults the bucket', () => {
    expect(supabaseConfigFromEnv({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toEqual({ url: 'https://x.supabase.co', serviceKey: 'k', bucket: 'valuehub-files' });
  });
});

describe('SupabaseStore', () => {
  it('uploads once, never overwriting, with the service key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new SupabaseStore(config).put('firm-1/abc', Buffer.from('hello'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://abc.supabase.co/storage/v1/object/valuehub-files/firm-1/abc');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-upsert']).toBe('false');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer service-key');
  });

  it('reads private files through the authenticated endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('file-bytes', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const data = await new SupabaseStore(config).read('firm-1/abc');
    expect(data.toString()).toBe('file-bytes');
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/object/authenticated/valuehub-files/firm-1/abc');
  });

  it('reports a missing file as not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    await expect(new SupabaseStore(config).read('firm-1/gone')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('surfaces a refused upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('quota exceeded', { status: 413 })));
    await expect(new SupabaseStore(config).put('firm-1/abc', Buffer.from('x'))).rejects.toThrow(/refused the upload \(413\)/);
  });

  it('treats deleting an already-missing file as done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    await expect(new SupabaseStore(config).remove('firm-1/gone')).resolves.toBeUndefined();
  });
});

describe('StorageService backend choice', () => {
  it('uses local disk by default and Supabase when configured', () => {
    expect(new StorageService().driver).toBe('local');
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    expect(new StorageService().driver).toBe('supabase');
  });
});
