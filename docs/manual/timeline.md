# The timeline

The timeline runs along the bottom of the Edit page. Each row is independent of the others.

- V1 Looks holds look blocks, which set how things are shown.
- TH Themes holds theme blocks, which set which media and phrases are shown.
- A1 Foreground and A2 Background hold audio clips.

The session ends when the last item on any row ends. The grey line in the ruler marks the end, and the red line is the playhead.

## Moving around

Click or drag in the ruler to move the playhead. Ctrl+scroll over the timeline, or the zoom buttons at the
top right, zoom in and out. Home jumps to the start and End to the end.

Click any block or clip to select it and change it in the inspector on the right. Delete removes the
selected item. Ctrl+Z undoes.

## Looks row

Look blocks play one after another from the start, with no gaps. Drag the right edge of a block to change
its length, in 5 second steps, or 1 second steps while holding Shift. The + button at the end of the row
adds a block that starts as a copy of the last look.

If the other rows run past the last look block, the last look keeps playing to the end. A session with no
look blocks uses the default look.

Each block has its own look, so changing one block never changes another. Duplicate a block from the
inspector to reuse a look. See [Looks and visual styles](looks.md).

## Themes row

Theme blocks can go anywhere on the row and have any length, but they cannot overlap each other. Drag a
block to move it, or drag its edges to change when it starts and stops. Edges snap to the edges of other
blocks and clips and to the playhead; hold Alt while dragging to place them freely.

To add a block, drag a theme from the Themes panel onto the row, or click + on the row label to add one at
the playhead. The new block lines up with the look block underneath: it starts where that look starts, or
where the free space starts if another theme block is in the way, and lasts until the look ends. Past the
last look it starts where you dropped it and lasts 5 minutes. With the block selected you can pick a
different theme for it in the inspector.

Where the row is empty, every theme plays together. An empty row with themes in the session offers "Lay
out themes one after another", which gives each theme an equal share of the session.

## Audio rows

See [Audio](audio.md).
