const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Ensure png assets are properly resolved
config.resolver.assetExts.push("png");

module.exports = config;
