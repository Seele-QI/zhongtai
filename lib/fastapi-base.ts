function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function sanitizeEnvValue(raw: unknown): string {
  if (typeof raw !== "string") return ""
  let s = stripBom(raw).trim()
  if (s.length >= 2) {
    const a = s[0]
    const b = s[s.length - 1]
    if ((a === `"` && b === `"`) || (a === `'` && b === `'`)) {
      s = s.slice(1, -1).trim()
    }
  }
  return s
}

export function getFastapiBase(): string {
  const raw = sanitizeEnvValue(process.env.NEXT_PUBLIC_FASTAPI_URL)
  if (raw.length > 0) return raw.replace(/\/+$/, "")
  if (process.env.NODE_ENV === "production") return ""
  return "http://127.0.0.1:8000"
}
