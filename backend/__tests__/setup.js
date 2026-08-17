process.env.DB_CLIENT = "pg";
process.env.DB_HOST = "localhost";
process.env.DB_PORT = "5433";
process.env.DB_USER = "studenti";
process.env.DB_PASS = "studentipass";
process.env.DB_DATABASE = "studenthub_test";
process.env.SESSION_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.FRONTEND_URL = "http://localhost:30010";
// High default so unrelated integration tests reusing the same reporter
// account across many scenarios don't trip the per-user report rate limit.
// The dedicated rate-limit test lowers this itself for its own duration.
process.env.MODERATION_REPORTS_PER_HOUR_LIMIT = "1000";
