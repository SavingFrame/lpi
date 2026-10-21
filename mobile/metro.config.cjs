const { getDefaultConfig } = require('expo/metro-config');

// Expo detects the npm workspace and resolves shared source outside mobile/.
module.exports = getDefaultConfig(__dirname);
