/* Shared, pure layout helpers for chart overlays (order-book walls, Smart Money Map zones):
 * nothing here touches a canvas or the DOM, so the exact same code is unit-tested in Node and run
 * in the browser (window.SmlChartLayout). Two problems these solve, both visible when several
 * markers land close together on a zoomed-in chart:
 * - bands/boxes that blend into each other because nothing merges levels that are only a few
 *   pixels apart, or bounds how far a box may extend;
 * - text labels that collide, because each overlay category places its own labels with no idea
 *   another category (or another label in the same category) is sitting in the same spot. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmlChartLayout = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* Collapses items whose pixel position lands within mergeGapPx of each other into one group,
     combine(members, y) turns a group into the final drawn item. yFor(item) -> pixel position.
     Output is sorted by position ascending. */
  function mergeByPixel(items, yFor, mergeGapPx, combine) {
    const sorted = items.map((item) => ({ item, y: yFor(item) })).sort((a, b) => a.y - b.y);
    const groups = [];
    for (const { item, y } of sorted) {
      const last = groups[groups.length - 1];
      // Chain adjacency is judged against the last member actually added, not the group's running
      // average — otherwise a long run of items each just within the gap of its neighbor can drift
      // the average far enough away that the chain stops merging partway through.
      if (last && y - last.lastY < mergeGapPx) { last.members.push(item); last.sumY += y; last.lastY = y; }
      else groups.push({ members: [item], sumY: y, lastY: y });
    }
    return groups.map((g) => combine(g.members, g.sumY / g.members.length));
  }

  /* Places each label at its own natural position, then pushes any label that would land within
     minGapPx of the previously placed one straight down (increasing position) until it clears it.
     Input must already be sorted by naturalPos ascending — the result is guaranteed collision-free
     against its immediate predecessor, which for sorted input is sufficient for the whole set. */
  function stackLabels(items, naturalPosFor, minGapPx) {
    let lastPos = -Infinity;
    return items.map((item) => {
      const naturalPos = naturalPosFor(item);
      const pos = naturalPos - lastPos < minGapPx ? lastPos + minGapPx : naturalPos;
      lastPos = pos;
      return { item, naturalPos, pos };
    });
  }

  /* General-purpose 2D label collision avoidance across categories that don't share one natural
     ordering. Each box is {x, y, w, h}; a box that overlaps an already-accepted one is nudged down
     by its own height and retried, capped at maxTries so a crowded chart degrades to "a bit
     stacked" instead of looping. Returns the same objects with their placed y. */
  function avoidOverlap(boxes, maxTries = 6) {
    const placed = [];
    const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    return boxes.map((box) => {
      let y = box.y, tries = 0;
      while (tries < maxTries && placed.some((p) => overlaps({ ...box, y }, p))) { y += box.h; tries += 1; }
      const out = { ...box, y };
      placed.push(out);
      return out;
    });
  }

  /* Bounds how many bars ahead of its origin a zone box (fair-value gap, order block) may extend:
     never past the chart's own visible end, and never more than maxBars — so at a high zoom (few
     bars visible), a box cannot always reach all the way to the chart's edge and dwarf the candles
     it is meant to annotate. endBarIndex is the bar it would otherwise extend to (e.g. M.end, or
     where it was filled). */
  function boundZoneEndBar(originBarIndex, endBarIndex, maxBars) {
    return Math.min(endBarIndex, originBarIndex + maxBars);
  }

  return { mergeByPixel, stackLabels, avoidOverlap, boundZoneEndBar };
});
