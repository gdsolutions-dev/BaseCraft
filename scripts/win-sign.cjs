// Windows signing, shared by both products: the certificate is picked from the Windows store by its SHA-1 thumbprint.
// Usage: set BASECRAFT_SIGN_SHA1, then `npm run dist:win:signed` or `npm run dist:runtime:win:signed`.
/** The config with Windows signing; throws if BASECRAFT_SIGN_SHA1 is unset. */
module.exports.withWinSigning = (config) => {
  const certificateSha1 = process.env.BASECRAFT_SIGN_SHA1;
  if (!certificateSha1) throw new Error('BASECRAFT_SIGN_SHA1 is not set');
  const rfc3161TimeStampServer = process.env.BASECRAFT_SIGN_TIMESTAMP || 'http://time.certum.pl';
  return { ...config, win: { ...config.win, signtoolOptions: { certificateSha1, signingHashAlgorithms: ['sha256'], rfc3161TimeStampServer } } };
};
