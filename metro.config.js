// The web version stores data with SQLite compiled to WebAssembly, so Metro
// has to serve .wasm files.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

module.exports = config;
