import { sendDocumentMessage, sendReceiptMessage, sendNgoInfoTemplate, sendTemplateMessage, sendTextMessage, sendMediaMessage, testConnection, resolveAccount, listTemplatesForAccount } from '../services/whatsappService.js';
import whatsappConfig from '../config/whatsappConfig.js';
import { getAccountById, getActiveAccounts } from '../models/whatsappAccountModel.js';
import { checkAttachmentReachable, describeUnreachableAttachment } from '../services/mediaReachability.js';
import { logOutboundMessage } from '../services/whatsappOutboundLog.js';
import { verifyReceiptFile, describeStoredObjectUrl, explainStoredObjectUrl } from '../services/receiptFileLink.js';
import db from '../config/db.js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const TEMPLATE_PROJECT_MAP = {
  bsct_receipt_2: 'bsct',
  mann_receipt: 'mann',
  aflf_receipt: 'aflf',
  ashray_receipt: 'aflf',
};

function phoneVariants(phone) {
  const raw = String(phone || '').replace(/\D/g, '');
  const values = new Set([raw]);
  if (raw.length === 10) values.add(`91${raw}`);
  if (raw.length === 12 && raw.startsWith('91')) values.add(raw.slice(2));
  return [...values].filter(Boolean);
}

function whatsappMessageId(result) {
  return result?.data?.messages?.[0]?.id || result?.messages?.[0]?.id || null;
}

// Meta's own status vocabulary, used verbatim in receipts.wa_status so the
// receipts list can render the exact state Meta is reporting without inventing
// a translation. `accepted` is ours: it means "Meta took the request", which is
// the last thing we can honestly claim at send time.
const WA_STATUS_RANK = { accepted: 1, sent: 2, delivered: 3, read: 4, failed: 0 };

