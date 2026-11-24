export function formatTime(seconds: number, showHours = false): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  if (h || showHours) return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  return `${m}:${sec}`;
}

// Parses "90", "1:30" or "1:02:03" into seconds.
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':').map((p) => p.trim());
  if (!parts.length || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Port of trance's split_text_line() for the "classic text" option.
export function splitTextLine(text: string): string {
  let l = Math.floor(text.length / 2);
  let r = l;
  for (;;) {
    if (text[r] === ' ') return text.slice(0, r) + '\n' + text.slice(r + 1);
    if (text[l] === ' ') return text.slice(0, l) + '\n' + text.slice(l + 1);
    if (l === 0 || r >= text.length - 1) break;
    --l;
    ++r;
  }
  return text;
}

// Text lines are stored with '\n' row breaks; the editor shows them as " / ".
export function textsToEditor(texts: string[]): string {
  return texts.map((t) => t.replace(/\n/g, ' / ')).join('\n');
}

export function editorToTexts(value: string): string[] {
  return value
    .split('\n')
    .map((line) =>
      line
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean);
}

export function classicText(t: string): string {
  return splitTextLine(t.replace(/\n/g, ' ').toUpperCase());
}

// Editing-style timecode: HH:MM:SS or HH:MM:SS:FF when fps is given.
export function formatTimecode(seconds: number, fps?: number): string {
  const t = Math.max(0, seconds);
  const s = Math.floor(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  if (!fps) return base;
  return `${base}:${pad(Math.min(fps - 1, Math.floor((t - s) * fps)))}`;
}
