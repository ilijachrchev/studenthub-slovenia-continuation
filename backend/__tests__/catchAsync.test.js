const catchAsync = require("../middleware/catchAsync");
const logger = require("../middleware/logger");

describe("catchAsync", () => {
    function mockRes() {
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        return res;
    }

    test("calls the async function and passes through on success", async () => {
        const handler = catchAsync(async (req, res) => {
            res.json({ ok: true });
        });

        const req = {};
        const res = mockRes();

        await handler(req, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith({ ok: true });
        expect(res.status).not.toHaveBeenCalled();
    });

    test("forwards errors to the next handler", async () => {
        const loggerSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
        const next = jest.fn();

        const handler = catchAsync(async (req, res) => {
            throw new Error("database connection failed");
        });

        const req = {};
        const res = mockRes();

        await handler(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        expect(loggerSpy).toHaveBeenCalled();

        loggerSpy.mockRestore();
    });

    test("does not expose error.message to client", async () => {
        const loggerSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
        const next = jest.fn();

        const handler = catchAsync(async (req, res) => {
            throw new Error("SECRET_INTERNAL_DETAILS");
        });

        const req = {};
        const res = mockRes();

        await handler(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(next.mock.calls[0][0].message).toBe("SECRET_INTERNAL_DETAILS");

        loggerSpy.mockRestore();
    });
});
