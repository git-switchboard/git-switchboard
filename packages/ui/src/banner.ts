/** "Back to docs" banner shown when running inside an iframe */

export function mountBanner(docsUrl: string): void {
  const banner = document.createElement('div');
  banner.id = 'iframe-banner';
  banner.innerHTML =
    `<span>Interactive demo \u2014 actions are simulated</span>` +
    `<a href="${docsUrl}" target="_top">\u2190 Back to docs</a>`;
  document.body.appendChild(banner);
  // Push the main content up to make room
  document.body.classList.add('has-banner');
}
