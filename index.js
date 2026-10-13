const browser = require('./browser/');
const version = require('./package.json').version.split('-')[0];

// [rs patch] curl-impersonate 出口注入: jsdom ResourceLoader 检测 SDENV_IMPERSONATE=1 时使用
if (process.env.SDENV_IMPERSONATE === '1') {
  try { global.__sdenvImpersonate = require('./utils/impersonate'); } catch (e) {}
}

module.exports = {
  ...require('./utils/'),
  browser,
  version: `v${version}`,
}
