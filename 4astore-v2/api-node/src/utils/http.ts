import { Response } from 'express';

/** Standard success envelope: { success: true, ...payload } */
export function ok(res: Response, payload: Record<string, unknown> = {}, status = 200) {
  return res.status(status).json({ success: true, ...payload });
}

/** Standard failure envelope: { success: false, message } */
export function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, message });
}
