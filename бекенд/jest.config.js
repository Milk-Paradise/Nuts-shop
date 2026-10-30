const { loadEnv } = require("@medusajs/utils");
loadEnv("test", process.cwd());

const collectCoverage = process.env.COVERAGE === "true";

module.exports = {
  transform: {
    "^.+\\.[jt]s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "json"],
  modulePaths: ["<rootDir>/src"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  moduleNameMapper: {
    "^@lib/(.*)$": "<rootDir>/src/lib/$1",
  },
  setupFiles: ["./integration-tests/setup.js"],
  collectCoverage,
  collectCoverageFrom: [
    "src/modules/**/*.ts",
    "src/workflows/**/*.ts",
    "src/api/**/*.ts",
    "!src/**/__tests__/**",
    "!src/modules/**/migrations/**",
  ],
  coverageReporters: ["text-summary", "json-summary"],
  coverageThreshold: {
    "./src/modules/**/*.ts": { branches: 0, lines: 0 },
    "./src/workflows/**/*.ts": { branches: 0, lines: 0 },
    "./src/api/**/*.ts": { branches: 0, lines: 0 },
  },
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = [
    "**/integration-tests/http/*.spec.[jt]s",
    "**/src/api/store/catalog/cart/__tests__/*.spec.[jt]s",
  ];
  module.exports.globalSetup = "./integration-tests/external-stubs-global-setup.js";
  module.exports.globalTeardown = "./integration-tests/external-stubs-global-teardown.js";
  // Каждый сьют поднимает свой инстанс Medusa, и состояние протекает между
  // файлами: второй сьют в том же воркере падает с "Method Map.prototype.set
  // called on incompatible receiver" на загрузке модулей. Крошечный лимит
  // заставляет jest брать под каждый файл свежий воркер.
  module.exports.workerIdleMemoryLimit = "1MB";
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s"];
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = [
    "**/src/**/__tests__/**/*.unit.spec.[jt]s",
  ];
}
