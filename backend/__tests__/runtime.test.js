const { getAppRuntimeConfig, validateProductionBootstrapConfig } = require("../config/runtime");

function snapshotEnv() {
  return { ...process.env };
}

function restoreEnv(env) {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  Object.assign(process.env, env);
}

describe("runtime config", () => {
  let env;

  beforeEach(() => {
    env = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(env);
  });

  test("defaults are permissive outside production", () => {
    delete process.env.NODE_ENV;
    delete process.env.SESSION_SECRET;
    delete process.env.FRONTEND_URL;
    delete process.env.PORT;
    delete process.env.TRUST_PROXY;

    const config = getAppRuntimeConfig();

    expect(config.production).toBe(false);
    expect(config.sessionSecret).toBe("dev-only-insecure-secret");
    expect(config.frontendUrl).toBe("http://localhost:30010");
    expect(config.port).toBe(30011);
    expect(config.cookieSecure).toBe(false);
  });

  test("production bootstrap rejects missing required config", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    delete process.env.FRONTEND_URL;
    delete process.env.PORT;
    delete process.env.DB_CLIENT;
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASS;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_DATABASE;
    delete process.env.DB_PORT;
    delete process.env.TRUST_PROXY;

    expect(() => validateProductionBootstrapConfig()).toThrow(/Invalid production configuration/);
  });

  test("production bootstrap accepts a complete production configuration", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.FRONTEND_URL = "https://studenthub.example";
    process.env.PORT = "30011";
    process.env.TRUST_PROXY = "true";
    process.env.DB_CLIENT = "pg";
    process.env.DB_HOST = "postgres";
    process.env.DB_USER = "studenti";
    process.env.DB_PASS = "studentipass";
    process.env.DB_DATABASE = "studenthub";
    process.env.DB_PORT = "5432";

    const config = validateProductionBootstrapConfig();

    expect(config.production).toBe(true);
    expect(config.cookieSecure).toBe(true);
    expect(config.trustProxy).toBe(true);
    expect(config.db.client).toBe("pg");
    expect(config.db.port).toBe(5432);
  });
});
