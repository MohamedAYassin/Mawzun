// Turning a raw User-Agent into something a person recognises.
//
// Lives in its own module rather than inside the component so it can be
// verified by IMPORTING it — a test that re-implements this and checks its own
// copy proves nothing about the code that ships.
//
// Deliberately a small heuristic instead of a UA-parsing dependency: the
// question this answers is "which of my devices is this", not analytics, and
// pulling in a library for one label would be the wrong trade. Anything
// unrecognised is shown as-is, so an odd client (curl, a script, a bot) stays
// identifiable rather than being flattened into "unknown".
//
// Order matters in both lists. Edge and Opera both claim to be Chrome, and
// Chrome claims to be Safari, so the more specific token has to be tested
// first or every browser reports as the wrong one.

export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'غير معروف'

  const browser =
    /Edg\//.test(userAgent) ? 'Edge'
    : /OPR\//.test(userAgent) ? 'Opera'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : null

  // Android before Linux: an Android UA contains "Linux" too.
  // iOS before macOS: an iPhone UA contains "Mac OS X".
  const os =
    /Windows/.test(userAgent) ? 'Windows'
    : /Android/.test(userAgent) ? 'Android'
    : /iPhone|iPad|iPod/.test(userAgent) ? 'iOS'
    : /Mac OS X/.test(userAgent) ? 'macOS'
    : /Linux/.test(userAgent) ? 'Linux'
    : null

  if (browser && os) return `${browser} على ${os}`
  if (browser) return browser
  if (os) return os
  // Non-browser clients: show the identifier itself, truncated.
  return userAgent.length > 40 ? `${userAgent.slice(0, 40)}…` : userAgent
}

/** Local date + time, matching how the rest of the app renders timestamps. */
export function formatMoment(value: string): string {
  return new Date(value).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
}
