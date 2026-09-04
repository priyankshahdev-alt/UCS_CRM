import { useState, useEffect } from 'react'
import { useRem } from './store'
import { saveSettings } from './api'
import { toast } from './Toast'
import { REMIND_BEFORE_OPTIONS } from './helpers'

const defaults = {
  default_reminder_time: '09:00',
  default_remind_before: 15,
  default_alarm_enabled: false,
  default_notification_enabled: true,
  browser_notifications: true,
  alarm_sound: true,
  alarm_volume: 0.7,
  due_soon_days: 7,
  auto_create_next: false,
  timezone: 'Asia/Kolkata',
}

export default function RemSettings() {
  const { settings } = useRem()
  const [form, setForm] = useState(defaults)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings && settings.id) {
      setForm(prev => ({ ...prev, ...settings }))
    }
  }, [settings])

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveSettings(form)
      toast('Settings saved successfully', 'success', 2000)
    } catch (err) {
      toast(err.message || 'Failed to save settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  const remindBeforeLabel = REMIND_BEFORE_OPTIONS.find(o => o.value === form.default_remind_before)?.label || ''

  return (
    <div>
      <div className="card-block">
        <div className="tb">
          <h3>Reminder Settings</h3>
          <span className="ln">Configure default behaviour for reminders and alarms</span>
        </div>
        <div style={{ padding: 20 }}>
          <div className="form-grid">

            <div className="form-row">
              <label>Default Reminder Time</label>
              <input
                type="text"
                value={form.default_reminder_time}
                onChange={e => set('default_reminder_time', e.target.value)}
                placeholder="09:00"
              />
            </div>

            <div className="form-row">
              <label>Remind Before</label>
              <select
                value={form.default_remind_before}
                onChange={e => set('default_remind_before', Number(e.target.value))}
              >
                {REMIND_BEFORE_OPTIONS.filter(o => o.value !== -1).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label>Due-Soon Threshold (days)</label>
              <input
                type="number"
                min={1}
                max={90}
                value={form.due_soon_days}
                onChange={e => set('due_soon_days', Number(e.target.value))}
              />
            </div>

            <div className="form-row">
              <label>Alarm Volume</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.alarm_volume}
                  onChange={e => set('alarm_volume', Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
                  {Math.round(form.alarm_volume * 100)}%
                </span>
              </div>
            </div>

            <div className="form-row full">
              <label>Timezone</label>
              <input
                type="text"
                value={form.timezone}
                onChange={e => set('timezone', e.target.value)}
                placeholder="Asia/Kolkata"
              />
            </div>

            <div className="form-row full">
              <label className="row-toggle">
                <input
                  type="checkbox"
                  checked={!!form.default_alarm_enabled}
                  onChange={e => set('default_alarm_enabled', e.target.checked)}
                />
                <span className="switch"></span>
                <span>Default Alarm State</span>
              </label>
            </div>

            <div className="form-row full">
              <label className="row-toggle">
                <input
                  type="checkbox"
                  checked={!!form.default_notification_enabled}
                  onChange={e => set('default_notification_enabled', e.target.checked)}
                />
                <span className="switch"></span>
                <span>Default Notification State</span>
              </label>
            </div>

            <div className="form-row full">
              <label className="row-toggle">
                <input
                  type="checkbox"
                  checked={!!form.browser_notifications}
                  onChange={e => set('browser_notifications', e.target.checked)}
                />
                <span className="switch"></span>
                <span>Browser Notifications</span>
              </label>
            </div>

            <div className="form-row full">
              <label className="row-toggle">
                <input
                  type="checkbox"
                  checked={!!form.alarm_sound}
                  onChange={e => set('alarm_sound', e.target.checked)}
                />
                <span className="switch"></span>
                <span>Alarm Sound</span>
              </label>
            </div>

            <div className="form-row full">
              <label className="row-toggle">
                <input
                  type="checkbox"
                  checked={!!form.auto_create_next}
                  onChange={e => set('auto_create_next', e.target.checked)}
                />
                <span className="switch"></span>
                <span>Auto-Create Next Recurring Reminder</span>
              </label>
            </div>

          </div>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="rem-btn primary" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>

      <div className="card-block">
        <div className="tb">
          <h3>Current Settings Preview</h3>
          <span className="ln">Live view of saved values</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 24px' }}>
            <div className="detail-item">
              <div className="k">Default Reminder Time</div>
              <div className="v">{form.default_reminder_time || '—'}</div>
            </div>
            <div className="detail-item">
              <div className="k">Remind Before</div>
              <div className="v">{remindBeforeLabel || '—'}</div>
            </div>
            <div className="detail-item">
              <div className="k">Default Alarm</div>
              <div className="v">{form.default_alarm_enabled ? 'ON' : 'OFF'}</div>
            </div>
            <div className="detail-item">
              <div className="k">Default Notifications</div>
              <div className="v">{form.default_notification_enabled ? 'ON' : 'OFF'}</div>
            </div>
            <div className="detail-item">
              <div className="k">Browser Notifications</div>
              <div className="v">{form.browser_notifications ? 'ON' : 'OFF'}</div>
            </div>
            <div className="detail-item">
              <div className="k">Alarm Sound</div>
              <div className="v">{form.alarm_sound ? 'ON' : 'OFF'}</div>
            </div>
            <div className="detail-item">
              <div className="k">Alarm Volume</div>
              <div className="v">{Math.round(form.alarm_volume * 100)}%</div>
            </div>
            <div className="detail-item">
              <div className="k">Due-Soon Threshold</div>
              <div className="v">{form.due_soon_days} days</div>
            </div>
            <div className="detail-item">
              <div className="k">Auto-Create Next</div>
              <div className="v">{form.auto_create_next ? 'ON' : 'OFF'}</div>
            </div>
            <div className="detail-item">
              <div className="k">Timezone</div>
              <div className="v">{form.timezone || '—'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
