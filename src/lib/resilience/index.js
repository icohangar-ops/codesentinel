/**
 * Vendored subset of cubiczan-resilience, ported to CommonJS for this repo.
 * Source of truth: ~/Desktop/icohangar-repos/cubiczan-resilience/typescript/src
 */

const { ResilienceError, isResilienceError } = require("./errors");
const { retry, computeBackoff } = require("./retry");
const { safeFetch, isRetryableStatus } = require("./safeFetch");

module.exports = {
  ResilienceError,
  isResilienceError,
  retry,
  computeBackoff,
  safeFetch,
  isRetryableStatus,
};
