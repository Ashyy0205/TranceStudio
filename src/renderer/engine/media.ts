import { Tex } from './texture';

// Local files are served to the renderer through the tmedia:// protocol
// registered by the main process.
export function mediaUrl(path: string): string {
  return `tmedia://local/${encodeURIComponent(path)}`;
}

// Small cached thumbnail (images, GIFs and videos) for lists and grids.
export function thumbUrl(path: string): string {
  return `tthumb://local/${encodeURIComponent(path)}`;
}

// Decodes an image, downscaling very large ones so memory stays bounded.
// maxW/maxH is the largest size the image could usefully be shown at.
export async function loadTex(path: string, maxW: number, maxH: number): Promise<Tex | null> {
  try {
    const res = await fetch(mediaUrl(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    let bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
    if (scale < 1) {
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
        resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
        resizeQuality: 'high',
      });
      bitmap.close();
      bitmap = resized;
    }
    return new Tex(bitmap);
  } catch (e) {
    console.warn('couldn\'t load', path, e);
    return null;
  }
}
