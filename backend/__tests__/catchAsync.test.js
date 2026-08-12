const express = require("express");
const request = require("supertest");
const catchAsync = require("../middleware/catchAsync");
const requestIdMiddleware = require("../middleware/requestId");
const errorHandler = require("../middleware/errorHandler");

describe("catchAsync", () => {
  function mockRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  }

  test("calls the async function and passes through on success", async () => {
    const handler = catchAsync(async (req, res) => {
      res.json({ ok: true });
    });

    const req = {};
    const res = mockRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  test("forwards rejected promises to next", async () => {
    const handler = catchAsync(async () => {
      throw new Error("database connection failed");
    });

    const req = {};
    const res = mockRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toBe("database connection failed");
  });

  test("does not send a response itself when an error occurs", async () => {
    const handler = catchAsync(async () => {
      throw new Error("SECRET_INTERNAL_DETAILS");
    });

    const req = {};
    const res = mockRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
  });
});

describe("global error handler", () => {
  test("returns request ids and hides internal details in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const app = express();
      app.use(requestIdMiddleware);
      app.get("/boom", catchAsync(async () => {
        throw new Error("database connection failed");
      }));
      app.use(errorHandler);

      const res = await request(app).get("/boom");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
      expect(res.body.requestId).toBeDefined();
      expect(res.headers["x-request-id"]).toBe(res.body.requestId);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
