import { useState } from 'react';

const TICKET_GATE = {
  username: 'jatinsevak@ufs',
  password: 'sevak123',
  sessionKey: 'ucs_ticket_unlocked',
};

export default function TicketGate({ title = 'Section', lead = 'This section is private. Enter the authorised username and password to view it.', children }) {
  const [locked, setLocked] = useState(() => sessionStorage.getItem(TICKET_GATE.sessionKey) !== '1');
  const [input, setInput] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);

  const unlock = (e) => {
    e.preventDefault();
    if (input.username.trim() === TICKET_GATE.username && input.password === TICKET_GATE.password) {
      sessionStorage.setItem(TICKET_GATE.sessionKey, '1');
      setLocked(false);
      setInput({ username: '', password: '' });
      setError('');
    } else {
      setError('Invalid username or password');
    }
  };

  const lock = () => {
    sessionStorage.removeItem(TICKET_GATE.sessionKey);
    setLocked(true);
    setInput({ username: '', password: '' });
    setError('');
  };

  if (locked) {
    return (
      <div style={{ maxWidth: 420, margin: '40px auto', padding: '28px 24px', background: 'var(--card-bg, #fff)', border: '1px solid var(--line, #e5e7eb)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 4 }}>{title} Section Locked</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 18, lineHeight: 1.5 }}>{lead}</div>
        <form onSubmit={unlock}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Username</label>
            <input
              value={input.username}
              onChange={e => setInput(p => ({ ...p, username: e.target.value }))}
              placeholder="Username"
              autoComplete="username"
              style={{ width: '100%', padding: '9px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 7, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: error ? 8 : 14 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Password</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={show ? 'text' : 'password'}
                value={input.password}
                onChange={e => setInput(p => ({ ...p, password: e.target.value }))}
                placeholder="Password"
                autoComplete="current-password"
                style={{ flex: 1, padding: '9px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 7, fontFamily: 'inherit' }}
              />
              <button type="button" onClick={() => setShow(s => !s)}
                style={{ padding: '0 12px', fontSize: 11, border: '1px solid #d1d5db', borderRadius: 7, background: '#fff', cursor: 'pointer', color: '#374151', fontFamily: 'inherit' }}>
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {error && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, background: '#fef2f2', border: '1px solid #fecaca', padding: '7px 10px', borderRadius: 6 }}>{error}</div>}
          <button type="submit" className="btn btn-sm btn-primary" style={{ width: '100%' }}>Unlock Section</button>
        </form>
      </div>
    );
  }

  return typeof children === 'function' ? children({ lock }) : children;
}