export function validateExternalPostUrl(value, platform) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Enter the full public post URL, including https://.');
  }
  if (url.protocol !== 'https:') throw new Error('The submitted post URL must use HTTPS.');
  const host = url.hostname.toLowerCase();
  if (platform === 'facebook') {
    const allowed = host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch';
    if (!allowed) throw new Error('That is not a Facebook post URL.');
  } else if (platform === 'stocktwits') {
    if (!(host === 'stocktwits.com' || host.endsWith('.stocktwits.com'))) throw new Error('That is not a Stocktwits post URL.');
    if (!url.pathname.includes('/message/')) throw new Error('Paste the finished Stocktwits message URL, not the Stocktwits homepage.');
  } else if (platform === 'reddit') {
    const allowed = host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it';
    if (!allowed) throw new Error('That is not a Reddit post URL.');
    if (host !== 'redd.it' && !url.pathname.includes('/comments/')) throw new Error('Paste the finished Reddit post URL, not the subreddit or composer URL.');
  } else if (platform === 'x') {
    const allowed = host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com');
    if (!allowed || !/\/status\/\d+/i.test(url.pathname)) throw new Error('Paste the finished X post URL.');
  } else if (platform === 'bluesky') {
    if (host !== 'bsky.app' || !/\/profile\/[^/]+\/post\/[^/]+/i.test(url.pathname)) throw new Error('Paste the finished Bluesky post URL.');
  } else if (platform === 'threads') {
    if (!(host === 'threads.net' || host.endsWith('.threads.net')) || !/\/@[^/]+\/post\/[^/]+/i.test(url.pathname)) throw new Error('Paste the finished Threads post URL.');
  } else {
    throw new Error('That platform is not supported for submitted post links yet.');
  }
  url.hash = '';
  return url.toString();
}

export function detectExternalPostPlatform(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return '';
  }
  const host = url.hostname.toLowerCase();
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') return 'facebook';
  if (host === 'stocktwits.com' || host.endsWith('.stocktwits.com')) return 'stocktwits';
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') return 'reddit';
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x';
  if (host === 'bsky.app') return 'bluesky';
  if (host === 'threads.net' || host.endsWith('.threads.net')) return 'threads';
  return '';
}
