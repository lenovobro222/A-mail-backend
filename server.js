const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const multer = require('multer');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.options('*', cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

function genToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let t = '';
  for (let i = 0; i < 6; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

app.get('/', (req, res) => res.json({ status: 'ok', message: 'A-mail backend running' }));
app.get('/health', (req, res) => res.json({ status: 'ok', message: 'A-mail backend running' }));

app.post('/send', upload.single('file'), async (req, res) => {
  try {
    const { recipientName, recipientEmail, docType, senderName, docContent, expiryHours } = req.body;
    if (!recipientName || !recipientEmail || !docType) return res.status(400).json({ error: 'Missing required fields' });

    const token = genToken();
    const expiresAt = new Date(Date.now() + (parseInt(expiryHours) || 72) * 60 * 60 * 1000);
    let fileUrl = null, fileName = null, fileType = null;

    if (req.file) {
      fileName = token + '-' + req.file.originalname;
      fileType = req.file.mimetype;
      const { error: uploadError } = await supabase.storage.from('documents').upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (uploadError) throw new Error('File upload error: ' + uploadError.message);
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(fileName);
      fileUrl = urlData.publicUrl;
    }

    const { error: dbError } = await supabase.from('tokens').insert({
      token, recipient_name: recipientName, recipient_email: recipientEmail,
      doc_type: docType, sender_name: senderName, doc_content: docContent || '',
      expires_at: expiresAt.toISOString(), used: false,
      file_url: fileUrl, file_name: fileName, file_type: fileType
    });
    if (dbError) throw new Error('Database error: ' + dbError.message);

    await resend.emails.send({
      from: 'A-mail <onboarding@resend.dev>',
      to: recipientEmail,
      subject: 'Secure document from ' + senderName + ' — Action required',
      html: '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;"><div style="background:#1a1a16;padding:20px 28px;border-bottom:3px solid #c9921a;"><span style="font-size:28px;color:#f5f3ee;font-weight:bold;">A-mail</span></div><div style="padding:28px;background:#f5f3ee;"><p>Hello <strong>' + recipientName + '</strong>,</p><p style="margin:12px 0;">You have a secure document from <strong>' + senderName + '</strong> waiting.</p><div style="background:white;border:2px solid #1a1a16;padding:20px;text-align:center;margin:20px 0;"><p style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#888;">Your secure access token</p><p style="font-family:monospace;font-size:36px;font-weight:bold;letter-spacing:12px;color:#1a1a16;margin:8px 0;">' + token + '</p><p style="font-size:11px;color:#888;">Single use · Expires in ' + (expiryHours || 72) + ' hours</p></div>' + (req.file ? '<p style="background:#f0f7e8;padding:10px;border-left:3px solid #1a6b3a;">📎 ' + req.file.originalname + '</p>' : '') + '<p>Visit <a href="' + process.env.FRONTEND_URL + '" style="color:#c9921a;">' + process.env.FRONTEND_URL + '</a> and enter your token under Recipient Access.</p></div></div>'
    });

    res.json({ success: true, token, hasFile: !!req.file });
  } catch (e) {
    console.error('Send error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const { data, error } = await supabase.from('tokens').select('*').eq('token', token.toUpperCase()).single();
    if (error || !data) return res.status(404).json({ error: 'Token not found' });
    if (data.used) return res.status(410).json({ error: 'Token already used' });
    if (new Date(data.expires_at) < new Date()) return res.status(410).json({ error: 'Token expired' });

    await supabase.from('tokens').update({ used: true }).eq('token', token.toUpperCase());

    let signedFileUrl = null;
    if (data.file_name) {
      const { data: signedData } = await supabase.storage.from('documents').createSignedUrl(data.file_name, 3600);
      if (signedData) signedFileUrl = signedData.signedUrl;
    }

    res.json({
      success: true,
      recipientName: data.recipient_name, docType: data.doc_type,
      senderName: data.sender_name, docContent: data.doc_content,
      fileUrl: signedFileUrl,
      fileName: data.file_name ? data.file_name.replace(token.toUpperCase() + '-', '') : null,
      fileType: data.file_type
    });
  } catch (e) {
    console.error('Verify error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('A-mail backend running on port ' + PORT));