// Stamps the delivery verdict onto the receipt row itself.
//
// This exists because recordReceiptInConversation() can only write a `messages`
// row when the donor already has a WhatsApp conversation with the NGO. A
// receipt sent to a first-time donor therefore has nowhere to record Meta's
// later failure, which is precisely how five sends died with the UI showing
// green. The receipt row is always there.
//
// Status updates are monotonic apart from `failed`: Meta can re-deliver after a
// transient failure, and an accepted/sent frame arriving out of order after a
// delivered one must not walk the state backwards. `failed` and a success frame
// are both allowed to win over whatever came before.
async function recordReceiptDelivery({ receiptId, receiptNo, project, wamid, status, failureReason }) {
  if (!receiptId && !(receiptNo && project)) return null;

  let patch = {
    wa_status: status,
    wa_status_at: new Date().toISOString(),
  };
  if (wamid) patch.wa_message_id = wamid;
  patch.wa_failure_reason = failureReason || null;
  // A failed send must not leave the receipt looking completed. Clearing the
  // sent flag is what puts it back in the pending queue for another attempt.
  if (status === 'failed') { patch.sent = false; patch.sent_at = null; }

  try {
    let targetId = receiptId || null;
    if (targetId) {
      await db.from('receipts').update(patch).eq('id', targetId);
    } else {
      const { data: match } = await db
        .from('receipts')
        .select('id, wa_status')
        .eq('receipt_no', receiptNo)
        .eq('project_id', project)
        .is('voided_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      const row = match?.[0];
      if (!row) return null;
      const incoming = WA_STATUS_RANK[status] ?? 1;
      const current = WA_STATUS_RANK[row.wa_status] ?? 0;
      if (status !== 'failed' && current > incoming) return row.id;
      targetId = row.id;
      await db.from('receipts').update(patch).eq('id', targetId);
    }
    return targetId;
  } catch (e) {
    // Delivery bookkeeping must never turn a successful send into a 500. The
    // wamid still lands in the conversation record and in the Meta logs.
    console.error('Failed to record receipt delivery status:', e.message);
    return null;
  }
}

// Refuses to send a template whose HEADER document Meta could not download.
//
// Without this the send returns 200, the panel reports success, and the
// receipt is silently lost to error 131053 minutes later. Returns an error
// message string when the attachment is unusable, or null when it is safe.
async function preflightAttachment(documentUrl) {
  const probe = await checkAttachmentReachable(documentUrl);
  if (probe.ok) return null;
  console.error('WhatsApp attachment preflight failed:', documentUrl, probe.status, probe.reason || '');
  return describeUnreachableAttachment(documentUrl, probe);
}

// Serves a receipt PDF to Meta, out of the private receipts bucket.
//
// Unauthenticated by necessity: Meta fetches the header document with a plain
// GET and cannot present a session token. The HMAC in the URL is the entire
// authorisation, which is why it is checked before any storage call and why an
// expired or tampered token returns 404 rather than a distinguishable error --
// this endpoint must not become an oracle for probing which receipt keys exist.
export async function serveReceiptFile(req, res) {
  let claim;
  try {
    claim = verifyReceiptFile(req.params.token);
  } catch (err) {
    console.warn(`[receipt-file] rejected: ${err.message}`);
    return res.status(404).json({ message: 'Not found' });
  }

  const { data, error } = await db
    .storage.from(claim.account, 'receipts')
    .readStream(claim.key);

  if (error || !data?.body) {
    const missing = /NoSuchKey|NotFound/i.test(String(error?.code || error?.message || ''));
    console.error(`[receipt-file] storage read failed for ${claim.key}: ${error?.code || error?.message}`);
    return res.status(missing ? 404 : 502).json({ message: missing ? 'Not found' : 'Receipt file could not be read' });
  }

  const filename = claim.key.split('/').pop() || 'receipt.pdf';
  res.setHeader('Content-Type', data.contentType || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/["\\]/g, '')}"`);
  if (Number.isFinite(data.contentLength)) res.setHeader('Content-Length', String(data.contentLength));
  // Signed, expiring, donor-specific: nothing here may be cached by a proxy.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const body = data.body;
  if (typeof body.pipe === 'function') {
    body.on('error', (e) => { console.error(`[receipt-file] stream failed: ${e.message}`); res.destroy(); });
    return body.pipe(res);
  }
  return res.send(Buffer.from(await body.transformToByteArray()));
}

// Accounts sends by phone number, whereas the FRO inbox reads the messages
// table by conversation. Record the successful receipt delivery against the
// donor's existing conversation so both teams see the same history.
async function recordReceiptInConversation({ phone, project, receiptNo, documentUrl, displayName, sentBy, result }) {
  try {
    const variants = phoneVariants(phone);
    if (!variants.length) return null;

    const { data: contacts, error: contactError } = await db
      .from('contacts')
      .select('id')
      .in('phone_normalized', variants);
    if (contactError || !contacts?.length) return null;

    let conversationQuery = db
      .from('conversations')
      .select('id, tenant_id, contact_id')
      .in('contact_id', contacts.map(contact => contact.id))
      .order('last_message_at', { ascending: false })
      .limit(1);
    if (project) conversationQuery = conversationQuery.eq('project', project);

    let { data: conversation, error: conversationError } = await conversationQuery.maybeSingle();
    // Older conversations may not have a project stored. Fall back to the
    // donor's latest conversation rather than hiding the receipt from the FRO.
    if (!conversation && !conversationError) {
      ({ data: conversation, error: conversationError } = await db
        .from('conversations')
        .select('id, tenant_id, contact_id')
        .in('contact_id', contacts.map(contact => contact.id))
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle());
    }
    if (conversationError || !conversation) return null;

    const { data: message, error: messageError } = await db
      .from('messages')
      .insert({
        tenant_id: conversation.tenant_id,
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
        user_id: sentBy ? String(sentBy) : null,
        direction: 'outbound',
        message_type: 'document',
        body_text: displayName || `Receipt_${receiptNo || 'receipt'}.pdf`,
        media_url: documentUrl,
        media_mime_type: 'application/pdf',
        wa_message_id: whatsappMessageId(result),
        status: 'sent',
        status_updated_at: new Date().toISOString(),
        message_category: 'template',
      })
      .select()
      .single();
    if (messageError) throw messageError;

    await db
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversation.id);
    return message;
  } catch (error) {
    // The donor has already received the receipt. Do not report that delivery
    // as failed solely because an older chat record could not be linked.
    console.error('Could not record receipt in WhatsApp conversation:', error.message);
    return null;
  }
}

export async function test(req, res) {
  try {
    const { to, accountId } = req.body;
    if (!to) return res.status(400).json({ message: 'Phone number is required' });

    let account = null;
    if (accountId) {
      account = await getAccountById(accountId);
      if (!account) return res.status(404).json({ message: 'Account not found' });
    }

    const result = await sendTextMessage(to, 'WhatsApp API is working! - UFS CRM', account);
    return res.json({ success: true, message: 'Test message sent', data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function sendReceipt(req, res) {
  try {
    const { logId } = req.params;
    const { mobile, number, pdfBase64, receiptNo: clientReceiptNo, donorName: clientDonorName, amount: clientAmount, templateName, project } = req.body;
    const phone = mobile || number;

    if (!phone) return res.status(400).json({ message: 'Donor phone number is required' });

    let donorName = clientDonorName || 'Donor';
    let amount = clientAmount || 0;
    let receiptNo = clientReceiptNo || 'N/A';
    let documentUrl = null;
    let uploadErrorMsg = null;
    let donorProject = project;
    let receiptId = null;

    if (logId && logId !== '0') {
      const { data: receiptRow } = await db
        .from('receipts')
        .select('id, receipt_no, pdf_url')
        .eq('log_id', logId)
        .maybeSingle();

      if (receiptRow) {
        receiptId = receiptRow.id;
        if (!clientReceiptNo) receiptNo = receiptRow.receipt_no || 'N/A';
        documentUrl = receiptRow.pdf_url || null;
      }

      if (!clientDonorName || !clientAmount || !donorProject || !receiptRow) {
        const { data: logs, error: logError } = await db
          .from('fro_donor_logs')
          .select(`
            amount_collected,
            fro_assignments(
              donor_id,
              donor_profiles(id, name, mobile_number, project_supported)
            )
          `)
          .eq('id', logId)
          .limit(1);

        const log = logs?.[0] || null;
        if (!logError && log) {
          const assignment = Array.isArray(log.fro_assignments) ? log.fro_assignments[0] : log.fro_assignments;
          const donor = Array.isArray(assignment?.donor_profiles) ? assignment?.donor_profiles[0] : assignment?.donor_profiles;
          if (!clientDonorName) donorName = donor?.name || 'Donor';
          if (!clientAmount) amount = log.amount_collected || 0;
          if (!donorProject) donorProject = donor?.project_supported || 'bsct';
        }
      }

      if (!documentUrl && pdfBase64) {
        try {
          const buffer = Buffer.from(pdfBase64, 'base64');
          const fileName = `receipts/${logId}_${Date.now()}.pdf`;
          const uploadController = new AbortController();
          const uploadTimeout = setTimeout(() => uploadController.abort(), 20000);

          let { data: uploadData, error: uploadError } = await db.storage
            .from('receipts')
            .upload(fileName, buffer, { contentType: 'application/pdf', upsert: true, signal: uploadController.signal });

          clearTimeout(uploadTimeout);

          if (uploadError) {
            if (uploadError.message?.includes('bucket')) {
              const { error: bucketError } = await db.storage.createBucket('receipts', { public: true });
              if (bucketError) throw new Error('Bucket create failed: ' + bucketError.message);
              const retry = await db.storage.from('receipts').upload(fileName, buffer, { contentType: 'application/pdf', upsert: true });
              if (retry.error) throw new Error('Upload failed after bucket create: ' + retry.error.message);
              uploadData = retry.data;
            } else {
              throw new Error('Upload failed: ' + uploadError.message);
            }
          }

          const { data: publicUrlData } = db.storage.from('receipts').getPublicUrl(fileName);
          documentUrl = publicUrlData?.publicUrl;

          if (documentUrl) {
            await db.from('receipts').update({ pdf_url: documentUrl }).eq('log_id', logId).maybeSingle();
          }
        } catch (e) {
          uploadErrorMsg = e.message;
          console.error('Receipt PDF upload failed:', e.message);
        }
      }
    }

    const account = await resolveAccount(donorProject);
    if (!account) return res.status(400).json({ message: `No WhatsApp account configured for project "${donorProject}"` });

    // Same guard as sendDirect: this path can be reached with a pdf_url written
    // by an older run against a bucket that no longer serves anonymous reads, and
    // a dead URL here is an invisible lost receipt rather than a visible error.
    //
    // The stored URL is a bucket URL, and the bucket denies anonymous reads, so
    // it cannot be handed to Meta as-is. Re-issue it as a time-limited S3
    // presigned URL: same bucket and object, credential moved into the URL so
    // nothing about the donor becomes world-readable.
    //
    // If the URL cannot be mapped back to a configured bucket and a signable key
    // there is no link to issue, and the send must stop. Falling through to probe
    // the raw bucket URL used to turn that into a 403 that read exactly like "the
    // bucket is not public" -- a wrong diagnosis that sent the operator off to
    // grant s3:GetObject to Principal "*" and would have published every donor
    // PAN and address in the bucket. So it is refused here, with the real reason.
    let attachmentUrl = documentUrl;
    if (documentUrl) {
      const located = describeStoredObjectUrl(documentUrl);
      if (!located) {
        return res.status(422).json({
          message: explainStoredObjectUrl(documentUrl),
          code: 'receipt_url_unlocatable',
          attachmentUrl: documentUrl,
        });
      }
      const presigned = await db.storage.from(located.account, 'receipts').presignDownload(located.key);
      if (presigned.error) {
        return res.status(500).json({ message: `Could not sign the receipt PDF: ${presigned.error.message}` });
      }
      attachmentUrl = presigned.data.url;
      const attachmentError = await preflightAttachment(attachmentUrl);
      if (attachmentError) {
        return res.status(422).json({ message: attachmentError, code: 'attachment_unreachable', attachmentUrl });
      }
    } else if (!uploadErrorMsg) {
      uploadErrorMsg = 'no receipt PDF was found for this donation';
    }

    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const result = await sendReceiptMessage(phone, donorName, amount, receiptNo, date, attachmentUrl, templateName, account);
    await recordReceiptDelivery({
      receiptId, receiptNo, project: donorProject,
      wamid: whatsappMessageId(result), status: 'accepted',
    });
    const displayName = `Receipt_${String(donorName || 'Donor').replace(/[<>:"/\\|?*]/g, '_').trim()}_${receiptNo || 'receipt'}.pdf`;
    const message = await recordReceiptInConversation({
      phone, project: donorProject, receiptNo, documentUrl: attachmentUrl, displayName, sentBy: req.user?.id, result,
    });

    return res.json({ success: true, message: 'Receipt sent via WhatsApp template', data: result, chatMessage: message, uploadError: uploadErrorMsg });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function sendNgoInfo(req, res) {
  try {
    const { to, name, project } = req.body;
    if (!to) return res.status(400).json({ message: 'Phone number is required' });

    const account = await resolveAccount(project);
    const result = await sendNgoInfoTemplate(to, name || 'Donor', account);
    return res.json({ success: true, message: 'NGO info sent', data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function sendCustomTemplate(req, res) {
  try {
    const { to, templateName, parameters, project } = req.body;
    if (!to || !templateName || !parameters) {
      return res.status(400).json({ message: 'to, templateName, and parameters are required' });
    }

    const account = await resolveAccount(project);
    const result = await sendTemplateMessage(to, templateName, parameters, undefined, account);
    return res.json({ success: true, message: 'Template message sent', data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function status(req, res) {
  try {
    const { accountId } = req.query;

    if (accountId) {
      const account = await getAccountById(accountId);
      if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
      const result = await testConnection(account);
      return res.json({ ...result, account: account.name, accountId: account.id });
    }

    const accounts = await getActiveAccounts();
    if (accounts.length > 0) {
      const results = await Promise.allSettled(
        accounts.map(async (acc) => {
          const r = await testConnection(acc);
          return { account: acc.name, accountId: acc.id, project: acc.project, ...r };
        })
      );
      return res.json(results.map(r => r.status === 'fulfilled' ? r.value : { success: false, message: r.reason?.message || 'Unknown error' }));
    }

    const result = await testConnection();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function sendDirect(req, res) {
  console.log("req", req)
  try {
    const {
      to,
      receiptNo,
      donorName,
      amount,
      templateName,
      templateLang,
      pdfBase64,
      project,
      receiptId,
    } = req.body;

    if (!to) {
      return res.status(400).json({
        message: 'Phone number is required',
      });
    }

    const phone = String(to).replace(/[^0-9]/g, '');
    const tpl = templateName || 'bsct_receipt_2';
    const lang = templateLang || 'en';
    const donorProject = project || TEMPLATE_PROJECT_MAP[tpl] || 'bsct';
    const account = await resolveAccount(donorProject);

    if (!account) {
      return res.status(400).json({
        message: `No WhatsApp account configured for project "${donorProject}"`,
      });
    }

    const ngoMap = {
      bsct_receipt_2: 'BeingSevak',
      mann_receipt: 'MannCare',
      aflf_receipt: 'Ashray',
      ashray_receipt: 'Ashray',
    };

    const ngoPrefix = ngoMap[tpl] || 'Receipt';

    let documentUrl = null;
    let displayName = null;
    let uploadError = null;

    // ---------------------------------------------------------
    // 1. CREATE / UPLOAD RECEIPT PDF
    // ---------------------------------------------------------

    if (pdfBase64) {
      try {
        const buffer = Buffer.from(pdfBase64, 'base64');

        const safeName = String(donorName || 'Donor')
          .replace(/[<>:"/\\|?*]/g, '_')
          .trim();

        displayName = `${ngoPrefix}_${safeName}_${receiptNo || 'receipt'}.pdf`;

        const storagePath = `receipts/${receiptNo || Date.now()}.pdf`;

        const store = db.storage.from('receipts');

        let { error: upErr } = await store.upload(
          storagePath,
          buffer,
          {
            contentType: 'application/pdf',
            upsert: true,
          }
        );

        if (upErr) {
          await db.storage.createBucket('receipts', {
            public: true,
          });

          const retry = await db.storage
            .from('receipts')
            .upload(
              storagePath,
              buffer,
              {
                contentType: 'application/pdf',
                upsert: true,
              }
            );

          upErr = retry.error;
        }

        if (upErr) {
          uploadError =
            upErr.message || 'PDF upload failed';
        } else if (!store.accountName) {
          uploadError =
            'PDF uploaded but no storage account is configured to serve it back';
        } else {
          const presigned =
            await store.presignDownload(storagePath);

          if (presigned.error) {
            uploadError =
              `could not create a download link: ${presigned.error.message}`;
          } else {
            documentUrl = presigned.data.url;
          }
        }
      } catch (e) {
        uploadError = e.message;
      }

      if (uploadError) {
        console.error(
          'Failed to store PDF:',
          uploadError
        );
      }
    } else {
      uploadError = 'no receipt PDF was supplied';
    }

    // ---------------------------------------------------------
    // 2. PDF IS REQUIRED
    // ---------------------------------------------------------

    if (!documentUrl) {
      return res.status(400).json({
        message:
          `Receipt PDF is required by template "${tpl}" but is unavailable: ${uploadError}`,
      });
    }

    // ---------------------------------------------------------
    // 3. CHECK PDF URL BEFORE SENDING TO META
    // ---------------------------------------------------------

    const attachmentError =
      await preflightAttachment(documentUrl);

    if (attachmentError) {
      return res.status(422).json({
        message: attachmentError,
        code: 'attachment_unreachable',
        attachmentUrl: documentUrl,
      });
    }

    // ---------------------------------------------------------
    // 4. WHATSAPP TEMPLATE COMPONENTS
    // ---------------------------------------------------------

    const components = [
      {
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: {
              link: documentUrl,
              filename:
                displayName || 'receipt.pdf',
            },
          },
        ],
      },
    ];

    // ---------------------------------------------------------
    // 5. BODY PARAMETER
    //
    // mann_receipt currently expects ONLY {{1}}
    //
    // {{1}} = donorName
    // ---------------------------------------------------------

    if (tpl === 'mann_receipt') {
      components.push({
        type: 'body',
        parameters: [
          {
            type: 'text',
            text: String(donorName || 'Donor'),
          },
        ],
      });
    }

    // ---------------------------------------------------------
    // 6. META WHATSAPP API URL
    // ---------------------------------------------------------

    const apiBase =
      `https://graph.facebook.com/${whatsappConfig.apiVersion}/${account.phone_number_id}/messages`;

    // ---------------------------------------------------------
    // 7. SEND MESSAGE TO WHATSAPP
    // ---------------------------------------------------------

    const msgRes = await fetch(apiBase, {
      method: 'POST',

      headers: {
        Authorization:
          `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
      },

      body: JSON.stringify({
        messaging_product: 'whatsapp',

        to: phone,

        type: 'template',

        template: {
          name: tpl,

          language: {
            code: lang,
          },

          components,
        },
      }),
    });

    // ---------------------------------------------------------
    // 8. READ META RESPONSE
    // ---------------------------------------------------------

    const msgText = await msgRes.text();

    if (!msgRes.ok) {
      console.error(
        'WhatsApp Meta API Error:',
        msgText
      );

      return res.status(400).json({
        success: false,
        message: msgText,
      });
    }

    const result = JSON.parse(msgText);

    // ---------------------------------------------------------
    // 9. SAVE WHATSAPP DELIVERY STATUS
    // ---------------------------------------------------------

    await recordReceiptDelivery({
      receiptId,
      receiptNo,
      project: donorProject,

      wamid: whatsappMessageId(result),

      status: 'accepted',
    });

    // ---------------------------------------------------------
    // 10. RECORD MESSAGE IN CONVERSATION
    // ---------------------------------------------------------

    const message =
      await recordReceiptInConversation({
        phone,

        project: donorProject,

        receiptNo,

        documentUrl,

        displayName,

        sentBy: req.user?.id,

        result,
      });

    // ---------------------------------------------------------
    // 11. SUCCESS RESPONSE
    // ---------------------------------------------------------

    return res.json({
      success: true,

      message:
        'Receipt sent via WhatsApp template',

      data: result,

      chatMessage: message,
    });

  } catch (error) {
    console.error(
      'sendDirect error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}
export async function listTemplates(req, res) {
  try {
    const { accountId } = req.query;

    if (accountId) {
      const account = await getAccountById(accountId);
      if (!account) return res.status(404).json({ message: 'Account not found' });
      const templates = await listTemplatesForAccount(account);
      return res.json(templates);
    }

    if (!whatsappConfig.enabled) {
      return res.json([]);
    }

    const wabaId = whatsappConfig.wabaId || '2529840587470683';
    const tplRes = await fetch(
      `https://graph.facebook.com/${whatsappConfig.apiVersion}/${wabaId}/message_templates?fields=name,language,status,components`,
      { headers: { Authorization: `Bearer ${whatsappConfig.accessToken}` } }
    );
    if (!tplRes.ok) { const e = await tplRes.text(); return res.status(400).json({ message: 'Meta API: ' + e }); }

    const { data } = await tplRes.json();
    const templates = (data || []).filter(t => t.status === 'APPROVED').map(t => ({
      name: t.name,
      language: t.language,
      components: t.components || [],
    }));
    return res.json(templates);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function getAccountHealth(req, res) {
  try {
    const account = await getAccountById(req.params.accountId);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    let meta = {};
    try {
      const r = await fetch(`https://graph.facebook.com/v18.0/${account.phone_number_id}?fields=quality_rating,verified_name,display_phone_number`, {
        headers: { Authorization: `Bearer ${account.access_token}` },
      });
      meta = await r.json();
    } catch (e) {
      meta = { error: e.message };
    }

    const { data: usage } = await db
      .from('whatsapp_bulk_recipients')
      .select('status')
      .eq('account_id', String(account.id));

    const sentToday = (usage || []).filter(x => x.status === 'sent' || x.status === 'delivered' || x.status === 'read').length;
    const failedToday = (usage || []).filter(x => x.status === 'failed').length;

    return res.json({
      account: { id: account.id, name: account.name, project: account.project },
      quality: meta.quality_rating || 'N/A',
      verifiedName: meta.verified_name || account.name,
      displayPhone: meta.display_phone_number || null,
      usage: { sent: sentToday, failed: failedToday, total: (usage || []).length },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function getConversationByPhone(req, res) {
  try {
    const phone = String(req.params.phone || '').replace(/[^0-9]/g, '');
    const accountId = req.query.accountId ? String(req.query.accountId) : null;
    if (!phone) return res.status(400).json({ message: 'phone required' });
    // find contact
    const { data: contacts } = await db.from('contacts').select('id').or(`phone.eq.${phone},phone_normalized.eq.${phone}`).limit(1);
    const contactId = contacts && contacts[0] ? contacts[0].id : null;
    // resolve account -> project for filtering
    let accountProject = null;
    if (accountId) {
      const { data: acc } = await db.from('whatsapp_accounts').select('project').eq('id', accountId).limit(1);
      if (acc && acc[0]) accountProject = acc[0].project || null;
    }
    let convIds = [];
    const convProjectMap = {};
    if (contactId) {
      const { data: convs } = await db.from('conversations').select('id,project,whatsapp_account_id').eq('contact_id', contactId).order('last_message_at', { ascending: false }).limit(20);
      if (convs) {
        for (const c of convs) {
          // if accountId filter, only include conversations matching that account's project or whatsapp_account_id
          if (accountId) {
            const matchAccount = (c.whatsapp_account_id && String(c.whatsapp_account_id) === accountId);
            const matchProject = accountProject && c.project === accountProject;
            if (!matchAccount && !matchProject) continue;
          }
          convIds.push(c.id);
          convProjectMap[c.id] = c.project || '';
        }
      }
    }
    let messages = [];
    if (convIds.length) {
      const { data: msgs } = await db.from('messages').select('id,direction,body_text,message_type,status,failure_reason,created_at,wa_message_id,media_url,media_mime_type,conversation_id').in('conversation_id', convIds).order('created_at', { ascending: true }).limit(200);
      messages = (msgs || []).map(m => ({ ...m, project: convProjectMap[m.conversation_id] || '' }));
    }
    // Also include bulk-sent template messages (stored in whatsapp_bulk_recipients)
    let bulkQ = db.from('whatsapp_bulk_recipients').select('id,template_name,phone,status,failure_reason,created_at,wa_message_id,status_updated_at,account_id').eq('phone', phone);
    if (accountId) bulkQ = bulkQ.eq('account_id', accountId);
    const { data: bulk } = await bulkQ.order('created_at', { ascending: true }).limit(200);
    // Pre-fetch template bodies for display
    const tplNames = [...new Set((bulk || []).map(b => b.template_name).filter(Boolean))];
    const tplMap = {};
    if (tplNames.length) {
      const { data: tpls } = await db.from('whatsapp_templates').select('name,components').in('name', tplNames);
      if (tpls) {
        for (const t of tpls) {
          const bodyComp = (t.components || []).find(c => String(c.type || '').toUpperCase() === 'BODY');
          const headerComp = (t.components || []).find(c => String(c.type || '').toUpperCase() === 'HEADER');
          const buttonsComp = (t.components || []).find(c => String(c.type || '').toUpperCase() === 'BUTTONS');
          tplMap[t.name] = {
            body: bodyComp ? (bodyComp.text || '') : '',
            header: headerComp || null,
            buttons: buttonsComp ? (buttonsComp.buttons || []) : [],
          };
        }
      }
    }
    if (bulk && bulk.length) {
      for (const b of bulk) {
        const tpl = tplMap[b.template_name] || {};
        const body = tpl.body || `[Template: ${b.template_name}]`;
        messages.push({
          id: b.id,
          direction: 'outbound',
          body_text: body,
          message_type: 'template',
          status: b.status || 'accepted',
          failure_reason: b.failure_reason || null,
          created_at: b.created_at,
          wa_message_id: b.wa_message_id,
          template_name: b.template_name,
          template_header: tpl.header || null,
          template_buttons: tpl.buttons || [],
        });
      }
    }
    // Presign S3 media URLs so the browser can load private objects
    const s3 = new S3Client({ region: process.env.S3_REGION || process.env.AWS_REGION || 'ap-south-1', credentials: process.env.AWS_ACCESS_KEY_ID ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } : undefined });
    const BUCKET = process.env.S3_BUCKET || 'ucs-crm-uploads-mumbai';
    const HOST = `${BUCKET}.s3.${process.env.S3_REGION || process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com`;
    await Promise.all(messages.map(async (m) => {
      if (m.media_url && m.media_url.includes(HOST)) {
        try {
          const key = new URL(m.media_url).pathname.replace(/^\//, '');
          const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
          m.media_url = url;
        } catch (e) { /* keep original */ }
      }
    }));
    messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return res.json({ phone, contactId, conversationId: convIds[0] || null, messages });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function validateWhatsAppContacts(req, res) {
  try {
    const { accountId, phones } = req.body || {};
    const account = await getAccountById(accountId);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    const list = Array.isArray(phones) ? phones : [];
    if (!list.length) return res.json({ valid: [], invalid: [] });

    const r = await fetch(`https://graph.facebook.com/v18.0/${account.phone_number_id}/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        blocking: 'wait',
        contacts: list,
        force_check: true,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      // Meta may reject the contacts-check operation for this number/token
      // (e.g. missing permission, on-premises number, restricted WABA).
      // Don't fail the whole request — fall back to "unknown" so the UI keeps working.
      console.warn('[validateWhatsAppContacts] Meta rejected contacts check:', data?.error?.message);
      // Meta contacts-check unavailable for this number/token. Don't mark everyone invalid —
      // keep all recipients as valid so bulk send still works; Meta will reject bad numbers at send time.
      return res.json({ valid: list, invalid: [], unknown: list, raw: [], validationUnavailable: true, metaError: data?.error?.message || 'Meta contact check failed' });
    }

    const valid = [];
    const invalid = [];
    for (const c of data.contacts || []) {
      if (c.status === 'valid') valid.push(c.input || c.wa_id);
      else invalid.push(c.input || c.input);
    }
    return res.json({ valid, invalid, raw: data.contacts || [] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function listBulkRecipientStatuses(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const { data, error } = await db
      .from('whatsapp_bulk_recipients')
      .select('wa_message_id, account_id, phone, recipient_name, template_name, status, failure_reason, status_updated_at, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function createCampaign(req, res) {
  try {
    const { name, accountId, templateName } = req.body || {};
    const { data, error } = await db.from('campaigns').insert({
      name: name || `Bulk Campaign ${new Date().toISOString().slice(0, 10)}`,
      channel: 'whatsapp',
      status: 'sending',
      account_id: accountId ? String(accountId) : null,
      template_name: templateName || null,
      started_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function listCampaigns(req, res) {
  try {
    const { data, error } = await db
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const campaigns = data || [];
    // attach recipient counts
    await Promise.all(campaigns.map(async (c) => {
      try {
        const { count } = await db
          .from('whatsapp_bulk_recipients')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', c.id);
        c.recipient_count = count || 0;
      } catch {
        c.recipient_count = 0;
      }
    }));
    return res.json(campaigns);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function getCampaign(req, res) {
  try {
    const { data: campaign, error } = await db
      .from('campaigns')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const { data: recipients } = await db
      .from('whatsapp_bulk_recipients')
      .select('*')
      .eq('campaign_id', req.params.id);

    return res.json({ campaign, recipients: recipients || [] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function sendBulkTemplate(req, res) {
  try {
    const { accountId, to, templateName, templateLang, parameters, headerImageUrl, headerFormat, recipientName, campaignId } = req.body;
    if (!to) return res.status(400).json({ success: false, message: 'Phone number is required' });

    const account = accountId ? await getAccountById(accountId) : await resolveAccount();
    if (!account) return res.status(400).json({ success: false, message: 'No WhatsApp account configured' });

    const tpl = templateName || account.template_name;
    if (!tpl) return res.status(400).json({ success: false, message: 'Template name is required' });

    const params = Array.isArray(parameters) ? parameters : [];
    const result = await sendTemplateMessage(to, tpl, params, templateLang || account.template_language || 'en', account, headerImageUrl, headerFormat);
    const messageId = result?.messages?.[0]?.id || result?.id || null;

    if (!messageId) {
      console.error('WhatsApp API returned no message ID:', result);
      return res.status(502).json({
        success: false,
        message: 'No WhatsApp message ID returned',
        result,
      });
    }

    const { error: insertErr } = await db.from('whatsapp_bulk_recipients').insert({
      account_id: account.id,
      campaign_id: campaignId || null,
      template_name: tpl,
      recipient_name: req.body.recipientName || null,
      phone: String(to).replace(/[^0-9]/g, ''),
      wa_message_id: messageId,
      status: 'accepted',
    });

    if (insertErr) {
      console.error('Bulk recipient log insert failed:', insertErr.message);
    }

    return res.json({
      success: true,
      status: 'accepted',
      messageId,
      result,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
export async function listChats(req, res) {
  try {
    const accountId = req.query.accountId ? String(req.query.accountId) : null;
    let accountProject = null;
    if (accountId) {
      const { data: acc } = await db.from('whatsapp_accounts').select('project,name').eq('id', accountId).limit(1);
      if (acc && acc[0]) accountProject = acc[0].project || null;
    }
    const byPhone = new Map();
    const upsert = (phone, candidate) => {
      const cur = byPhone.get(phone);
      const mergedName = candidate.recipientName || (cur && cur.recipientName) || '';
      if (!cur || new Date(candidate.lastAt) > new Date(cur.lastAt)) byPhone.set(phone, { ...cur, ...candidate, recipientName: mergedName });
      else if (mergedName && !(cur && cur.recipientName)) byPhone.set(phone, { ...cur, recipientName: mergedName });
    };
    const { data: convs } = await db.from('conversations').select('id,project,whatsapp_account_id,contact_id,last_message_at').order('last_message_at', { ascending: false }).limit(500);
    const contactIds = [...new Set((convs || []).map(c => c.contact_id).filter(Boolean))];
    const contactMap = {};
    if (contactIds.length) {
      const { data: contacts } = await db.from('contacts').select('id,phone,phone_normalized,name,wa_profile_name').in('id', contactIds);
      for (const c of contacts || []) contactMap[c.id] = c;
    }
    const accountIds = [...new Set((convs || []).map(c => c.whatsapp_account_id).filter(Boolean))];
    const accountMap = {};
    if (accountIds.length) {
      const { data: accs } = await db.from('whatsapp_accounts').select('id,name,project').in('id', accountIds);
      for (const a of accs || []) accountMap[a.id] = a;
    }
    for (const c of convs || []) {
      const contact = contactMap[c.contact_id];
      const phone = (contact?.phone_normalized || contact?.phone || '').replace(/[^0-9]/g, '');
      if (!phone) continue;
      if (accountId) {
        const matchAccount = c.whatsapp_account_id && String(c.whatsapp_account_id) === accountId;
        const matchProject = accountProject && c.project === accountProject;
        if (!matchAccount && !matchProject) continue;
      }
      const acc = c.whatsapp_account_id ? accountMap[c.whatsapp_account_id] : null;
      upsert(phone, { phone, lastAt: c.last_message_at || new Date().toISOString(), lastMessage: '', direction: 'inbound', accountId: c.whatsapp_account_id || null, accountName: acc?.name || c.project || '', project: c.project || '', recipientName: contact?.name || contact?.wa_profile_name || '' });
    }
    let bulkQ = db.from('whatsapp_bulk_recipients').select('phone,account_id,template_name,status,created_at').order('created_at', { ascending: false }).limit(1000);
    if (accountId) bulkQ = bulkQ.eq('account_id', accountId);
    const { data: bulk } = await bulkQ;
    const bulkAccountIds = [...new Set((bulk || []).map(b => b.account_id).filter(Boolean))];
    const bulkAccountMap = {};
    if (bulkAccountIds.length) {
      const { data: accs } = await db.from('whatsapp_accounts').select('id,name,project').in('id', bulkAccountIds);
      for (const a of accs || []) bulkAccountMap[a.id] = a;
    }
    for (const b of bulk || []) {
      const phone = String(b.phone || '').replace(/[^0-9]/g, '');
      if (!phone) continue;
      const acc = b.account_id ? bulkAccountMap[b.account_id] : null;
      upsert(phone, { phone, lastAt: b.created_at, lastMessage: b.template_name ? `[Template: ${b.template_name}]` : '', direction: 'outbound', status: b.status || 'accepted', accountId: b.account_id || null, accountName: acc?.name || '', project: acc?.project || '', recipientName: b.recipient_name || '' });
    }
    const convPhoneMap = {};
    for (const c of convs || []) {
      const contact = contactMap[c.contact_id];
      const phone = (contact?.phone_normalized || contact?.phone || '').replace(/[^0-9]/g, '');
      if (phone) convPhoneMap[c.id] = phone;
    }
    const convIds = (convs || []).map(c => c.id);
    if (convIds.length) {
      const { data: msgs } = await db.from('messages').select('conversation_id,body_text,direction,created_at').in('conversation_id', convIds).order('created_at', { ascending: false }).limit(10000);
      const latestByPhone = {};
      const lastInboundByPhone = {};
      for (const m of msgs || []) {
        const ph = convPhoneMap[m.conversation_id];
        if (!ph) continue;
        if (!latestByPhone[ph] || new Date(m.created_at) > new Date(latestByPhone[ph].created_at)) latestByPhone[ph] = m;
        if (m.direction === 'inbound' && (!lastInboundByPhone[ph] || new Date(m.created_at) > new Date(lastInboundByPhone[ph].created_at))) lastInboundByPhone[ph] = m;
      }
      for (const ph of byPhone.keys()) {
        const m = latestByPhone[ph];
        const cur = byPhone.get(ph);
        if (m && cur && (!cur.lastMessage || new Date(m.created_at) >= new Date(cur.lastAt))) byPhone.set(ph, { ...cur, lastMessage: (m.body_text || '').slice(0, 80), lastAt: m.created_at, direction: m.direction || cur.direction });
        const ib = lastInboundByPhone[ph];
        const cur2 = byPhone.get(ph);
        if (cur2) byPhone.set(ph, { ...cur2, hasReply: !!ib, replyText: ib ? (ib.body_text || '').slice(0, 200) : '', lastReplyAt: ib ? ib.created_at : null });
      }
    }
    const list = [...byPhone.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)).slice(0, 200);
    return res.json(list);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}
export async function sendText(req, res) {
  try {
    const { to, text, accountId } = req.body || {};
    if (!to || !text || !String(text).trim()) {
      return res.status(400).json({ message: 'Phone and text are required' });
    }
    const phone = String(to).replace(/[^0-9]/g, '');
    const account = accountId ? await getAccountById(accountId) : await resolveAccount();
    if (!account) return res.status(400).json({ message: 'No WhatsApp account configured' });
    const trimmed = String(text).trim();
    const result = await sendTextMessage(phone, trimmed, account);
    await logOutboundMessage({
      account,
      phone,
      messageType: 'text',
      bodyText: trimmed,
      waMessageId: whatsappMessageId(result),
      status: 'sent',
    });
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

export async function sendMedia(req, res) {
  try {
    const { to, accountId, mediaUrl, mediaType, mediaMimeType, caption } = req.body || {};
    if (!to || !mediaUrl) return res.status(400).json({ message: 'Phone and mediaUrl are required' });
    const phone = String(to).replace(/[^0-9]/g, '');
    const account = accountId ? await getAccountById(accountId) : await resolveAccount();
    if (!account) return res.status(400).json({ message: 'No WhatsApp account configured' });
    const result = await sendMediaMessage(phone, mediaUrl, mediaType || 'image', caption || '', account);
    await logOutboundMessage({
      account,
      phone,
      messageType: mediaType || 'image',
      bodyText: caption || `[${(mediaType || 'image').charAt(0).toUpperCase()}${(mediaType || 'image').slice(1)}]`,
      waMessageId: whatsappMessageId(result),
      mediaUrl,
      mediaMimeType: mediaMimeType || null,
      status: 'sent',
    });
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}
