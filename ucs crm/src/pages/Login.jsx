import { useState } from 'react'
import { useUcs } from '../store'


export default function Login({ onLogin }) {
  const { login, loginAsDemo } = useUcs()
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)


  const handleSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const data = await login(email, pass)
      onLogin?.((data.user?.department || data.user?.role || data.role)?.toLowerCase())
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDemo = () => {
    loginAsDemo('accounts')
    onLogin?.('accounts', '/accounts/beneficiaries')
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">UCS</div>
        <h1 className="login-title">CRM Portal</h1>
        <p className="login-sub">Sign in to your account</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label>Email / Login ID</label>
            <input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter your email" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Enter your password" required />
          </div>
          {err && <div className="login-error">{err}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <div className="login-demo">
          <button type="button" className="btn btn-demo" onClick={handleDemo}>
            Demo Login — Beneficiaries
          </button>
          <p>One-click demo, no backend needed</p>
        </div>
      </div>
    </div>
  )
}
