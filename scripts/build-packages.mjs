// Build the npm packages into dist/npm/:
//   edifabric-x12                 the bindings, with an optional dependency on every platform package
//   @edifabric/x12-<os>-<cpu>     one ediFabric Native library each, installed only on a matching machine
//
// Usage: node scripts/build-packages.mjs        (needs natives/<rid>/ from scripts/fetch-natives)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'npm');
const main = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { version } = main;

// Linux builds need glibc 2.34 or later; npm skips them on musl.
const PLATFORMS = [
    { rid: 'win-x64', os: 'win32', cpu: 'x64', file: 'edifabric-x12-tools.dll' },
    { rid: 'linux-x64', os: 'linux', cpu: 'x64', libc: 'glibc', file: 'edifabric-x12-tools.so' },
    { rid: 'linux-arm64', os: 'linux', cpu: 'arm64', libc: 'glibc', file: 'edifabric-x12-tools.so' },
    { rid: 'osx-arm64', os: 'darwin', cpu: 'arm64', file: 'edifabric-x12-tools.dylib' },
];

const shared = {
    version,
    license: main.license,
    author: main.author,
    homepage: main.homepage,
    repository: main.repository,
};

function write(dir, name, contents) {
    fs.writeFileSync(path.join(dir, name), typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
}

fs.rmSync(dist, { recursive: true, force: true });

const optionalDependencies = {};
for (const platform of PLATFORMS) {
    const name = `@edifabric/x12-${platform.os}-${platform.cpu}`;
    const source = path.join(root, 'natives', platform.rid, platform.file);
    if (!fs.existsSync(source)) throw new Error(`${source} is missing. Run scripts/fetch-natives first.`);

    const dir = path.join(dist, `x12-${platform.os}-${platform.cpu}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(source, path.join(dir, platform.file));
    fs.copyFileSync(path.join(root, 'LICENSE.md'), path.join(dir, 'LICENSE.md'));
    write(dir, 'index.js', `'use strict';\n\nmodule.exports = require('path').join(__dirname, '${platform.file}');\n`);
    write(dir, 'README.md', `# ${name}\n\nThe ediFabric Native X12 library for ${platform.rid}, used by [edifabric-x12](https://www.npmjs.com/package/edifabric-x12). Install \`edifabric-x12\` instead of this package.\n`);
    write(dir, 'package.json', {
        name,
        description: `ediFabric Native X12 library for ${platform.rid}, used by edifabric-x12.`,
        ...shared,
        main: 'index.js',
        files: ['index.js', platform.file, 'LICENSE.md'],
        os: [platform.os],
        cpu: [platform.cpu],
        ...(platform.libc ? { libc: [platform.libc] } : {}),
        publishConfig: { access: 'public' },
    });
    optionalDependencies[name] = version;
    console.log(`built ${path.relative(root, dir)}`);
}

const mainDir = path.join(dist, 'edifabric-x12');
fs.mkdirSync(mainDir, { recursive: true });
for (const file of [...main.files, 'README.md', 'LICENSE.md']) {
    fs.copyFileSync(path.join(root, file), path.join(mainDir, file));
}
const { scripts, devDependencies, ...published } = main;
write(mainDir, 'package.json', { ...published, optionalDependencies });
console.log(`built ${path.relative(root, mainDir)}`);
