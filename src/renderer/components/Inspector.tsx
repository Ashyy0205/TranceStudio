import { useEffect, useState } from 'react';
import {
  type Program,
  type Session,
  type Theme,
  type ThemeBlock,
  cloneProgram,
  newId,
  sessionDuration,
  VISUAL_INFO,
  VISUAL_TYPES,
} from '../../shared/types';
import { thumbUrl } from '../engine/media';
import { applyColourPreset, applyLookPreset, COLOUR_PRESETS, LOOK_PRESETS, lookColour, themeColour } from '../presets';
import { addAudioFiles } from './Timeline';
import { useStudio } from '../store';
import { basename, classicText, editorToTexts, formatTime, plural, textsToEditor } from '../util';
import { ColourField, colourToCss, Field, HelpButton, Section, Slider, Stepper, TimeInput, Toggle } from './controls';
import { contextTopic } from './Help';
import { Icon } from './Icon';
import { addFilesToTheme, addFolderAsThemes } from './Library';
import { browseForTheme } from './MediaBrowser';
import { preview } from './Preview';

const edit = (recipe: (s: Session) => void, key?: string) => useStudio.getState().edit(recipe, key);

function editProgram(id: string, fn: (p: Program) => void, key?: string) {
  edit((s) => {
    const p = s.programs.find((x) => x.id === id);
    if (p) fn(p);
  }, key && `${key}-${id}`);
}

// Look editor

