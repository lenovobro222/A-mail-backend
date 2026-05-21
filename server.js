const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

function genToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let t = '';
  for (let i = 0; i < 6; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

app.post('/send', async (req, res) => {
  try {
    const { recipientName, recipientEmail, docType, senderName, docContent, expiryHours } = req.body;
    const token = genToken();
    const expiresAt = new Date(Date.now() + (expiryHours || 72) * 60 * 60 * 1000);

    const { error } = await supabase.from('tokens').insert({
      token,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      doc_type: docType,
      sender_name: senderName,
      doc_content: docContent,
      expires_at: expiresAt.toISOString(),
      used: false
    });

    if (error) throw error;

    await resend.emails.send({
      from: 'A-mail <onboarding@resend.dev>',
      to: recipientEmail,
      subject: `Secure document from ${senderName} — Action required`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
          <div style="background:#1a1a16;padding:20px 28px;border-bottom:3px solid #c9921a;">
            <span style="font-family:Georgia,serif;font-size:28px;color:#f5f3ee;letter-spacing:3px;">A-mail</span>
          </div>
          <div style="padding:28px;background:#f5f3ee;border:1px solid #d4d0c4;">
            <p style="font-size:14px;color:#444;">Hello <strong>${recipientName}</strong>,</p>
            <p style="font-size:14px;color:#444;line-height:1.6;">You have a secure document from <strong>${senderName}</strong> waiting. No waiting 7-10 business days.</p>
            <div style="background:white;border:2px solid #1a1a16;padding:20px;text-align:center;margin:20px 0;">
              <p style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#888;margin-bottom:8px;">Your secure access token</p>
              <p style="font-family:monospace;font-size:36px;font-weight:bold;letter-spacing:12px;color:#1a1a16;margin:0;">${token}</p>
              <p style="font-size:11px;color:#888;margin-top:8px;">Single use · Expires in ${expiryHours || 72} hours</p>
            </div>
            <p style="font-size:14px;color:#444;">Visit <a href="${process.env.FRONTEND_URL}" style="color:#c9921a;">${process.env.FRONTEND_URL}</a> and enter your token to access your document instantly.</p>
          </div>
        </div>
      `
    });

    res.json({ success: true, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    const { data, error } = await supabase.from('tokens').select('*').eq('token', token).single();
    if (error || !data) return res.status(404).json({ error: 'Token not found' });
    if (data.used) return res.status(410).json({ error: 'Token already used' });
    if (new Date(data.expires_at) < new Date()) return res.status(410).json({ error: 'Token expired' });
    await supabase.from('tokens').update({ used: true }).eq('token', token);
    res.json({ success: true, recipientName: data.recipient_name, docType: data.doc_type, senderName: data.sender_name, docContent: data.doc_content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`A-mail backend running on port ${PORT}`));