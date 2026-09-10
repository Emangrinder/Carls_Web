import { useState } from 'react'

// Not real security -- this is a static GitHub Pages site with no backend,
// so anyone technical can read this file or the hash below and get past
// it trivially. It exists purely to keep casual/non-technical visitors
// from landing on the site, per the user's explicit request -- hashing the
// password is just enough to keep it from being a literal grep-able string
// in the bundle, nothing stronger than that.
const PASSWORD_HASH = 'fa6cd5740087d61c7633840216d598cf8b4fd56fcc8d2c1a6efbd78ce608e772'
const COOKIE_NAME = 'carls_web_unlocked'
const UNLOCK_DAYS = 30

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hasUnlockCookie() {
  return document.cookie.split('; ').includes(`${COOKIE_NAME}=1`)
}

function setUnlockCookie() {
  const maxAgeSeconds = UNLOCK_DAYS * 24 * 60 * 60
  document.cookie = `${COOKIE_NAME}=1; max-age=${maxAgeSeconds}; path=/; SameSite=Lax`
}

export default function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = useState(hasUnlockCookie)
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setChecking(true)
    setError(false)
    const hash = await sha256Hex(input)
    if (hash === PASSWORD_HASH) {
      setUnlockCookie()
      setUnlocked(true)
    } else {
      setError(true)
      setChecking(false)
    }
  }

  if (unlocked) return children

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-900">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xs rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-950"
      >
        <h1 className="mb-1 text-center text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Carls Web
        </h1>
        <p className="mb-4 text-center text-sm text-neutral-500">Enter the passkey to continue.</p>
        <input
          type="password"
          autoFocus
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setError(false)
          }}
          className="mb-3 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          placeholder="Passkey"
        />
        {error && <p className="mb-3 text-center text-xs text-red-500">Incorrect passkey.</p>}
        <button
          type="submit"
          disabled={checking || !input}
          className="w-full rounded-md bg-neutral-900 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Enter
        </button>
      </form>
    </div>
  )
}
