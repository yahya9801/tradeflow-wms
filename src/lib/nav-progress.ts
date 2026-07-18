/** Should a click on this anchor start the navigation progress indicator? */
export function isTrackableNavigation(
  a: { href: string; target: string | null; hasDownload: boolean },
  current: { origin: string; url: string },
  modifier: boolean,
): boolean {
  if (modifier || a.hasDownload) return false;
  if (a.target && a.target !== "_self") return false;

  let target: URL;
  try {
    target = new URL(a.href, current.url);
  } catch {
    return false;
  }
  if (target.origin !== current.origin) return false; // external
  if (target.href === current.url) return false; // same URL

  // A hash link that only changes the fragment on the current page is not a navigation.
  const here = new URL(current.url);
  if (target.pathname === here.pathname && target.search === here.search && target.hash) return false;

  return true;
}
