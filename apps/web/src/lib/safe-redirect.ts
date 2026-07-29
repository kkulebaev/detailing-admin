// Guards the post-login `?redirect=` query param against open-redirect: a
// leading `//` or `/\` is browser-interpreted as a scheme-relative URL
// (`//evil.com` resolves like `https://evil.com`), so "starts with a slash"
// alone isn't enough — it must not also look like the start of a host.
export function isSafeRedirect(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')
}
