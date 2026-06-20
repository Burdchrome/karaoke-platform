// Structured logger used everywhere on the server side.
// Levels: error > warn > info > debug.
// Output: pretty console for humans, plus full JSON to ./server.log for debugging gigs after the fact.

import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Human-readable line for the console: 17:42:11 [info] message {key: "value"}
const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const time = timestamp.slice(11, 19); // HH:MM:SS
  const extras = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  const body = stack || message;
  return `${time} [${level}] ${body}${extras}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(timestamp(), errors({ stack: true })),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), consoleFormat),
    }),
    new winston.transports.File({
      filename: 'server.log',
      format: combine(timestamp(), winston.format.json()),
    }),
  ],
});
