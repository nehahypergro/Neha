// Errors, for people: every failure is (1) sent to the server so the team hears about it, and (2) shown as one plain
// sentence that says what happened and what to do next. Raw error text never reaches the marketer.
const seen = new Map(); let ctxInfo = () => ({});
export const setErrorContext = (fn) => { ctxInfo = fn; };

export function report(err, where, extra = {}) {
  try {
    const message = String(err?.message || err || 'unknown'); const key = where + '|' + message; const now = Date.now();
    if (now - (seen.get(key) || 0) < 30000) return; seen.set(key, now); // the same failure, once per 30 s
    const body = JSON.stringify({ where, message, stack: String(err?.stack || '').slice(0, 4000), url: location.href, agent: navigator.userAgent, ...ctxInfo(), ...extra });
    if (!(navigator.sendBeacon && navigator.sendBeacon('/api/errors', new Blob([body], { type: 'application/json' })))) fetch('/api/errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* reporting must never break the app */ }
}

const RULES = [
  [/failed to fetch|networkerror|load failed|network request failed|ERR_INTERNET|offline/i, () => 'We can’t reach the server right now. Check your internet connection, then try again.'],
  [/\b(413)\b|too large|file size|LIMIT_FILE_SIZE/i, () => 'That file is too big to upload. Ask the designer for a smaller file (under 300 MB), or remove unused artboards and send it again.'],
  [/password/i, () => 'This file is password-protected. Ask the designer for a version without a password.'],
  [/PDF Compatible|Not a PDF-compatible|not a pdf/i, () => 'This file was saved without PDF compatibility, so we can’t read it. Ask the designer to re-save it from Illustrator with “Create PDF Compatible File” ticked.'],
  [/\b(429)\b|quota|rate limit|overloaded|resource.?exhausted/i, () => 'The assistant is busy right now. Wait a minute and try again. You can still make the change by clicking the item on the creative.'],
  [/\b(401|403)\b|permission|unauthori[sz]ed|forbidden/i, () => 'You don’t have access to do that. Sign in again, or ask your admin to give you access.'],
  [/\b404\b|unknown bundle|not found|could not load/i, () => 'We couldn’t find that creative. It may have been removed. Go back to My creatives and open it from there.'],
  [/timed? ?out|timeout|aborted/i, () => 'That took too long and was stopped. Try again. If it happens twice, try a smaller file or fewer changes at once.'],
  [/out of memory|allocation|canvas|too many pixels|array buffer/i, () => 'This creative is too large for the browser to build in one go. Close other tabs and try again, or download the JPG instead of the print file.'],
  [/font/i, () => 'One of the fonts could not be loaded. Reload the page and try again. If it keeps happening, add the font file under “Fonts on file” on the home page.'],
  [/images only|does not look like|unsupported|invalid (file|image)/i, () => 'That file type isn’t supported here. Use a PNG or JPG image, or an Illustrator .ai file for a new creative.'],
  [/\b5\d\d\b|internal server|server error/i, () => 'Something went wrong on our side. Try again in a minute. Our team has been told.'],
];

/** One plain sentence: what happened + what to do next. `doing` finishes "…while ___", e.g. "opening that creative". */
export function explain(err, doing) {
  const m = String(err?.message || err || ''); for (const [re, say] of RULES) if (re.test(m)) return say(m);
  return `Something went wrong while ${doing || 'doing that'}. Try again. If it happens again, reload the page. Your changes are saved, and our team has been told.`;
}
/** Report + explain in one call; use in every catch that talks to the user. */
export const fail = (err, doing, extra) => { report(err, doing || 'unknown', extra); return explain(err, doing); };

export function installGlobalHandlers() {
  window.addEventListener('error', (ev) => { if (ev.error || ev.message) report(ev.error || ev.message, 'uncaught error', { source: `${ev.filename || ''}:${ev.lineno || ''}` }); });
  window.addEventListener('unhandledrejection', (ev) => report(ev.reason, 'unhandled promise'));
}
