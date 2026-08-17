function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function loadMiddleware() {
  jest.resetModules();
  process.env.NODE_ENV = "production";
  process.env.FRONTEND_URL = "https://studenthub.example";
  return require("../middleware/csrf");
}

describe("validateOrigin", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  test("rejects state-changing requests with no origin or referer", () => {
    const { validateOrigin } = loadMiddleware();
    const req = { method: "POST", headers: {} };
    const res = makeResponse();
    const next = jest.fn();

    validateOrigin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects state-changing requests from an untrusted origin", () => {
    const { validateOrigin } = loadMiddleware();
    const req = {
      method: "POST",
      headers: { origin: "https://evil.example" },
    };
    const res = makeResponse();
    const next = jest.fn();

    validateOrigin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("allows state-changing requests from the configured frontend origin", () => {
    const { validateOrigin } = loadMiddleware();
    const req = {
      method: "POST",
      headers: { origin: "https://studenthub.example" },
    };
    const res = makeResponse();
    const next = jest.fn();

    validateOrigin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
