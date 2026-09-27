// Mailtrap email sender for the admin worker — mirrors Backend/src/utils/mail.ts
// (same env names, same fail-soft contract: log + return false, never throw).
// Used ONLY for the optional email copy of admin notifications; in-app rows
// are always written first and are never blocked by email failures.

export async function sendEmail(env: {
  MAILTRAP__APITOKEN?: string;
  MAILTRAP_API_TOKEN?: string;
  MAILTRAP__SENDEREMAIL?: string;
  MAILTRAP_SENDER_EMAIL?: string;
  MAILTRAP__SENDERNAME?: string;
  MAILTRAP_SENDER_NAME?: string;
}, toEmail: string, subject: string, textBody: string, htmlBody?: string, category?: string): Promise<boolean> {
  const apiToken = env.MAILTRAP__APITOKEN || env.MAILTRAP_API_TOKEN;
  const senderEmail = env.MAILTRAP__SENDEREMAIL || env.MAILTRAP_SENDER_EMAIL || "hello@demomailtrap.co";
  const senderName = env.MAILTRAP__SENDERNAME || env.MAILTRAP_SENDER_NAME || "Mawzun";

  if (!apiToken) {
    console.warn("Mailtrap ApiToken is not configured. Email will not be sent. Check MAILTRAP__APITOKEN environment variable.");
    return false;
  }

  const payload = {
    from: { email: senderEmail, name: senderName },
    to: [{ email: toEmail }],
    subject,
    text: textBody,
    html: htmlBody,
    category: category || "Admin Notification",
  };

  try {
    const response = await fetch("https://send.api.mailtrap.io/api/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Keep the admin request latency bounded even if Mailtrap stalls.
      signal: AbortSignal.timeout(10_000),
    });
    const responseBody = await response.text();
    if (response.ok) {
      console.log(`Mailtrap Email sent successfully to ${toEmail}. Response: ${responseBody}`);
      return true;
    }
    console.error(`Mailtrap Email send failed for ${toEmail}. StatusCode: ${response.status}, Details: ${responseBody}`);
    return false;
  } catch (err) {
    console.error(`Exception while sending email via Mailtrap to ${toEmail}.`, err);
    return false;
  }
}

export function notifEmailHtml(title: string, message: string, link?: string | null, company?: string | null): string {
  const appOrigin = "https://app.mawzun.org";
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#0b0e14;color:#dfe5f1;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#11151f;border:1px solid #232a3a;border-radius:8px;padding:24px">
<h2 style="margin:0 0 8px;font-size:18px">${escapeHtml(title)}</h2>
${company ? `<div style="color:#8a93a6;font-size:12px;margin-bottom:12px">Company: ${escapeHtml(company)}</div>` : ""}
<p style="font-size:14px;line-height:1.5;margin:0 0 16px">${escapeHtml(message)}</p>
${link ? `<a href="${appOrigin}${escapeHtml(link)}" style="display:inline-block;background:#4c8dff;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px">Open in Mawzun</a>` : ""}
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
