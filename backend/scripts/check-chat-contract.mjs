import * as chat from '../src/models/chatModel.js';
import { readFileSync } from 'fs';

/**
 * Asserts the backend's wire shape against what client/src/components/chat
 * actually destructures. These seven mismatches were all silent failures -
 * `Array.isArray({conversations})` is false, `Number({unread:5})` is NaN - so
 * nothing would have thrown, the rail would just be empty.
 */

let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name} ${detail}`); failed++; }
};

console.log('toMessageDto');
const msg = chat.toMessageDto({
  id: 7, conversation_id: 1, sender_uid: 'email:a@x', sender_role: 'accounts',
  sender_name: 'Priya', body: 'hello',
  attachment_url: 'https://s3/x.png', attachment_name: 'x.png',
  attachment_type: 'image/png', attachment_size: '2048',
  client_id: 'c-1', created_at: '2026-01-01T00:00:00Z',
});
check('nested attachment object', msg.attachment && typeof msg.attachment === 'object');
check('attachment.url', msg.attachment.url === 'https://s3/x.png', msg.attachment?.url);
check('attachment.name', msg.attachment.name === 'x.png');
check('attachment.mime (not .type)', msg.attachment.mime === 'image/png');
check('attachment.size is a number', msg.attachment.size === 2048, typeof msg.attachment.size);
check('client_id present', msg.client_id === 'c-1');
check('no flat attachment_url leaks', msg.attachment_url === undefined);

const noAtt = chat.toMessageDto({ id: 8, conversation_id: 1, body: 'hi' });
check('attachment null when absent', noAtt.attachment === null);

const del = chat.toMessageDto({ id: 9, body: 'x', deleted_at: '2026-01-01T00:00:00Z' });
check('deleted message body is null', del.body === null, JSON.stringify(del.body));

console.log('toConversationDto');
const convo = chat.toConversationDto({
  id: 1, kind: 'group', title: 'Community', unread: 4, member_count: 12,
  last_message_id: 42, last_message_sender: 'email:b@x',
  last_message_body: 'hi all', last_message_at: '2026-01-01T00:00:00Z',
});
check('unread_count (not .unread)', convo.unread_count === 4, JSON.stringify(convo.unread_count));
check('unread not leaked', convo.unread === undefined);
check('nested last_message', convo.last_message && convo.last_message.id === 42);
check('last_message.body', convo.last_message.body === 'hi all');
check('member_count', convo.member_count === 12);

const empty = chat.toConversationDto({ id: 2, kind: 'direct', title: 'Priya', unread: 0 });
check('empty last_message is null', empty.last_message === null);
check('empty unread_count is 0', empty.unread_count === 0);

console.log('direct slug');
check('dm slug is order-independent', chat.directSlug('b', 'a') === chat.directSlug('a', 'b'));

// The notification type is a literal in two deployables with no shared module
// boundary. If these drift, the drawer's click handler silently stops matching
// chat rows and every chat notification becomes inert.
console.log('chat notification type');
const { CHAT_NOTIFICATION_TYPE: backendType } = await import(
  '../src/services/chatNotificationTypes.js'
);
const clientFile = new URL(
  '../../client/src/components/chat/chatNotificationTypes.js',
  import.meta.url
);
const clientSrc = readFileSync(clientFile, 'utf8');
const clientMatch = clientSrc.match(/CHAT_NOTIFICATION_TYPE\s*=\s*'([^']+)'/);
check('client file exists', !!clientMatch);
check(
  'client and backend agree on the type string',
  clientMatch?.[1] === backendType,
  `client=${clientMatch?.[1]} backend=${backendType}`
);

// notification_log.worker_id is a uuid with a foreign key into workers(id), so a
// subject_id that is not a worker uuid must never reach the insert. The Super
// Admin's subject_id is the literal '0'.
console.log('\nnotification recipient id');
const { notifyWorkerId } = await import('../src/services/chatNotificationTypes.js');
check('a real worker uuid passes through unchanged',
  notifyWorkerId('ab12cd34-ef56-7890-abcd-ef1234567890') === 'ab12cd34-ef56-7890-abcd-ef1234567890');
check("the Super Admin's '0' is dropped, not written", notifyWorkerId('0') === null);
check('a numeric worker id is dropped', notifyWorkerId('42') === null);
check('an empty id is dropped', notifyWorkerId('') === null);
check('undefined is dropped', notifyWorkerId(undefined) === null);
check('no client-side sentinel uuid is left behind',
  !clientSrc.includes('SUPER_ADMIN_NOTIFY_ID'));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
