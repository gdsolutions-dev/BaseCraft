// Windows signing: the certificate is picked from the Windows store by its SHA-1 thumbprint.
// Usage: set BASECRAFT_SIGN_SHA1, then `npm run dist:win:signed`.
const { build } = require('./package.json');

if (!process.env.BASECRAFT_SIGN_SHA1) throw new Error('BASECRAFT_SIGN_SHA1 is not set');

module.exports = {
  ...build,
  win: {
    ...build.win,
    signtoolOptions: {
      certificateSha1: process.env.BASECRAFT_SIGN_SHA1,
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: process.env.BASECRAFT_SIGN_TIMESTAMP || 'http://time.certum.pl',
    },
  },
};
