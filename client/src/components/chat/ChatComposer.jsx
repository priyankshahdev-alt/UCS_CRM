import { useState, useRef, useEffect, useCallback } from 'react'
import {
  CHAT_MAX_BODY,
  validateChatFile,
} from './chatIdentity'
import { chatApi } from './chatApi'
import { SendIcon, PaperclipIcon, AlertIcon } from './chatIcons'
import { AttachmentDraft } from './AttachmentPreview'

/**
 * Screen 04 — composer.
 *
 * Enter sends, Shift+Enter inserts a newline. The textarea autosizes between one
 * and roughly five lines, then scrolls, so a long paste cannot push the header
 * off screen on a laptop. Typing frames are throttled and self-cancel so a
 * keystroke storm cannot flood the socket and a closed tab cannot leave a
 * permanent "typing…" next to someone.
 */
export default function ChatComposer({ conversation, me, onSend, disabled, disabledReason }) {
  const [body, setBody] = useState('')
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState('')
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)

  const areaRef = useRef(null)
  const fileRef = useRef(null)
  const convoId = conversation?.id
  const lastTypingAt = useRef(0)
  const typingIdle = useRef(null)

  // A new conversation starts from a clean composer.
  useEffect(() => {
    setBody('')
    setFile(null)
    setFileError('')
    if (areaRef.current) areaRef.current.style.height = 'auto'
  }, [convoId])

  const autosize = useCallback(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    // The CSS max-height caps this at ~5 lines; beyond that the box scrolls.
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(autosize, [body, autosize])

  const stopTyping = useCallback(() => {
    if (typingIdle.current) {
      clearTimeout(typingIdle.current)
      typingIdle.current = null
    }
    if (lastTypingAt.current) {
      chatApi.sendTyping(convoId, false)
      lastTypingAt.current = 0
    }
  }, [convoId])

  useEffect(() => stopTyping, [stopTyping])

  const signalTyping = useCallback(() => {
    if (!convoId) return
    const now = Date.now()
    // At most one frame every 2s while keys are actually arriving.
    if (now - lastTypingAt.current > 2000) {
      chatApi.sendTyping(convoId, true)
      lastTypingAt.current = now
    }
    if (typingIdle.current) clearTimeout(typingIdle.current)
    typingIdle.current = setTimeout(() => {
      chatApi.sendTyping(convoId, false)
      lastTypingAt.current = 0
      typingIdle.current = null
    }, 3000)
  }, [convoId])

  const attach = useCallback((picked) => {
    if (!picked) return
    const v = validateChatFile(picked)
    if (!v.ok) {
      setFileError(v.reason)
      setFile(null)
      return
    }
    setFileError('')
    setFile(picked)
  }, [])

  const removeFile = useCallback(() => {
    setFile(null)
    setFileError('')
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const canSend =
    !disabled && !sending && (body.trim().length > 0 || (file && !fileError))

  async function submit() {
    if (!canSend) return
    setSending(true)
    try {
      await onSend({ body: body.trim(), file: fileError ? null : file })
      // Only clear once the parent has accepted it, so a failed send keeps the text.
      setBody('')
      removeFile()
      autosize()
    } catch {
      /* onSend owns the failure UI and keeps the draft */
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function onPaste(e) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) {
          e.preventDefault()
          attach(f)
          return
        }
      }
    }
  }

  if (disabled) {
    return (
      <div className="chat-readonly" role="status">
        <span className="chat-readonly-icon">
          <AlertIcon size={16} />
        </span>
        <span>{disabledReason || 'You cannot post in this conversation.'}</span>
      </div>
    )
  }

  const remaining = CHAT_MAX_BODY - body.length

  return (
    <div
      className="chat-composer"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        attach(e.dataTransfer?.files?.[0])
      }}
      style={
        dragging
          ? { boxShadow: 'inset 0 0 0 2px var(--chat-primary)', background: 'var(--chat-own-bubble)' }
          : undefined
      }
    >
      {file && <AttachmentDraft file={file} error={fileError} onRemove={removeFile} />}

      <div className="chat-composer-box">
        <button
          type="button"
          className="chat-iconbtn"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach a file"
          title="Attach a file — images, PDF, Office, ZIP up to 25 MB"
        >
          <PaperclipIcon size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => attach(e.target.files?.[0])}
          tabIndex={-1}
        />

        <textarea
          ref={areaRef}
          rows={1}
          value={body}
          maxLength={CHAT_MAX_BODY}
          placeholder="Write a message…"
          aria-label="Message"
          onChange={(e) => {
            setBody(e.target.value)
            signalTyping()
          }}
          onBlur={stopTyping}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />

        <button
          type="button"
          className="chat-send"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send message"
          title="Send"
        >
          <SendIcon size={17} />
        </button>
      </div>

      <div className="chat-composer-foot">
        <span>
          {fileError ? (
            <span className="chat-counter" data-warn="true" data-over="true">
              {fileError}
            </span>
          ) : (
            'Enter to send · Shift+Enter for a new line'
          )}
        </span>
        <span
          className="chat-counter"
          data-warn={remaining <= 400 ? 'true' : 'false'}
          data-over={remaining < 0 ? 'true' : 'false'}
          aria-live="polite"
        >
          {body.length > CHAT_MAX_BODY - 200 ? `${body.length}/${CHAT_MAX_BODY}` : ''}
        </span>
      </div>
    </div>
  )
}
