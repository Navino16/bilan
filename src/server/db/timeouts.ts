// Prisma's 5 s default is too short to delete thousands of transactions with their search tokens.
export const LONG_TX_TIMEOUT = { maxWait: 10_000, timeout: 5 * 60_000 };
