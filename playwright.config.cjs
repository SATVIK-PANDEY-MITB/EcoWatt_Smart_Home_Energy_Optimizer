const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test",
  testMatch: "**/*.spec.js",
  timeout: 90000,
  use: {
    baseURL: "http://localhost:3000",
    headless: true
  },
  webServer: {
    command: "node server.js",
    port: 3000,
    reuseExistingServer: true,
    timeout: 120000
  }
});
