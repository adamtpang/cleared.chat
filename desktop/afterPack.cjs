// electron-builder hard-ignores any directory named `node_modules` inside
// extraResources, no matter what `filter` says. web/ is no longer the
// zero-dependency proxy it was in July: it needs baileys, googleapis,
// @neondatabase/serverless and friends at runtime, so a package without them
// installs fine and then dies on its first import.
//
// So copy them in after packing, and fail the build loudly if the copy did
// not land. A silently-missing dependency is exactly the bug this hook exists
// to prevent.

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED = ['baileys', '@googleapis', 'google-auth-library', '@neondatabase', 'pino', '@hapi', 'qrcode'];

exports.default = async function afterPack(context) {
  const src = path.join(__dirname, '..', 'web', 'node_modules');
  const dest = path.join(context.appOutDir, 'resources', 'web', 'node_modules');

  if (!fs.existsSync(src)) {
    throw new Error(`afterPack: ${src} does not exist. Run npm install in web/ first.`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });

  const missing = REQUIRED.filter((d) => !fs.existsSync(path.join(dest, d)));
  if (missing.length) {
    throw new Error(`afterPack: these runtime deps did not copy: ${missing.join(', ')}`);
  }

  const count = fs.readdirSync(dest).length;
  console.log(`  • afterPack: copied ${count} packages into resources/web/node_modules`);
};
