import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { SupabaseStore, supabaseConfigFromEnv } from './supabase-store.js';

export interface StoredFile {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
}

// File store with two backends behind one interface. With SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY set, files live in a private Supabase Storage
// bucket; otherwise they sit on local disk (development, small sites). Keys
// are generated here (<firmId>/<uuid>), never taken from the client, and on
// disk every read re-checks the resolved path stays inside the storage root.
@Injectable()
export class StorageService {
  private readonly root = resolve(process.env.STORAGE_DIR ?? './storage');
  private readonly remote: SupabaseStore | null;

  constructor() {
    const config = supabaseConfigFromEnv();
    this.remote = config ? new SupabaseStore(config) : null;
  }

  get driver(): 'supabase' | 'local' {
    return this.remote ? 'supabase' : 'local';
  }

  async save(firmId: string, buffer: Buffer): Promise<StoredFile> {
    const storageKey = `${firmId}/${randomUUID()}`;
    if (this.remote) {
      await this.remote.put(storageKey, buffer);
      return { storageKey, sha256: createHash('sha256').update(buffer).digest('hex'), sizeBytes: buffer.length };
    }
    const target = this.pathFor(storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx' });
    return {
      storageKey,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      sizeBytes: buffer.length,
    };
  }

  async open(storageKey: string): Promise<Readable> {
    if (this.remote) return this.remote.stream(storageKey);
    const target = this.pathFor(storageKey);
    try {
      await stat(target);
    } catch {
      throw new NotFoundException('Stored file is missing');
    }
    return createReadStream(target);
  }

  async exists(storageKey: string): Promise<boolean> {
    if (this.remote) return this.remote.exists(storageKey);
    try {
      await stat(this.pathFor(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async read(storageKey: string): Promise<Buffer> {
    if (this.remote) return this.remote.read(storageKey);
    try {
      return await readFile(this.pathFor(storageKey));
    } catch {
      throw new NotFoundException('Stored file is missing');
    }
  }

  // Used to undo a save when the database write that follows it fails.
  async remove(storageKey: string): Promise<void> {
    if (this.remote) return this.remote.remove(storageKey);
    await rm(this.pathFor(storageKey), { force: true });
  }

  private pathFor(storageKey: string): string {
    const target = resolve(join(this.root, storageKey));
    if (!target.startsWith(this.root + sep)) throw new Error('Storage key escapes the storage root');
    return target;
  }
}
