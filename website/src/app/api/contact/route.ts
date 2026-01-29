import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

async function getResendClient() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found');
  }

  const connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || !connectionSettings.settings.api_key) {
    throw new Error('Resend not connected');
  }

  return {
    client: new Resend(connectionSettings.settings.api_key),
    fromEmail: connectionSettings.settings.from_email || 'onboarding@resend.dev'
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, company, phone, message, formType } = body;

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    const { client, fromEmail } = await getResendClient();

    const subject = formType === 'demo' 
      ? `Demo Request from ${name} at ${company || 'N/A'}`
      : `Contact Form Submission from ${name}`;

    const htmlContent = `
      <h2>${formType === 'demo' ? 'New Demo Request' : 'New Contact Form Submission'}</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      ${company ? `<p><strong>Company:</strong> ${company}</p>` : ''}
      ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
      ${message ? `<p><strong>Message:</strong></p><p>${message}</p>` : ''}
      <hr>
      <p><em>Submitted via ComplyVerse website</em></p>
    `;

    await client.emails.send({
      from: fromEmail,
      to: ['hello@complyverse.io'],
      replyTo: email,
      subject: subject,
      html: htmlContent,
    });

    const confirmationHtml = `
      <h2>Thank you for your interest in ComplyVerse!</h2>
      <p>Hi ${name},</p>
      <p>We've received your ${formType === 'demo' ? 'demo request' : 'message'} and will get back to you within 24 hours.</p>
      <p>In the meantime, feel free to explore our <a href="https://complyverse.io/features">features</a> page to learn more about what ComplyVerse can do for your organization.</p>
      <br>
      <p>Best regards,</p>
      <p>The ComplyVerse Team</p>
    `;

    await client.emails.send({
      from: fromEmail,
      to: [email],
      subject: 'Thank you for contacting ComplyVerse',
      html: confirmationHtml,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Email send error:', error);
    return NextResponse.json(
      { error: 'Failed to send email. Please try again later.' },
      { status: 500 }
    );
  }
}
