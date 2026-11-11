import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  close?(): Promise<void>;
}

/** Transporte en memoria para tests: los mensajes quedan en `outbox`. */
export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];
  send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    return Promise.resolve();
  }
  clear(): void {
    this.outbox.length = 0;
  }
}

/** Transporte de desarrollo: imprime el email por consola (incluye enlaces con tokens; solo para desarrollo). */
export class ConsoleMailer implements Mailer {
  send(message: MailMessage): Promise<void> {
    console.log(`\n=== EMAIL (desarrollo) ===\nPara: ${message.to}\nAsunto: ${message.subject}\n\n${message.text}\n==========================\n`);
    return Promise.resolve();
  }
}

export class SmtpMailer implements Mailer {
  private transporter: Transporter;
  constructor(
    private readonly from: string,
    smtp: NonNullable<Config['mail']['smtp']>,
  ) {
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      requireTLS: !smtp.secure,
      // Timeouts explícitos: un SMTP colgado no debe retener el worker indefinidamente.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      dnsTimeout: 10_000,
    });
  }
  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
  close(): Promise<void> {
    this.transporter.close();
    return Promise.resolve();
  }
}

export function createMailer(config: Config): Mailer {
  switch (config.mail.transport) {
    case 'memory':
      return new MemoryMailer();
    case 'console':
      return new ConsoleMailer();
    case 'smtp':
      return new SmtpMailer(config.mail.from, config.mail.smtp!);
  }
}
