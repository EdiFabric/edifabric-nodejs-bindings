// Load the bundled native library from an installed edifabric-x12 package and print its version.
// Run it from a project that installed edifabric-x12, not from this repository.
'use strict';

const ef = require('edifabric-x12');

const library = ef.loadLibrary();
const expected = `x12-${process.platform}-${process.arch}`;
if (!library.path.includes(expected)) {
    throw new Error(`expected the library from @edifabric/${expected}, loaded ${library.path}`);
}
console.log(`loaded ${library.path}`);
console.log(`getAppVersion -> ${ef.getAppVersion()}`);
