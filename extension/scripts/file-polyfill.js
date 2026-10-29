// vsce 2.x pulls undici, which needs a global File that Node 18 only exposes through the buffer module.
if (typeof globalThis.File === 'undefined') globalThis.File = require('node:buffer').File;
