import nodemailer from 'nodemailer';

/** @typedef {import('../../ports/index.js').Config} Config */
/** @typedef {import('../../ports/index.js').Mailer} Mailer */

/**
 * @param {{ config: Config }} deps
 * @returns {Mailer}
 */
export function createMailer({ config }) {
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });

  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from: config.mailFrom, to, subject, text });
    },
  };
}