function LookEditor({ program, session }: { program: Program; session: Session }) {
  const id = program.id;
  return (
    <>
      <Section title="Visual styles" help="looks#visual-styles">
        <select
          className="input preset-select"
          data-tour="look-preset"
          value=""
          onChange={(e) => {
            const p = LOOK_PRESETS.find((x) => x.id === e.target.value);
            if (!p) return;
            editProgram(id, (x) => {
              applyLookPreset(x, p);
              // Name the look after the preset unless it has been given its own name.
              if (x.name === 'Default' || LOOK_PRESETS.some((q) => q.name === x.name)) x.name = p.name;
            });
          }}
          aria-label="Apply a preset"
        >
          <option value="" disabled>
            Apply a preset...
          </option>
          {LOOK_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}: {p.description}
            </option>
          ))}
        </select>
        <div className="visual-list">
          {VISUAL_TYPES.map((v) => {
            const w = program.visuals[v];
            return (
              <div key={v} className={`visual-row ${w > 0 ? 'on' : ''}`}>
                <Toggle
                  checked={w > 0}
                  onChange={(on) =>
                    editProgram(id, (p) => {
                      p.visuals[v] = on ? 1 : 0;
                      if (!VISUAL_TYPES.some((x) => p.visuals[x] > 0)) p.visuals[v] = 1;
                    })
                  }
                  label={
                    <span title={VISUAL_INFO[v].description}>
                      {VISUAL_INFO[v].label}
                      <span className="visual-desc">{VISUAL_INFO[v].description}</span>
                    </span>
                  }
                />
                {w > 0 && (
                  <span title="How often this style is chosen relative to the others">
                    <Stepper value={w} min={1} max={9} onChange={(n) => editProgram(id, (p) => (p.visuals[v] = n))} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Motion" help="looks#motion">
        <Slider
          label="Speed"
          value={program.speed}
          min={30}
          max={240}
          defaultValue={120}
          format={(v) => `${Math.round((v / 120) * 100)}%`}
          hint="Original trance speed is 100%."
          onChange={(v) => editProgram(id, (p) => (p.speed = v), 'speed')}
        />
        <Slider
          label="Zoom"
          value={Math.round(program.zoomIntensity * 100)}
          min={0}
          max={100}
          defaultValue={50}
          format={(v) => `${v}%`}
          onChange={(v) => editProgram(id, (p) => (p.zoomIntensity = v / 100), 'zoom')}
        />
      </Section>

      <Section title="Colours" help="looks#colours">
        <div className="swatch-row compact">
          {COLOUR_PRESETS.map((c) => (
            <button
              key={c.id}
              className="colour-preset"
              title={c.name}
              onClick={() => editProgram(id, (p) => applyColourPreset(p, c))}
            >
              <span
                className="colour-preset-chip"
                style={{
                  background: `conic-gradient(${colourToCss(c.spiralA, 1)} 0 25%, ${colourToCss(c.spiralB, 1)} 0 50%, ${colourToCss(c.spiralA, 1)} 0 75%, ${colourToCss(c.spiralB, 1)} 0)`,
                }}
              />
            </button>
          ))}
        </div>
        <ColourField label="Spiral A" value={program.spiralColourA} onChange={(c) => editProgram(id, (p) => (p.spiralColourA = c), 'sa')} />
        <ColourField label="Spiral B" value={program.spiralColourB} onChange={(c) => editProgram(id, (p) => (p.spiralColourB = c), 'sb')} />
        <Toggle
          checked={program.reverseSpiral}
          onChange={(v) => editProgram(id, (p) => (p.reverseSpiral = v))}
          label="Reverse spiral direction"
        />
        <ColourField label="Text" value={program.textColour} onChange={(c) => editProgram(id, (p) => (p.textColour = c), 'tc')} />
        <ColourField label="Text shadow & subtext" value={program.shadowColour} onChange={(c) => editProgram(id, (p) => (p.shadowColour = c), 'sc')} />
      </Section>

    </>
  );
}

// Look block

function LookBlockControls({ index, count, duration }: { index: number; count: number; duration: number }) {
  return (
    <div className="row wrap gap-s">
      <Field label="Duration">
        <TimeInput value={duration} min={1} onChange={(v) => edit((s) => void (s.blocks[index].duration = v))} />
      </Field>
      <div className="row gap-xs push-end">
        <button className="icon-btn" title="Move earlier" disabled={index === 0} onClick={() => edit((s) => {
          const [b] = s.blocks.splice(index, 1);
          s.blocks.splice(index - 1, 0, b);
        })}>
          <Icon name="left" />
        </button>
        <button className="icon-btn" title="Move later" disabled={index === count - 1} onClick={() => edit((s) => {
          const [b] = s.blocks.splice(index, 1);
          s.blocks.splice(index + 1, 0, b);
        })}>
          <Icon name="right" />
        </button>
        <button className="icon-btn" title="Duplicate block (with its own copy of the look)" onClick={() => edit((s) => {
          const src = s.programs.find((p) => p.id === s.blocks[index].programId);
          if (!src) return;
          const copy = cloneProgram(src, `${src.name} copy`);
          s.programs.push(copy);
          s.blocks.splice(index + 1, 0, { ...s.blocks[index], id: newId(), programId: copy.id });
        })}>
          <Icon name="copy" />
        </button>
        <button
          className="icon-btn danger"
          title="Delete block (Delete)"
          onClick={() => {
            edit((s) => void s.blocks.splice(index, 1));
            useStudio.getState().select(null);
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}

function BlockInspector({ session, blockId }: { session: Session; blockId: string }) {
  const index = session.blocks.findIndex((b) => b.id === blockId);
  const block = session.blocks[index];
  const program = session.programs.find((p) => p.id === block?.programId);
  if (!block || !program) return null;
  const start = session.blocks.slice(0, index).reduce((t, b) => t + b.duration, 0);

  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <span className="title-dot" style={{ background: lookColour(program.id, session.programs) }} />
        Look block {index + 1}
        <span className="muted small">starts {formatTime(start)}</span>
      </div>

      <LookBlockControls index={index} count={session.blocks.length} duration={block.duration} />

      <Field label="Look name">
        <input
          className="input"
          value={program.name}
          onChange={(e) => editProgram(program.id, (p) => (p.name = e.target.value), 'name')}
        />
      </Field>

      <LookEditor program={program} session={session} />
    </div>
  );
}

// Audio

function AudioInspector({ session, clipId }: { session: Session; clipId: string }) {
  const index = session.audio.findIndex((a) => a.id === clipId);
  const clip = session.audio[index];
  if (!clip) return null;
  const set = (fn: (c: typeof clip) => void, key?: string) =>
    edit((s) => {
      const c = s.audio.find((a) => a.id === clipId);
      if (c) fn(c);
    }, key && `${key}-${clipId}`);
  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <Icon name="music" /> <span className="ellipsis" title={clip.path}>{basename(clip.path)}</span>
      </div>
      <div className="muted small">
        Plays {formatTime(clip.start)} to {formatTime(clip.start + clip.duration)} (length {formatTime(clip.duration)})
      </div>
      <Field label="Channel">
        <select className="input" value={clip.channel} onChange={(e) => set((c) => (c.channel = Number(e.target.value)))}>
          {session.audioChannels.map((ch, i) => (
            <option key={ch.id} value={i}>
              A{i + 1}: {ch.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="row gap-s">
        <Field label="Starts at">
          <TimeInput value={clip.start} onChange={(v) => set((c) => (c.start = v))} />
        </Field>
        <button className="btn small" onClick={() => preview.seek(clip.start)}>
          Jump to start
        </button>
      </div>
      <Slider label="Volume" value={Math.round(clip.volume * 100)} min={0} max={200} defaultValue={100} format={(v) => `${v}%`} onChange={(v) => set((c) => (c.volume = v / 100), 'vol')} />
      <Slider label="Fade in" value={clip.fadeIn} min={0} max={30} step={0.5} defaultValue={0} format={(v) => `${v}s`} onChange={(v) => set((c) => (c.fadeIn = v), 'fi')} />
      <Slider label="Fade out" value={clip.fadeOut} min={0} max={30} step={0.5} defaultValue={2} format={(v) => `${v}s`} onChange={(v) => set((c) => (c.fadeOut = v), 'fo')} />
      <div className="row gap-s">
        <button
          className="btn small danger"
          onClick={() => {
            edit((s) => void s.audio.splice(index, 1));
            useStudio.getState().select(null);
          }}
        >
          <Icon name="trash" size={15} /> Remove
        </button>
      </div>
    </div>
  );
}

// Theme

function ThemeInspector({ session, themeId, embedded }: { session: Session; themeId: string; embedded?: boolean }) {
  const theme = session.themes.find((t) => t.id === themeId);
  const [text, setText] = useState('');
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setText(textsToEditor(theme?.texts ?? [])), [themeId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!theme) return null;

  const set = (fn: (t: Theme) => void, key?: string) =>
    edit((s) => {
      const t = s.themes.find((x) => x.id === themeId);
      if (t) fn(t);
    }, key && `${key}-${themeId}`);
  const commitText = (value: string) => set((t) => (t.texts = editorToTexts(value)), 'text');
  const images = showAll ? theme.images : theme.images.slice(0, 60);

  const content = (
    <>
      <Field label="Theme name">
        <input className="input" value={theme.name} onChange={(e) => set((t) => (t.name = e.target.value), 'name')} />
      </Field>
      <div className="row wrap gap-xs">
        <button className="btn small primary" onClick={() => browseForTheme(themeId)} title="Pick media from your folders with thumbnails (F1)">
          <Icon name="image" size={15} /> Browse media
        </button>
        <button className="btn small" onClick={async () => addFilesToTheme(await window.trance.openFiles('media'), themeId)}>
          Add files...
        </button>
        <button className="btn small" onClick={async () => {
          const f = await window.trance.openFolder();
          if (f) await addFolderAsThemes(f);
        }}>
          <Icon name="folder" size={15} /> Add folder
        </button>
      </div>

      <Section title={`Phrases (${theme.texts.length})`} help="media-and-themes#what-a-theme-holds">
        <textarea
          className="input textarea"
          data-tour="phrases"
          rows={8}
          value={text}
          placeholder={'One phrase per line\nUse / to split over two rows'}
          onChange={(e) => {
            setText(e.target.value);
            commitText(e.target.value);
          }}
        />
        <div className="row wrap gap-xs">
          <button className="btn small" onClick={async () => {
            const files = await window.trance.openFiles('text');
            const lines: string[] = [];
            for (const f of files) lines.push(...(await window.trance.readTextFile(f, false)));
            const next = [...theme.texts, ...lines];
            set((t) => (t.texts = next));
            setText(textsToEditor(next));
          }}>
            Import .txt...
          </button>
          <button
            className="btn small"
            title="UPPERCASE every phrase and split long ones over two rows, like the original trance"
            onClick={() => {
              const next = theme.texts.map(classicText);
              set((t) => (t.texts = next));
              setText(textsToEditor(next));
            }}
          >
            Make classic style
          </button>
        </div>
      </Section>

      <Section title={`Images (${theme.images.length})`}>
        <div className="thumb-grid">
          {images.map((p) => (
            <div key={p} className="thumb" title={basename(p)}>
              <img src={thumbUrl(p)} loading="lazy" decoding="async" alt="" />
              <button className="thumb-remove" onClick={() => set((t) => (t.images = t.images.filter((x) => x !== p)))} aria-label="Remove image">
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
        {theme.images.length > 60 && !showAll && (
          <button className="btn small ghost" onClick={() => setShowAll(true)}>
            Show all {theme.images.length}
          </button>
        )}
      </Section>

      <Section title={`Videos (${theme.animations.length})`}>
        <FileList items={theme.animations} icon="film" onRemove={(p) => set((t) => (t.animations = t.animations.filter((x) => x !== p)))} />
      </Section>

      <Section
        title={`Fonts (${theme.fonts.length})`}
        actions={
          <button className="icon-btn small" title="Add fonts" onClick={async () => addFilesToTheme(await window.trance.openFiles('fonts'), themeId)}>
            <Icon name="plus" size={15} />
          </button>
        }
      >
        {!theme.fonts.length && <div className="muted small">Using the built-in font.</div>}
        <FileList items={theme.fonts} icon="font" onRemove={(p) => set((t) => (t.fonts = t.fonts.filter((x) => x !== p)))} />
      </Section>

      <button
        className="btn small danger"
        onClick={() => {
          if (!window.confirm(`Remove theme "${theme.name}"? Your files are not deleted.`)) return;
          edit((s) => {
            s.themes = s.themes.filter((t) => t.id !== themeId);
            s.themeBlocks = s.themeBlocks.filter((b) => b.themeId !== themeId);
          });
          useStudio.getState().select(null);
        }}
      >
        <Icon name="trash" size={15} /> Remove theme
      </button>
    </>
  );
  return embedded ? content : <div className="inspector-body">{content}</div>;
}

// Theme block

function ThemeBlockInspector({ session, blockId }: { session: Session; blockId: string }) {
  const block = session.themeBlocks.find((b) => b.id === blockId);
  if (!block) return null;
  const set = (fn: (b: ThemeBlock) => void, key?: string) =>
    edit((s) => {
      const b = s.themeBlocks.find((x) => x.id === blockId);
      if (b) fn(b);
    }, key && `${key}-${blockId}`);
  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <span className="title-dot" style={{ background: themeColour(block.themeId, session.themes) }} />
        Theme block
        <span className="muted small">
          {formatTime(block.start)} to {formatTime(block.start + block.duration)}
        </span>
      </div>
      <div className="row wrap gap-s">
        <Field label="Starts at">
          <TimeInput value={block.start} onChange={(v) => set((b) => (b.start = v))} />
        </Field>
        <Field label="Duration">
          <TimeInput value={block.duration} min={1} onChange={(v) => set((b) => (b.duration = v))} />
        </Field>
        <div className="row gap-xs push-end">
          <button className="icon-btn" title="Jump to the start of this block" onClick={() => preview.seek(block.start)}>
            <Icon name="toStart" />
          </button>
          <button
            className="icon-btn"
            title="Duplicate after this block"
            onClick={() => {
              const id = newId();
              edit((s) => void s.themeBlocks.push({ ...block, id, start: block.start + block.duration }));
              useStudio.getState().select({ kind: 'themeBlock', id });
            }}
          >
            <Icon name="copy" />
          </button>
          <button
            className="icon-btn danger"
            title="Delete block"
            onClick={() => {
              edit((s) => void (s.themeBlocks = s.themeBlocks.filter((b) => b.id !== blockId)));
              useStudio.getState().select(null);
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      <Field label="Theme">
        <div className="row gap-xs">
          <select className="input grow" value={block.themeId} onChange={(e) => set((b) => (b.themeId = e.target.value))}>
            {session.themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            title="New empty theme for this block"
            onClick={() => {
              const id = newId();
              edit((s) => {
                s.themes.push({ id, name: `Theme ${s.themes.length + 1}`, images: [], animations: [], fonts: [], texts: [] });
                const b = s.themeBlocks.find((x) => x.id === blockId);
                if (b) b.themeId = id;
              });
            }}
          >
            <Icon name="plus" />
          </button>
        </div>
      </Field>
      <ThemeInspector session={session} themeId={block.themeId} embedded />
    </div>
  );
}

// Audio channel

function ChannelInspector({ session, index }: { session: Session; index: number }) {
  const channel = session.audioChannels[index];
  if (!channel) return null;
  const set = (fn: (c: typeof channel) => void, key?: string) =>
    edit((s) => fn(s.audioChannels[index]), key && `${key}-ch${index}`);
  const clips = session.audio.filter((a) => a.channel === index).length;
  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <span className="track-id audio">A{index + 1}</span> {channel.name}
        <span className="muted small">{plural(clips, 'clip')}</span>
      </div>
      <Field label="Channel name">
        <input className="input" value={channel.name} onChange={(e) => set((c) => (c.name = e.target.value), 'name')} />
      </Field>
      <Slider
        label="Channel volume"
        value={Math.round(channel.volume * 100)}
        min={0}
        max={200}
        defaultValue={100}
        format={(v) => `${v}%`}
        onChange={(v) => set((c) => (c.volume = v / 100), 'vol')}
      />
      <Toggle checked={channel.muted} onChange={(v) => set((c) => (c.muted = v))} label="Mute this channel" />
      <button className="btn small" onClick={async () => addAudioFiles(await window.trance.openFiles('audio'), undefined, index)}>
        <Icon name="music" size={15} /> Add audio to this channel...
      </button>
    </div>
  );
}

function FileList({ items, icon, onRemove }: { items: string[]; icon: string; onRemove: (p: string) => void }) {
  return (
    <div className="file-list">
      {items.map((p) => (
        <div key={p} className="file-row" title={p}>
          <Icon name={icon} size={14} />
          <span className="grow ellipsis">{basename(p)}</span>
          <button className="icon-btn small" onClick={() => onRemove(p)} aria-label="Remove">
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// Session

function SessionInspector({ session }: { session: Session }) {
  const totals = session.themes.reduce(
    (a, t) => ({ i: a.i + t.images.length, an: a.an + t.animations.length, tx: a.tx + t.texts.length }),
    { i: 0, an: 0, tx: 0 },
  );
  return (
    <div className="inspector-body">
      <Field label="Session name">
        <input className="input" value={session.name} onChange={(e) => edit((s) => void (s.name = e.target.value), 'session-name')} />
      </Field>
      <div className="stat-grid">
        <div><span>Length</span><b>{formatTime(sessionDuration(session))}</b></div>
        <div><span>Themes</span><b>{session.themes.length}</b></div>
        <div><span>Images</span><b>{totals.i}</b></div>
        <div><span>Videos</span><b>{totals.an}</b></div>
        <div><span>Phrases</span><b>{totals.tx}</b></div>
        <div><span>Audio clips</span><b>{session.audio.length}</b></div>
      </div>
      <p className="inspector-note">
        Click any block or clip on the timeline to change it here. Looks set how things are shown, theme blocks
        set which media and phrases are shown, and audio plays on its own channels. The rows are independent, so
        a block on one row can span several blocks on another.
      </p>
      <Section title="Playback" help="looks#session-settings">
        <Slider
          label="Images in memory"
          value={session.playback.imageCacheSize}
          min={16}
          max={256}
          step={8}
          defaultValue={64}
          hint="More gives more variety between theme changes, but uses more memory."
          onChange={(v) => edit((s) => void (s.playback.imageCacheSize = v), 'cache')}
        />
        <Slider
          label="Zoom depth"
          value={Math.round(session.playback.drawDepth * 100)}
          min={0}
          max={100}
          defaultValue={50}
          format={(v) => `${v}%`}
          hint="How far images and the spiral appear to recede."
          onChange={(v) => edit((s) => void (s.playback.drawDepth = v / 100), 'depth')}
        />
      </Section>
      <div className="muted small">{plural(session.programs.length, 'look')} in this session.</div>
    </div>
  );
}

export function Inspector() {
  const session = useStudio((s) => s.session)!;
  const selection = useStudio((s) => s.selection);
  let body = <SessionInspector session={session} />;
  let title = 'Session settings';
  if (selection?.kind === 'block' && session.blocks.some((b) => b.id === selection.id)) {
    body = <BlockInspector session={session} blockId={selection.id} />;
    title = 'Look block';
  } else if (selection?.kind === 'audio' && session.audio.some((a) => a.id === selection.id)) {
    body = <AudioInspector session={session} clipId={selection.id} />;
    title = 'Audio clip';
  } else if (selection?.kind === 'themeBlock' && session.themeBlocks.some((b) => b.id === selection.id)) {
    body = <ThemeBlockInspector session={session} blockId={selection.id} />;
    title = 'Theme block';
  } else if (selection?.kind === 'channel' && session.audioChannels[selection.index]) {
    body = <ChannelInspector session={session} index={selection.index} />;
    title = 'Audio channel';
  } else if (selection?.kind === 'theme' && session.themes.some((t) => t.id === selection.id)) {
    body = <ThemeInspector session={session} themeId={selection.id} />;
    title = 'Theme';
  }
  return (
    <aside className="inspector">
      <div className="panel-tab-bar">
        <span className="panel-tab active">Inspector</span>
        <span className="panel-sub">{title}</span>
        <span className="grow" />
        <HelpButton topic={contextTopic()} label={title.toLowerCase()} />
        {selection && (
          <button className="icon-btn" title="Show session settings" onClick={() => useStudio.getState().select(null)}>
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="inspector-scroll">{body}</div>
    </aside>
  );
}
