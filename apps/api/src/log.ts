import pino from 'pino'
import { env } from './env.js'

export const baseLogger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'phone',
      '*.phone',
      'name',
      '*.name',
      'note',
      '*.note',
      'credentials',
      '*.credentials',
      'private_key',
      '*.private_key',
      'GOOGLE_SERVICE_ACCOUNT_JSON_B64',
      '*.GOOGLE_SERVICE_ACCOUNT_JSON_B64',
    ],
    censor: '[REDACTED]',
  },
})
