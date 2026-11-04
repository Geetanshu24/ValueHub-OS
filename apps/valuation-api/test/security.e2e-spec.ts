import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, login, makeUser } from './helpers.js';

const sink = process.env.E2E_SMTP_SINK_URL;

describe.skipIf(!e2eEnabled)('login protection and password reset', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  it('locks an address out after ten failed attempts, without affecting others, and a good login still works before that', async () => {
    const user = await makeUser(admin.token, 'VALUER');
    for (let i = 0; i < 10; i += 1) {
      expect((await http('POST', '/auth/login', { json: { email: user.email, password: 'wrong-password-1' } })).status).toBe(401);
    }
    const blocked = await http('POST', '/auth/login', { json: { email: user.email, password: user.password } });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/Too many/);

    const other = await makeUser(admin.token, 'VALUER');
    expect((await login(other.email, other.password)).id).toBe(other.id);
  });

  it('unknown emails are throttled the same way, so guessing accounts costs the same', async () => {
    const email = `ghost-${Math.random().toString(36).slice(2, 8)}@example.com`;
    for (let i = 0; i < 10; i += 1) await http('POST', '/auth/login', { json: { email, password: 'whatever-123456' } });
    expect((await http('POST', '/auth/login', { json: { email, password: 'whatever-123456' } })).status).toBe(429);
  });

  it('forgot-password answers identically for unknown and known emails', async () => {
    const known = await makeUser(admin.token, 'VALUER');
    const a = await http('POST', '/auth/forgot-password', { json: { email: known.email } });
    const b = await http('POST', '/auth/forgot-password', { json: { email: `nobody-${Date.now()}@example.com` } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });

  it.skipIf(!sink)('a reset link works once, the old password stops working, and a bad token is refused', async () => {
    const user = await makeUser(admin.token, 'VALUER');
    await http('POST', '/auth/forgot-password', { json: { email: user.email } });
    const inbox = await (await fetch(sink!)).json();
    const mail = [...inbox].reverse().find((m: any) => m.to?.includes(user.email));
    const token = /token=([\w-]+)/.exec(mail.text)?.[1];
    expect(token).toBeTruthy();

    expect((await http('POST', '/auth/reset-password', { json: { token: 'x'.repeat(30), newPassword: 'brand-new-password-1' } })).status).toBe(400);
    expect((await http('POST', '/auth/reset-password', { json: { token, newPassword: 'short' } })).status).toBe(400);
    expect((await http('POST', '/auth/reset-password', { json: { token, newPassword: 'brand-new-password-1' } })).status).toBe(200);
    expect((await http('POST', '/auth/reset-password', { json: { token, newPassword: 'another-new-password-2' } })).status).toBe(400); // used

    await expect(login(user.email, user.password)).rejects.toThrow();
    expect((await login(user.email, 'brand-new-password-1')).id).toBe(user.id);
  });

  it('nothing requires login except health, login and the reset flow', async () => {
    for (const [method, path] of [['GET', '/assignments'], ['GET', '/users'], ['GET', '/dashboard/summary'], ['GET', '/search'], ['GET', '/admin/retention'], ['POST', '/auth/change-password'], ['GET', '/reports/00000000-0000-4000-8000-000000000000/file']] as const) {
      expect((await http(method, path)).status).toBe(401);
    }
  });
});
