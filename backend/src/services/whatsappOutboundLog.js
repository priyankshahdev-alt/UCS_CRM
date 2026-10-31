import db from '../config/db.js';

/**
 * Persist an outbound WhatsApp send into the same contacts/conversations/messages
 * tables the inbox and the webhook use.
 *
 * Accounts > WhatsApp > Chats used to call Meta directly and never write the
 * message down, so a sent reply vanished the moment the thread reloaded. The FRO
 * inbox already stores its sends; this helper gives the admin inbox the same
 * behaviour without touching the FRO-specific agent/assignment logic.
 *
 * Logging is best-effort: a persistence failure must never turn a successful
 * Meta send into a failed one.
 */
export async function logOutboundMessage({
  account,
  phone,
  messageType = 'text',
  bodyText = '',
  waMessageId = null,
  mediaUrl = null,
  mediaMimeType = null,
  status = 'sent',
  failureReason = null,
}) {
  try {
    const phoneNormalized = String(phone || '').replace(/[^0-9]/g, '');
    if (!phoneNormalized) return null;

    const project = account?.project || null;

    let { data: contact } = await db
      .from('contacts')
      .select('*')
      .eq('phone_normalized', phoneNormalized)
      .maybeSingle();

    if (!contact) {
      const { data: created, error } = await db
        .from('contacts')
        .insert({
          phone: phoneNormalized,
          phone_normalized: phoneNormalized,
          source: 'whatsapp',
          project,
        })
        .select()
        .single();

      if (error) {
        // A concurrent webhook insert can win the race; fall back to reading it.
        const { data: existing } = await db
          .from('contacts')
          .select('*')
          .eq('phone_normalized', phoneNormalized)
          .maybeSingle();
        contact = existing;
      } else {
        contact = created;
      }
    }

    if (!contact) return null;

    let conversation = null;
    const { data: matches } = await db
      .from('conversations')
      .select('*')
      .eq('contact_id', contact.id)
      .eq('status', 'open')
      .order('last_message_at', { ascending: false })
      .limit(5);

    if (Array.isArray(matches)) {
      conversation = matches.find((c) => (project ? c.project === project : !c.project)) || null;
      if (!conversation && matches.length === 1) conversation = matches[0];
    }

    if (!conversation) {
      const { data: createdConversation, error: convErr } = await db
        .from('conversations')
        .insert({
          contact_id: contact.id,
          status: 'open',
          last_message_at: new Date().toISOString(),
          project,
          whatsapp_account_id: account?.id || null,
        })
        .select()
        .single();

      if (convErr) {
        const { data: existingConversation } = await db
          .from('conversations')
          .select('*')
          .eq('contact_id', contact.id)
          .eq('status', 'open')
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        conversation = existingConversation || null;
      } else {
        conversation = createdConversation;
      }
    }

    if (!conversation) return null;

    const { data: message, error: msgErr } = await db
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        contact_id: contact.id,
        direction: 'outbound',
        message_type: messageType,
        body_text: bodyText || null,
        wa_message_id: waMessageId || null,
        media_url: mediaUrl || null,
        media_mime_type: mediaMimeType || null,
        status: status || 'sent',
        failure_reason: failureReason || null,
        message_category: 'service',
      })
      .select()
      .single();

    if (msgErr) {
      console.error('[whatsappOutboundLog] message insert failed:', msgErr.message);
      return null;
    }

    await db
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversation.id);

    return message;
  } catch (err) {
    console.error('[whatsappOutboundLog] failed:', err?.message || err);
    return null;
  }
}
