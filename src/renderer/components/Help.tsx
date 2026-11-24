import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useOnboarding } from '../onboarding';
import { useStudio } from '../store';
import { Icon } from './Icon';
import { startTutorial } from './Tour';

// The manual lives in docs/manual so it can also be read on GitHub. The files
// are bundled into the app at build time.
const RAW = import.meta.glob('../../../docs/manual/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const ORDER = ['getting-started', 'media-and-themes', 'timeline', 'looks', 'audio', 'watching-and-exporting', 'shortcuts'];

type Block = { kind: 'h1' | 'h2' | 'h3' | 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

interface Topic {
  id: string;
  title: string;
  blocks: Block[];
}

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Handles the small subset of Markdown the manual uses: headings, paragraphs,
// lists, `code`, **bold** and links.
function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ') });
    if (list) out.push(list);
    para = [];
    list = null;
  };
  for (const line of md.replace(/\r/g, '').split('\n')) {
    const h = line.match(/^(#{1,3}) (.*)$/);
    const item = line.match(/^(?:([-*])|\d+\.) (.*)$/);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      out.push({ kind: `h${h[1].length}` as 'h1' | 'h2' | 'h3', text: h[2].trim() });
    } else if (item) {
      const kind = item[1] ? 'ul' : 'ol';
      if (para.length || (list && list.kind !== kind)) flush();
      list ??= { kind, items: [] };
      list.items.push(item[2].trim());
    } else if (list && /^\s/.test(line)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

export const TOPICS: Topic[] = ORDER.map((id) => {
  const raw = RAW[`../../../docs/manual/${id}.md`] ?? `# ${id}\n\nMissing.`;
  const blocks = parseBlocks(raw);
  const h1 = blocks.find((b) => b.kind === 'h1') as { text: string } | undefined;
  return { id, title: h1?.text ?? id, blocks: blocks.filter((b) => b.kind !== 'h1') };
});

const plain = (text: string) => text.replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
        if (p.startsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [file, anchor] = link[2].split('#');
          const id = file.replace(/\.md$/, '');
          if (TOPICS.some((t) => t.id === id)) {
            return (
              <a key={i} href="#" onClick={(e) => (e.preventDefault(), useStudio.getState().openHelp(anchor ? `${id}#${anchor}` : id))}>
                {link[1]}
              </a>
            );
          }
          return <span key={i}>{link[1]}</span>;
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.kind) {
    case 'h1':
    case 'h2':
    case 'h3': {
      const Tag = b.kind === 'h3' ? 'h4' : 'h3';
      return (
        <Tag key={i} id={`help-${slug(b.text)}`}>
          <Inline text={b.text} />
        </Tag>
      );
    }
    case 'p':
      return (
        <p key={i}>
          <Inline text={b.text} />
        </p>
      );
    default: {
      const Tag = b.kind;
      return (
        <Tag key={i}>
          {b.items.map((t, j) => (
            <li key={j}>
              <Inline text={t} />
            </li>
          ))}
        </Tag>
      );
    }
  }
}

interface Hit {
  topic: Topic;
  heading: string | null;
  snippet: string;
}

function search(query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];
  for (const topic of TOPICS) {
    // Search section by section so a result can jump to the right heading.
    let heading: string | null = null;
    let text = '';
    const sections: { heading: string | null; text: string }[] = [];
    for (const b of topic.blocks) {
      if (b.kind === 'h2') {
        sections.push({ heading, text });
        heading = b.text;
        text = '';
      } else text += ' ' + plain('text' in b ? b.text : b.items.join(' '));
    }
    sections.push({ heading, text });
    for (const s of sections) {
      const hay = `${s.heading ?? topic.title} ${s.text}`;
      const at = hay.toLowerCase().indexOf(q);
      if (at < 0) continue;
      const from = Math.max(0, at - 50);
      const snippet = (from ? '...' : '') + hay.slice(from, at + q.length + 70).trim() + '...';
      hits.push({ topic, heading: s.heading, snippet });
    }
  }
  return hits.slice(0, 30);
}

// The manual topic that fits what the user is looking at.
export function contextTopic(): string {
  const { page, selection, modal, session } = useStudio.getState();
  if (!session) return 'getting-started';
  if (modal === 'export') return 'watching-and-exporting#exporting-a-video';
  if (page === 'media') return 'media-and-themes#the-media-page';
  switch (selection?.kind) {
    case 'block':
      return 'looks';
    case 'themeBlock':
      return 'timeline#themes-row';
    case 'theme':
      return 'media-and-themes';
    case 'audio':
    case 'channel':
      return 'audio';
    default:
      return 'getting-started';
  }
}

export function HelpPanel() {
  const help = useStudio((s) => s.help);
  const hasSession = useStudio((s) => !!s.session);
  const hidden = useOnboarding((s) => s.hidden);
  const [query, setQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => search(query), [query]);
  const close = () => useStudio.getState().openHelp(null);

  const [id, anchor] = (help ?? '').split('#');
  const topic = TOPICS.find((t) => t.id === id) ?? TOPICS[0];

  useEffect(() => {
    if (help === null) return;
    const el = anchor ? bodyRef.current?.querySelector(`#help-${CSS.escape(anchor)}`) : null;
    if (el) el.scrollIntoView({ block: 'start' });
    else bodyRef.current?.scrollTo({ top: 0 });
  }, [help, anchor]);

  useEffect(() => {
    if (help === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useOnboarding.getState().tour) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help]);

  if (help === null) return null;
  const open = (topicId: string) => {
    setQuery('');
    useStudio.getState().openHelp(topicId);
  };

  return (
    <aside className={`help-panel ${hasSession ? 'below-bar' : ''}`} aria-label="Manual">
      <div className="panel-tab-bar">
        <span className="panel-tab active">Manual</span>
        <span className="grow" />
        <input
          className="input help-search"
          placeholder="Search the manual"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the manual"
        />
        <button className="icon-btn" onClick={close} title="Close the manual (Esc)">
          <Icon name="close" />
        </button>
      </div>
      <div className="help-columns">
        <nav className="help-nav">
          {TOPICS.map((t) => (
            <button key={t.id} className={!query && t.id === topic.id ? 'on' : ''} onClick={() => open(t.id)}>
              {t.title}
            </button>
          ))}
          <div className="help-nav-sep" />
          <button
            disabled={!hasSession}
            title={hasSession ? 'Builds a session from your own media, one step at a time' : 'Open or create a session first'}
            onClick={() => {
              close();
              startTutorial();
            }}
          >
            <Icon name="play" size={12} /> First session tutorial
          </button>
          {hidden && (
            <button disabled={!hasSession} onClick={() => useOnboarding.getState().setHidden(false)}>
              <Icon name="check" size={12} /> Show the checklist
            </button>
          )}
        </nav>
        <div className="help-body" ref={bodyRef}>
          {query ? (
            <>
              <h2>Search results</h2>
              {!hits.length && <p className="muted">Nothing in the manual matches "{query}".</p>}
              {hits.map((h, i) => (
                <button
                  key={i}
                  className="help-hit"
                  onClick={() => open(h.heading ? `${h.topic.id}#${slug(h.heading)}` : h.topic.id)}
                >
                  <b>
                    {h.topic.title}
                    {h.heading && ` / ${h.heading}`}
                  </b>
                  <span>{h.snippet}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <h2>{topic.title}</h2>
              {topic.blocks.map(renderBlock)}
              <div className="help-pager">
                {ORDER.indexOf(topic.id) > 0 && (
                  <button className="btn small ghost" onClick={() => open(ORDER[ORDER.indexOf(topic.id) - 1])}>
                    <Icon name="left" size={14} /> {TOPICS[ORDER.indexOf(topic.id) - 1].title}
                  </button>
                )}
                <span className="grow" />
                {ORDER.indexOf(topic.id) < ORDER.length - 1 && (
                  <button className="btn small ghost" onClick={() => open(ORDER[ORDER.indexOf(topic.id) + 1])}>
                    {TOPICS[ORDER.indexOf(topic.id) + 1].title} <Icon name="right" size={14} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
