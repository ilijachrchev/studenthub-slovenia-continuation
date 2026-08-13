module.exports = {
  testEnvironment: "node",
  globalSetup: "./__tests__/globalSetup.js",
  globalTeardown: "./__tests__/globalTeardown.js",
  setupFiles: ["./__tests__/setup.js"],
  forceExit: true,
  testMatch: ["**/__tests__/**/*.test.js"],
  collectCoverageFrom: [
    "app.js",
    "routes/**/*.js",
    "lib/**/*.js",
    "middleware/**/*.js",
    "db.js",
  ],
  coveragePathIgnorePatterns: ["/node_modules/", "/__tests__/"],
  coverageThreshold: {
    global: {
      statements: 20,
      branches: 20,
      functions: 20,
      lines: 20,
    },
  },
};
