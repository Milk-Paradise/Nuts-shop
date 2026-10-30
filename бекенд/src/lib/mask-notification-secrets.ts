/** Redact journal output only; delivery must retain the original content. */
export function maskNotificationSecrets(value: string | null): string | null {
  if (value === null) return null

  // Replace values in place to preserve URL encoding and surrounding text.
  return value.replace(/(?:https?:\/\/|\/)[^\s<>"'\)\]]+/gi, (url) => {
    const query = url.indexOf("?")
    const fragment = url.indexOf("#")
    if (query < 0 || (fragment >= 0 && fragment < query)) return url

    const end = fragment < 0 ? url.length : fragment
    const parameters = /^https?:\/\/t\.me\//i.test(url)
      ? /([?&](?:amp;)?(?:token|start)=)[^&#]*/gi
      : /([?&](?:amp;)?token=)[^&#]*/gi

    return url.slice(0, query) +
      url.slice(query, end).replace(parameters, "$1•••") + url.slice(end)
  })
}
