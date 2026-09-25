// electron-builder `afterPack` hook (electron-builder.yml): flip Electron's fuses, then ad-hoc
// sign the whole bundle, then prove the signature verifies. Runs for every mac pack, so the
// DMG (`npm run dist:mac`, tools/release.sh) and the local install (tools/install-local.sh)
// both get it.
//
// Why ad-hoc signing at all (#17 is still "no Apple Developer Program"): with
// `mac.identity: null` electron-builder signs nothing, and the Electron binary keeps the
// linker's ad-hoc signature from before the bundle was renamed, its Info.plist rewritten and
// app.asar added — so `codesign --verify --deep --strict` fails. On Apple Silicon a quarantined
// download with an *invalid* signature is reported as "ChatterED is damaged", with no Open
// Anyway. A *valid* ad-hoc signature gets the "Apple could not verify…" dialog instead, which
// System Settings ▸ Privacy & Security ▸ Open Anyway gets past. Not distribution security, and
// not claimed to be.
//
// Order matters: flipping fuses rewrites bytes in the Electron framework, so it must happen
// before signing. electron-builder's own `electronFuses:` key runs *after* this hook, which
// would invalidate the signature made here — that is why the fuses are flipped here instead.

const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

/** Fuses and why each is set the way it is. Read back with `npx @electron/fuses read --app`. */
function fuseConfig({ FuseVersion, FuseV1Options }) {
  return {
    version: FuseVersion.V1,
    // Main never re-launches itself as Node (it spawns only the `claude` CLI). Left on, any
    // local process could run `ELECTRON_RUN_AS_NODE=1 ChatterED -e …` and borrow the folder
    // access (TCC) a student granted to ChatterED for their vault.
    [FuseV1Options.RunAsNode]: false,
    // Same hole via NODE_OPTIONS=--require … and --inspect; the app uses neither.
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // electron-builder writes ElectronAsarIntegrity into Info.plist; validate app.asar
    // against it. Only app.asar is covered — app.asar.unpacked (pdf.js) is not.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    // Load the app only from app.asar, never from a sibling `app/` directory. The unpacked
    // pdf.js is reached by path from inside the app, which this fuse does not restrict.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // Left ON deliberately: the renderer is loaded from file://, and pdf.js's module worker
    // (PdfViewer.svelte, rasterise.ts) is loaded from file:// too. Turning this off needs the
    // renderer moved to a `protocol.handle('app', …)` scheme first (release review P2).
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    // Left OFF deliberately: the app sets no cookies, and turning it on makes Chromium keep a
    // "ChatterED Safe Storage" keychain item whose ACL is bound to the code signature. An
    // ad-hoc signature changes with every build, so every update would raise a keychain prompt.
    [FuseV1Options.EnableCookieEncryption]: false,
  };
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  const fuses = require('@electron/fuses');
  await fuses.flipFuses(appPath, fuseConfig(fuses));
  console.log(`  • fuses flipped  app=${appPath}`);

  // Inside-out signing is what --deep does for a bundle with nested frameworks and helpers;
  // the identifier comes from each Info.plist (sg.nus.chattered for the app).
  run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  console.log('  • ad-hoc signed and verified');
};
