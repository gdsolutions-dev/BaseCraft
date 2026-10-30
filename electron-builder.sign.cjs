// The full application, signed (scripts/win-sign.cjs).
const { withWinSigning } = require('./scripts/win-sign.cjs');

module.exports = withWinSigning(require('./package.json').build);
