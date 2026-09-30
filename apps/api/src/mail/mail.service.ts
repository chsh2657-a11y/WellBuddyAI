import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * 메일 발송. SMTP_HOST 가 없으면 실제로 보내지 않고 로그로 남긴다(개발·테스트).
 * 테스트는 outbox 로 보낸 메일을 확인할 수 있다.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transporter: Transporter | null;
  readonly outbox: MailMessage[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const { host, port, user, pass } = config.mail;
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: user ? { user, pass } : undefined,
        })
      : null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.outbox.push(message);
      if (this.outbox.length > 100) this.outbox.shift();
      if (this.config.env !== 'test') {
        this.logger.log(
          `(발송 생략: SMTP 미설정) to=${message.to} subject=${message.subject}\n${message.text}`,
        );
      }
      return;
    }
    await this.transporter.sendMail({ from: this.config.mail.from, ...message });
  }
}
