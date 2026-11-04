import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

// Outbound email over SMTP. "Sent" only ever means the SMTP server accepted
// the message; it says nothing about delivery or that anyone read it.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport: Transporter | null = null;

  get isConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string }> {
    if (!this.isConfigured) throw new Error('Email is not configured (set SMTP_HOST and MAIL_FROM)');
    const info = await this.getTransport().sendMail({ from: process.env.MAIL_FROM, ...mail });
    this.logger.log(`Mail accepted: ${info.messageId}`);
    return { messageId: String(info.messageId) };
  }

  private getTransport(): Transporter {
    this.transport ??= createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
    });
    return this.transport;
  }
}
