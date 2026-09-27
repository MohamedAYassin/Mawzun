export async function sendEmail(
  toEmail: string,
  subject: string,
  textBody: string,
  htmlBody?: string,
  category?: string
): Promise<boolean> {
  const apiToken = process.env.MAILTRAP__APITOKEN || process.env.MAILTRAP_API_TOKEN;
  const senderEmail = process.env.MAILTRAP__SENDEREMAIL || process.env.MAILTRAP_SENDER_EMAIL || "hello@demomailtrap.co";
  const senderName = process.env.MAILTRAP__SENDERNAME || process.env.MAILTRAP_SENDER_NAME || "Mawzun";

  if (!apiToken) {
    console.warn("Mailtrap ApiToken is not configured. Email will not be sent. Check MAILTRAP__APITOKEN environment variable.");
    return false;
  }

  const requestUrl = "https://send.api.mailtrap.io/api/send";

  const payload = {
    from: {
      email: senderEmail,
      name: senderName
    },
    to: [
      { email: toEmail }
    ],
    subject: subject,
    text: textBody,
    html: htmlBody,
    category: category || "Integration Test"
  };

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const responseBody = await response.text();

    if (response.ok) {
      console.log(`Mailtrap Email sent successfully to ${toEmail}. Response: ${responseBody}`);
      return true;
    } else {
      console.error(`Mailtrap Email send failed for ${toEmail}. StatusCode: ${response.status}, Details: ${responseBody}`);
      return false;
    }
  } catch (err) {
    console.error(`Exception while sending email via Mailtrap to ${toEmail}.`, err);
    return false;
  }
}
