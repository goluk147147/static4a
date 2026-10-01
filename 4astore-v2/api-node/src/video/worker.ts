// Child process that does the CPU-heavy canvas + ffmpeg work, so the API server's
// event loop never blocks. Started by queue.ts with child_process.fork (one job each).
import '../systemCa'; // product image downloads behind corporate TLS proxies
import { renderVideo, renderPreviews } from './render';
import type { RenderOptions } from './types';

export type WorkerTask =
  | { kind: 'render'; options: RenderOptions; outDir: string; baseName: string }
  | { kind: 'preview'; options: RenderOptions };

export type WorkerMessage =
  | { type: 'progress'; pct: number }
  | { type: 'done'; result: { sizeBytes: number; brokenImages: number } }
  | { type: 'preview'; frames: { t: number; png: string }[] }
  | { type: 'error'; message: string };

const send = (m: WorkerMessage) => new Promise<void>((r) => (process.send ? process.send(m, () => r()) : r()));

process.once('message', async (task: WorkerTask) => {
  try {
    if (task.kind === 'preview') {
      const shots = await renderPreviews(task.options, 4);
      await send({ type: 'preview', frames: shots.map((s) => ({ t: s.t, png: s.png.toString('base64') })) });
    } else {
      let last = -1;
      const r = await renderVideo(task.options, task.outDir, task.baseName, (pct) => {
        if (pct >= last + 2 || pct === 100) {
          last = pct;
          void send({ type: 'progress', pct });
        }
      });
      await send({ type: 'done', result: { sizeBytes: r.sizeBytes, brokenImages: r.brokenImages } });
    }
    process.exit(0);
  } catch (e) {
    await send({ type: 'error', message: (e as Error).message || String(e) });
    process.exit(1);
  }
});
