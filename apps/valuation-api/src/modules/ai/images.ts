import { createCanvas, loadImage } from '@napi-rs/canvas';

const MAX_SIDE = 1568;

// Shrinks a picture to what the AI can use (and what is cheap to send) and returns it as base64 JPEG.
export async function toJpegBase64(data: Buffer): Promise<string> {
  const image = await loadImage(data);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/jpeg', 80).toString('base64');
}

export const imageBlock = (base64: string) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: base64 } });
