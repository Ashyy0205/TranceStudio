import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Styled tooltips for every element with a `title`. The title is moved to
// data-tip on first hover so the browser's own tooltip doesn't also appear.
//
// Text format: an optional shortcut in brackets anywhere ("Save (Ctrl+S)") is
// shown as a key, and a line break separates a heading from a longer
// explanation.

const KEY_RE = /\s*\(((?:Ctrl|Shift|Alt)\+[^)]*|F\d{1,2}|Space|Enter|Esc|Home|End|Delete)\)/;
const SHOW_DELAY = 550;
// Moving straight from one tooltip to the next shows it without the delay.
const WARM_MS = 400;

function parse(text: string) {
  let key: string | null = null;
  const m = text.match(KEY_RE);
  if (m) {
    key = m[1];
    text = text.replace(m[0], '');
  }
  const [head, ...rest] = text.split('\n');
  return { head: head.trim(), body: rest.join(' ').trim(), key };
}

function tipText(el: HTMLElement): string {
  const title = el.getAttribute('title');
  if (title) {
    el.dataset.tip = title;
    el.removeAttribute('title');
    // Icon-only buttons used the title as their accessible name.
    if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title.split('\n')[0]);
  }
  return el.dataset.tip ?? '';
}

export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    let shown = false;
    let lastHidden = 0;
    const hide = () => {
      clearTimeout(timer);
      if (shown) lastHidden = performance.now();
      shown = false;
      current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      // No tooltips while dragging.
      if (e.buttons) return hide();
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[title], [data-tip]') : null;
      if (el === current) return;
      const warm = shown || performance.now() - lastHidden < WARM_MS;
      hide();
      if (!el) return;
      const text = tipText(el);
      if (!text) return;
      current = el;
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        shown = true;
        setTip({ text: tipText(el), rect: el.getBoundingClientRect() });
      }, warm ? 40 : SHOW_DELAY);
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };
    window.addEventListener('pointerover', onOver, true);
    window.addEventListener('pointerout', onOut, true);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerover', onOver, true);
      window.removeEventListener('pointerout', onOut, true);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null);
    const { width, height } = ref.current.getBoundingClientRect();
    const r = tip.rect;
    const left = Math.max(6, Math.min(window.innerWidth - width - 6, r.left + r.width / 2 - width / 2));
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 6) top = Math.max(6, r.top - height - 6);
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  const { head, body, key } = parse(tip.text);
  return (
    <div
      ref={ref}
      className={`tooltip ${body ? 'rich' : ''}`}
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <div className="tooltip-head">
        <span>{head}</span>
        {key && <kbd>{key}</kbd>}
      </div>
      {body && <div className="tooltip-body">{body}</div>}
    </div>
  );
}
