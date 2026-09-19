/**
 * The actor's `DocPort`, over the notes repository (#48). **Track T1 owns this file** — the lead
 * placed only the stub, which behaves as "this room has no doc" until T1 lands.
 */

import { NO_DOC, type DocPort } from '../../room/docport.js';
import type { DocHost } from '../dochost.js';

export function createDocPort(
  _host: DocHost,
  _file: { fileId: string | null; contentSha: string | null; roomId: string },
): DocPort {
  return NO_DOC;
}
