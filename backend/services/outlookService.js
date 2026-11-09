/**
 * @file outlookService.js
 * @description Backend for the simulated Outlook Smart Alert.
 *
 * PRODUCTION COUNTERPART: an Outlook event-based add-in subscribed to
 * `OnMessageSend`. The add-in calls this API and, when an alert is needed,
 * completes the event with
 *   event.completed({ allowEvent: false, errorMessage, cancelLabel: 'Deel als link',
 *                     sendModeOverride: Office.MailboxEnums.SendModeOverride.PromptUser })
 * PromptUser mode always offers "Toch verzenden": the civil servant stays in
 * control and can never be blocked from sending.
 *
 * Privacy: only attachment sizes and the recipient COUNT are evaluated.
 * Recipient addresses, subject and body never reach this server.
 */

import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { estimateAttachmentCloning, formatBand } from './co2Calculator.js';
import { presentEstimate, round } from './present.js';

const formatMb = (mb) => (mb >= 1024 ? `${round(mb / 1024, 1)} GB` : `${round(mb, 1)} MB`).replace('.', ',');

/**
 * @param {object} deps
 * @param {ReturnType<import('../graph/graphMock.js').createGraphMock>} deps.graph
 * @param {Readonly<Record<string, {low:number, high:number}>>} deps.coefficients
 * @param {ReturnType<import('./telemetry.js').createTelemetry>} deps.telemetry
 */
export function createOutlookService({ graph, coefficients: c, telemetry }) {
  /** Loads attachments (own files only) and runs the cloning calculation. */
  function analyse(actor, { fileIds, recipientCount }) {
    const files = fileIds.map((id) => graph.getMyFile(actor, id));
    if (files.some((f) => f.status !== 'active')) throw new HttpError(409, 'Een bijlage staat in de prullenbak.');
    const sizeMb = files.reduce((s, f) => s + f.size_mb, 0);
    const est = estimateAttachmentCloning({ sizeMb, recipients: recipientCount }, c);
    const alert = recipientCount > config.mail.recipientThreshold && sizeMb >= config.mail.minAttachmentMb;
    return { files, sizeMb, est, alert };
  }

  return {
    /** Called on "Verzenden": decides whether the Smart Alert dialog appears. */
    evaluateSend(actor, input) {
      const { files, sizeMb, est, alert } = analyse(actor, input);
      const annual = presentEstimate(est.annual);
      // One-off (not yearly), so it gets its own shape instead of `co2_per_year`.
      const transfer = { co2: formatBand(est.transfer.co2_g, 'co2'), kwh: formatBand(est.transfer.kwh, 'kwh') };
      const names = files.length === 1 ? `"${files[0].filename}"` : `${files.length} bijlagen`;

      return {
        alert,
        send_mode: alert ? 'promptUser' : 'allow',
        attachments: files.map((f) => ({ id: f.id, filename: f.filename, size_mb: f.size_mb, location: f.current_location })),
        recipient_count: input.recipientCount,
        copies: est.copies,
        amplification: est.amplification,
        duplicate_mb: round(est.duplicate_mb, 1),
        annual_storage: annual,
        one_off_transfer: transfer,
        message: alert
          ? `Je verstuurt ${names} (${formatMb(sizeMb)}) als bijlage naar ${input.recipientCount} mensen. ` +
            `Elke ontvanger krijgt een eigen kopie: samen ${formatMb(est.duplicate_mb)} in mailboxen (${est.amplification}× opslag). ` +
            `Deel je liever een link? Dat scheelt ${annual.co2_per_year.label} per jaar en iedereen werkt in dezelfde versie.`
          : null,
        options: alert
          ? [
            { id: 'share_link', label: 'Deel als link' },
            { id: 'send_anyway', label: 'Toch verzenden' },
            { id: 'cancel', label: 'Terug naar bericht' },
          ]
          : [],
      };
    },

    /** Records the user's choice (aggregated only) and returns sharing links if chosen. */
    resolve(actor, { decision, ...input }) {
      const { files, est } = analyse(actor, input);
      if (decision === 'share_link') {
        telemetry.record({ department: actor.department, event: 'mail_share_link', storageFreedMb: est.duplicate_mb, estimate: est.annual });
      } else if (decision === 'send_anyway') {
        telemetry.record({ department: actor.department, event: 'mail_send_anyway' });
      }
      return {
        decision,
        sent: decision !== 'cancel',
        sharing_links: decision === 'share_link'
          ? files.map((f) => ({
            filename: f.filename,
            // Fictional "people in Gemeente Amsterdam" sharing link.
            url: `https://amsterdam.sharepoint.example/:f:/r/${f.current_location === 'OneDrive' ? 'personal' : 'sites'}/${encodeURIComponent(f.filename)}?share=org`,
          }))
          : [],
        storage_avoided_mb: decision === 'share_link' ? round(est.duplicate_mb, 1) : 0,
      };
    },
  };
}
