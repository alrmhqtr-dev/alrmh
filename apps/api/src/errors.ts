import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/**
 * One place where errors become responses.
 *
 * - Errors the code raises on purpose (HttpException) go out unchanged.
 * - Bad input that only the database notices (a malformed id, a number out of
 *   range, a reference to something that does not exist) becomes a 400 instead
 *   of a 500.
 * - Anything else is logged and answered with a plain 500 that leaks nothing.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (err instanceof HttpException) {
      const body = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'string' ? { code: body } : body);
    }

    // Postgres errors carry a five-character SQLSTATE in `code`.
    const sqlState = typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) && err.severity ? (err.code as string) : null;
    if (sqlState) {
      if (sqlState.startsWith('22') || sqlState === '23503' || sqlState === '23514' || sqlState === '23502') return res.status(400).json({ code: 'invalid_input' });
      if (sqlState === '23505') return res.status(409).json({ code: 'conflict' });
    }

    // Body parser and similar middleware errors (malformed JSON, body too large).
    const status = Number(err?.status ?? err?.statusCode);
    if (status >= 400 && status < 500) return res.status(status).json({ code: status === 413 ? 'too_large' : 'invalid_input' });

    console.error('unhandled error', err);
    return res.status(500).json({ code: 'server_error' });
  }
}
