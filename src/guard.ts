/**
 * Browsers resend a saved Basic Auth password with any request to this site,
 * including one triggered by some other website — so without this check, any page
 * you visited could stop a camera through your logged-in browser. The dashboard's
 * own buttons are HTMX, which always sends `HX-Request: true`; a cross-site request
 * cannot add that header without a CORS grant we never give. Origin is checked as
 * well, belt and braces.
 */
export function sameSiteAction(headers: Record<string, string | string[] | undefined>): boolean {
  if (headers['hx-request'] !== 'true') return false;
  const origin = headers['origin'];
  if (typeof origin === 'string') {
    try {
      if (new URL(origin).host !== headers['host']) return false;
    } catch {
      return false;
    }
  }
  const site = headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin';
}
