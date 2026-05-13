"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Defaults_1 = require("../Defaults");
const registration_1 = require("./registration");
const modern_features_1 = require("./modern-features");
// export the last socket layer + May-2026 helper API
const makeWASocket = (config) => (0, modern_features_1.patchModernSocket)((0, registration_1.makeRegistrationSocket)({
    ...Defaults_1.DEFAULT_CONNECTION_CONFIG,
    ...config
}));
exports.default = makeWASocket;
