import { Injectable } from '@nestjs/common';

// src/mail/mail.service.ts
type SendMailArgs = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  fromName?: string;
};

@Injectable()
export class MailService {
  private baseUrl = (process.env.EMAIL_API_BASE_URL || '').replace(/\/$/, '');
  private defaultFromName = process.env.EMAIL_FROM_NAME || 'ToDo Premium';
  private apiKey = process.env.EMAIL_API_KEY || '';

  async send(args: SendMailArgs) {
    const { to, subject, text, html } = args;
    if (!this.baseUrl) throw new Error('EMAIL_API_BASE_URL is missing');
    if (!to || !subject) throw new Error('Missing to/subject');
    if (!text && !html) throw new Error('Missing text/html');

    const qs = new URLSearchParams();
    qs.set('to', to);
    qs.set('subject', subject);
    if (text) qs.set('text', text);
    if (html) qs.set('html', html);
    qs.set('fromName', args.fromName || this.defaultFromName);

    const url = `${this.baseUrl}/index.php/send?${qs.toString()}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.apiKey ? { 'X-Api-Key': this.apiKey } : undefined,
    });

    const raw = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { ok: false, raw };
    }

    if (!res.ok || !data?.ok) {
      throw new Error(`Email send failed: ${raw}`);
    }

    return data; // { ok:true, message:"SENT" }
  }
}