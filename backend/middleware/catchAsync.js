const logger = require("./logger");

const catchAsync = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((error) => {
            logger.error({ err: error }, "Unhandled error");
            next(error);
        });
    };
};

module.exports = catchAsync;
