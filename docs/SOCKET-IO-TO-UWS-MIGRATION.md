# Socket.IO -> uWebSockets.js Migration

## Status
Core transport migrated behind `REALTIME_TRANSPORT` (default `uws`). Legacy Socket.IO
implementation retained in `backend/src/realtime/socketio.legacy.js` and
`client/src/lib/socket.io.legacy.js` for rollback.

## Audit summary (Phase 1)
- Backend integration: `backend/src/socket.js` (initRealtime, emitDbChange, emitChat,
  emitChatBroadcast, emitChatToUsers, emitRealtime, isWorkerOnline, getOnlineWorkerIds).
- Client integration: `client/src/lib/socket.js` (getSocket, reconnectSocket, onDbChange,
  onFroAction, onFroBroadcast, onFroTeamBroadcast, onFroForceLogout, onFroPause,
  onFroResume, onSocketConnect).
- Consumers: meetingStore, useRealtime, FROPanel, CallContext, chatApi, RejectedLeads,
  Dashboard (ngo-admin), WhatsAppInbox.
- Auth: JWT via `socket.handshake.auth.token` / Authorization header (backend).
  New transport authenticates with a first `auth` message carrying the JWT; the token
  is never placed in the query string.
- Rooms/topics: `role:<role>`, `worker:<id>`, `voting`, `chat:<conversation_id>`,
  `chatuser:<uid>`.
- Presence: in-process `workerSockets` map (single process). Unchanged semantics.
- DB broadcast: `backend/src/config/db.js` REALTIME_TABLES + bulk coalescing unchanged.

## Event mapping (old Socket.IO event -> new WS message `type`)
| Old event | New type | Scope |
|---|---|---|
| db:change | db:change | broadcast all authed |
| chat:message | chat:message | room `chat:<id>` or broadcast |
| chat:typing | chat:typing | room `chat:<id>` (relayed) |
| fro:action | fro:action | room/broadcast |
| fro:broadcast | fro:broadcast | role:fro |
| fro:team-broadcast | fro:team-broadcast | role:fro |
| fro:force-logout | fro:force-logout | worker:<id> |
| fro:pause | fro:pause | worker:<id> |
| fro:resume | fro:resume | worker:<id> |
| voting:update | voting:update | VOTING_ROOM (broadcast) |

Message envelope: `{ "type": "<event>", "payload": <same payload as before> }`.

## Architecture
- Express backend on PORT (default 5000) keeps REST/auth/DB.
- uWebSockets.js service on WS_PORT (default 5001) handles persistent connections.
- Frontend uses browser native WebSocket via `client/src/lib/socket.js`.
- PostgreSQL unchanged.

## Environment
Backend `.env`:
- `PORT=5000`
- `WS_PORT=5001`
- `WS_HOST=0.0.0.0`
- `REALTIME_TRANSPORT=uws` (or `socketio` for rollback)
- `WS_ALLOWED_ORIGINS` (optional, comma-separated; defaults to `*`)
- `RT_BULK_FLUSH_MS` (existing)

Client `.env`:
- `VITE_API_URL`
- `VITE_SOCKET_URL` (legacy fallback)
- `VITE_WS_URL=ws://host:5001` for plain-HTTP dev, or `wss://host/ws` behind the
  reverse proxy. uWS has no TLS: an HTTPS page must use the proxied `/ws` path,
  never `wss://host:5001`.
- `VITE_WS_PORT` (optional)

**LAN development** (backend + realtime on `192.168.1.152`, Vite dev server on
`192.168.1.154:5173`): the client derives the socket host from `VITE_SOCKET_URL` /
`VITE_API_URL`, never from `window.location`, so a phone loading the app from
`.154` still connects to `.152:5001`. `vite.config.js` binds `server.host = true`
so the dev server is reachable from other devices; the backend already listens on
`0.0.0.0` for both ports and allows any origin by default.

## Security
- Origin validated on upgrade against `WS_ALLOWED_ORIGINS`.
- JWT validated on first `auth` message; no token in query string.
- Auth timeout 10s; unauthenticated sockets closed.
- Message size limit 1MB; idle timeout 120s.
- Identity/rooms resolved server-side from JWT, not client input.
- Chat typing relay only into rooms the sender joined.

## Reliability
- Reconnection with bounded exponential backoff + jitter (client).
- On reconnect, client re-authenticates; server re-joins rooms based on JWT.
- Missed events: client should refetch authoritative state via REST (existing behavior).
- Duplicate DB writes avoided: transport never drives business logic.

## Performance
Baseline and post-migration measurements to be recorded per Phase 9. The e2e probe
(`backend/scripts/e2e-verify-realtime.mjs`) passes against uWS.

## Rollback
Set `REALTIME_TRANSPORT=socketio`, restart backend, and point client `VITE_WS_URL` back
to the Socket.IO origin (or revert client to `socket.io.legacy.js`). Socket.IO code
and dependency remain installed.
"
