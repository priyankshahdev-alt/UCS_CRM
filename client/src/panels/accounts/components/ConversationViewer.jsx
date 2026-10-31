import { useEffect, useState } from 'react';
import { apiGet } from '../api/auth';
import WhatsAppThread from './WhatsAppThread';
import './whatsAppChat.css';

/**
 * Campaign recipient viewer.
 *
 * The old modal only listed messages, so clicking a number in a completed
 * campaign opened a dead-end. It now renders the same full WhatsApp thread the
 * Chats tab uses, which means an operator can reply, attach media, or send a
 * template straight from a campaign recipient row.
 */
export default function ConversationViewer({ phone, accountId, onClose }) {
  const [contactName, setContactName] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiGet('/whatsapp/chats')
      .then((data) => {
        if (cancelled) return;
        const digits = String(phone || '').replace(/\D/g, '');
        const match = (Array.isArray(data) ? data : []).find((thread) => String(thread.phone || '').replace(/\D/g, '') === digits);
        if (match?.recipientName) setContactName(match.recipientName);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [phone]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="wac-modal-overlay"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div className="wac-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="wac-root is-embedded is-chatting">
          <main className="wac-main">
            <WhatsAppThread
              phone={phone}
              accountId={accountId ? String(accountId) : undefined}
              contactName={contactName}
              onClose={onClose}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
