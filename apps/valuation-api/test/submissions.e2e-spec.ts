import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment, makeUser } from './helpers.js';

// EMAIL assertions need the API to point at an SMTP sink that also exposes what
// it received over HTTP (E2E_SMTP_SINK_URL).
const sink = process.env.E2E_SMTP_SINK_URL;

describe.skipIf(!e2eEnabled)('submissions', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  const issued = async (propertyClass = 'LAND') => {
    const ids = await makeAssignment(admin, propertyClass, 'APPROVED');
    const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
    const report = reports.body[0];
    await http('POST', `/reports/${report.id}/issue`, { token: admin.token });
    return { ...ids, reportId: report.id as string };
  };

  const status = async (assignmentId: string) => (await http('GET', `/assignments/${assignmentId}`, { token: admin.token })).body.status;

  it('only an issued report can be submitted', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'APPROVED');
    const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
    const early = await http('POST', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: reports.body[0].id, channel: 'COURIER', recipient: 'Docket 4471' } });
    expect(early.status).toBe(409);
  });

  it('records a courier hand-over, moves the assignment to SUBMITTED, and logs the acknowledgement separately', async () => {
    const ids = await issued();
    expect(await status(ids.assignmentId)).toBe('APPROVED');
    const sent = await http('POST', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: ids.reportId, channel: 'COURIER', recipient: 'Docket 4471, Panipat branch' } });
    expect(sent.status).toBe(201);
    expect(sent.body.submission.deliveryStatus).toBe('RECORDED');
    expect(sent.body.submission.acknowledgedAt).toBeNull();
    expect(sent.body.assignmentAdvanced).toBe(true);
    expect(await status(ids.assignmentId)).toBe('SUBMITTED');

    const ack = await http('POST', `/submissions/${sent.body.submission.id}/acknowledge`, { token: admin.token, json: { note: 'Received by branch manager' } });
    expect(ack.body.acknowledgedAt).not.toBeNull();
    expect((await http('POST', `/submissions/${sent.body.submission.id}/acknowledge`, { token: admin.token, json: { acknowledgedAt: '2099-01-01T00:00:00Z' } })).status).toBe(400);

    const list = await http('GET', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token });
    expect(list.body).toHaveLength(1);
  });

  it('refuses a foreign report and non-staff roles', async () => {
    const a = await issued();
    const b = await issued();
    const wrong = await http('POST', `/assignments/${a.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: b.reportId, channel: 'PORTAL', recipient: 'bank portal' } });
    expect(wrong.status).toBe(400);
    const reviewer = await makeUser(admin.token, 'REVIEWER');
    const denied = await http('POST', `/assignments/${a.assignmentId}/submissions`, { token: reviewer.token, json: { reportVersionId: a.reportId, channel: 'PORTAL', recipient: 'bank portal' } });
    expect(denied.status).toBe(403);
  });

  it.skipIf(!sink)('emails the PDF, records SENT (not delivered), and validates the address', async () => {
    const ids = await issued();
    const bad = await http('POST', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: ids.reportId, channel: 'EMAIL', recipient: 'not-an-email' } });
    expect(bad.status).toBe(400);

    const to = `branch-${Date.now()}@bank.test`;
    const sent = await http('POST', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: ids.reportId, channel: 'EMAIL', recipient: to, note: 'Kindly acknowledge.' } });
    expect(sent.status).toBe(201);
    expect(sent.body.submission.deliveryStatus).toBe('SENT');
    expect(sent.body.submission.messageId).toBeTruthy();
    expect(sent.body.submission.acknowledgedAt).toBeNull();

    const inbox = await (await fetch(sink!)).json();
    const mail = inbox.find((m: any) => m.to?.includes(to));
    expect(mail.subject).toContain(ids.assignmentId ? 'Valuation report' : '');
    expect(mail.text).toContain('Kindly acknowledge.');
    expect(mail.attachments[0]).toMatchObject({ type: 'application/pdf', head: '%PDF-' });
  });
});
