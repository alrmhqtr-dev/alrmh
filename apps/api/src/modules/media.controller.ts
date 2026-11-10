import { Controller, Get, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { db } from '../db.js';
import { fail } from '../lib.js';
import { CurrentStaff, Managers, audit, type StaffUser } from '../staff.js';

export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MEDIA_LIMIT = '2mb';
/** What a stored photo's address looks like; products keep this path, not a full URL, so the API can change address. */
export const MEDIA_PATH = /^\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The file's own first bytes decide what it is, not the header the browser sent. */
function sniff(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

@Controller('v1')
export class MediaController {
  /** Upload: the request body is the image itself (JPEG, PNG or WebP, up to 2 MB). */
  @Post('admin/media')
  @UseGuards(Managers)
  async upload(@CurrentStaff() me: StaffUser, @Req() req: Request) {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) fail('invalid_image');
    const type = sniff(body);
    if (!type) fail('invalid_image');
    const row = await db.one<{ id: string }>('insert into media (content_type, bytes, size, staff_id) values ($1, $2, $3, $4) returning id', [type, body, body.length, me.id]);
    await audit(me, 'create', 'media', row!.id, { type, size: body.length });
    return { id: row!.id, url: `/v1/media/${row!.id}`, size: body.length };
  }

  @Get('media/:id')
  async serve(@Param('id') id: string, @Res() res: Response) {
    const m = await db.one<{ content_type: string; bytes: Buffer }>('select content_type, bytes from media where id = $1', [id]);
    if (!m) throw new NotFoundException({ code: 'not_found' });
    // A photo never changes under its address, so phones can keep it.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.type(m.content_type).send(m.bytes);
  }
}
