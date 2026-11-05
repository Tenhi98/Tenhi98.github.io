/* SiteSnap HK access gate — SHA-256 hex of the access password (never plaintext).
   Rotate with: node scripts/set-password.mjs "新密碼"
   See DEPLOY.md. */
window.SITESNAP_AUTH = {
  version: 1,
  /* hash of temporary QA password documented in DEPLOY.md — replace before production use */
  passwordHash:
    "4eea832c7a9b6bb524654fcdf0a8851f453868a8ff625a277718126b42bf1770",
};
