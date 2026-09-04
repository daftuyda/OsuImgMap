import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeWebUrl,
  clamp,
  constrainRegionMove,
  constrainRegionResize,
  destinationError,
  findFreeRegionPlacement,
  generateBBCode,
  hasRegionOverlaps,
  imageUrlError,
  normalizeRegion,
  regionsOverlap,
  roundGeometry,
  sanitizeInline,
} from "../src/core.js";

test("clamp keeps values inside a range", () => {
  assert.equal(clamp(-1, 0, 100), 0);
  assert.equal(clamp(42, 0, 100), 42);
  assert.equal(clamp(120, 0, 100), 100);
});

test("normalizeRegion creates a valid percentage rectangle", () => {
  assert.deepEqual(
    normalizeRegion(
      {
        id: "one",
        x: 95,
        y: -10,
        width: 20,
        height: 0,
        destination: "",
        title: "  Profile\nlink  ",
      },
      "fallback",
    ),
    {
      id: "one",
      x: 80,
      y: 0,
      width: 20,
      height: 2,
      destination: "#",
      title: "Profile link",
    },
  );
});

test("normalizeRegion keeps independently rounded edges within 100 percent", () => {
  const region = normalizeRegion({
    id: "edge",
    x: 99,
    y: 99,
    width: 2.345,
    height: 2.345,
  });

  assert.deepEqual(
    { x: region.x, y: region.y, width: region.width, height: region.height },
    { x: 97.65, y: 97.65, width: 2.35, height: 2.35 },
  );
  assert.ok(region.x + region.width <= 100);
  assert.ok(region.y + region.height <= 100);
});

test("sanitizeInline removes line breaks without destroying title spaces", () => {
  assert.equal(sanitizeInline("  View\n my\tprofile  "), "View my profile");
});

test("URL validation accepts web URLs and the destination placeholder", () => {
  assert.equal(imageUrlError("https://example.com/banner.png"), "");
  assert.match(imageUrlError("banner.png"), /complete URL/i);
  assert.match(imageUrlError("file:///banner.png"), /http/i);
  assert.equal(destinationError("#"), "");
  assert.equal(destinationError(""), "");
  assert.equal(destinationError("https://osu.ppy.sh/users/1"), "");
  assert.match(destinationError("ftp://example.com/file"), /http/i);
  assert.match(destinationError("https://example.com/bad link"), /spaces/i);
  assert.match(imageUrlError("https:example.com/banner.png"), /complete URL/i);
  assert.match(imageUrlError("https:\\example.com\\banner.png"), /forward slashes/i);
  assert.match(destinationError("https:/example.com/profile"), /complete/i);
  assert.equal(canonicalizeWebUrl("HTTPS://EXAMPLE.COM/image.png"), "https://example.com/image.png");
});

test("geometry rounding handles decimal ties consistently", () => {
  assert.equal(roundGeometry(1.005), 1.01);
  assert.equal(roundGeometry(10.075), 10.08);
  assert.equal(roundGeometry(99.999), 100);
});

test("overlap detection allows contact but rejects positive-area intersections", () => {
  const fixed = { x: 40, y: 30, width: 20, height: 20 };
  assert.equal(regionsOverlap({ x: 20, y: 35, width: 20, height: 10 }, fixed), false);
  assert.equal(
    regionsOverlap({ x: 20.000000000000004, y: 35, width: 20, height: 10 }, fixed),
    false,
  );
  assert.equal(regionsOverlap({ x: 20.01, y: 35, width: 20, height: 10 }, fixed), true);
  assert.equal(regionsOverlap({ x: 20, y: 10, width: 20, height: 20 }, fixed), false);
  assert.equal(regionsOverlap({ x: 30, y: 20, width: 20, height: 20 }, fixed), true);
  assert.equal(hasRegionOverlaps([fixed, { x: 45, y: 35, width: 2, height: 2 }]), true);
});

test("movement cannot tunnel through blockers from any cardinal direction", () => {
  const blocker = { id: "blocker", x: 40, y: 30, width: 20, height: 20 };
  const cases = [
    [{ id: "left", x: 10, y: 35, width: 20, height: 10 }, { x: 70, y: 35 }, { x: 20, y: 35 }],
    [{ id: "right", x: 70, y: 35, width: 20, height: 10 }, { x: 10, y: 35 }, { x: 60, y: 35 }],
    [{ id: "above", x: 45, y: 0, width: 10, height: 20 }, { x: 45, y: 60 }, { x: 45, y: 10 }],
    [{ id: "below", x: 45, y: 60, width: 10, height: 20 }, { x: 45, y: 0 }, { x: 45, y: 50 }],
  ];

  for (const [start, target, expected] of cases) {
    const result = constrainRegionMove(start, target, [blocker]).region;
    assert.deepEqual({ x: result.x, y: result.y }, expected);
    assert.equal(regionsOverlap(result, blocker), false);
  }
});

test("movement ignores orthogonal misses and magnetically snaps near edges", () => {
  const blocker = { id: "blocker", x: 40, y: 30, width: 20, height: 20 };
  const miss = constrainRegionMove(
    { id: "moving", x: 10, y: 5, width: 20, height: 20 },
    { x: 70, y: 5 },
    [blocker],
  ).region;
  assert.equal(miss.x, 70);

  const snapped = constrainRegionMove(
    { id: "moving", x: 10, y: 35, width: 20, height: 10 },
    { x: 18.7, y: 35 },
    [blocker],
    { x: 2, y: 2 },
  );
  assert.equal(snapped.region.x, 20);
  assert.equal(snapped.guides.x, 40);
});

test("movement distinguishes hard constraints from magnetic alignment", () => {
  const start = { id: "moving", x: 0, y: 10, width: 20, height: 20 };
  const blocker = { id: "blocker", x: 30, y: 10, width: 20, height: 20 };

  const aligned = constrainRegionMove(
    start,
    { ...start, x: 9 },
    [blocker],
    { x: 2, y: 2 },
  );
  assert.equal(aligned.region.x, 10);
  assert.deepEqual(aligned.blockedAxes, { x: false, y: false });

  const blocked = constrainRegionMove(start, { ...start, x: 25, y: 14 }, [blocker]);
  assert.deepEqual({ x: blocked.region.x, y: blocked.region.y }, { x: 10, y: 14 });
  assert.deepEqual(blocked.blockedAxes, { x: true, y: false });

  const bounded = constrainRegionMove(start, { ...start, x: -15, y: 14 });
  assert.deepEqual({ x: bounded.region.x, y: bounded.region.y }, { x: 0, y: 14 });
  assert.deepEqual(bounded.blockedAxes, { x: true, y: false });
});

test("movement can pass a zero-area corner contact", () => {
  const blocker = { id: "blocker", x: 40, y: 30, width: 20, height: 20 };
  const moved = constrainRegionMove(
    { id: "moving", x: 10, y: 0, width: 20, height: 20 },
    { x: 70, y: 12 },
    [blocker],
  ).region;

  assert.deepEqual({ x: moved.x, y: moved.y }, { x: 70, y: 12 });
  assert.equal(regionsOverlap(moved, blocker), false);
});

test("cardinal resizes stop at blockers and preserve their opposite edge", () => {
  const blocker = { id: "blocker", x: 40, y: 30, width: 20, height: 20 };
  const east = constrainRegionResize(
    { id: "east", x: 10, y: 35, width: 20, height: 10 },
    { x: 10, y: 35, width: 60, height: 10 },
    "e",
    [blocker],
  ).region;
  assert.deepEqual({ x: east.x, width: east.width }, { x: 10, width: 30 });

  const west = constrainRegionResize(
    { id: "west", x: 70, y: 35, width: 20, height: 10 },
    { x: 30, y: 35, width: 60, height: 10 },
    "w",
    [blocker],
  ).region;
  assert.deepEqual({ x: west.x, width: west.width }, { x: 60, width: 30 });

  const south = constrainRegionResize(
    { id: "south", x: 45, y: 0, width: 10, height: 20 },
    { x: 45, y: 0, width: 10, height: 60 },
    "s",
    [blocker],
  ).region;
  assert.deepEqual({ y: south.y, height: south.height }, { y: 0, height: 30 });

  const north = constrainRegionResize(
    { id: "north", x: 45, y: 60, width: 10, height: 20 },
    { x: 45, y: 20, width: 10, height: 60 },
    "n",
    [blocker],
  ).region;
  assert.deepEqual({ y: north.y, height: north.height }, { y: 50, height: 30 });
});

test("corner resize remains legal while keeping fixed edges anchored", () => {
  const blocker = { id: "blocker", x: 40, y: 30, width: 20, height: 20 };
  const start = { id: "corner", x: 10, y: 0, width: 20, height: 20 };
  const result = constrainRegionResize(
    start,
    { x: 10, y: 0, width: 50, height: 50 },
    "se",
    [blocker],
  ).region;
  assert.equal(result.x, start.x);
  assert.equal(result.y, start.y);
  assert.equal(regionsOverlap(result, blocker), false);
  assert.ok(result.x + result.width === blocker.x || result.y + result.height === blocker.y);
});

test("all resize handles preserve fixed edges and prevent overlap", () => {
  const blocker = { id: "blocker", x: 40, y: 40, width: 20, height: 20 };
  const cases = [
    ["nw", { x: 70, y: 70, width: 20, height: 20 }, { x: 30, y: 30, width: 60, height: 60 }],
    ["n", { x: 45, y: 70, width: 10, height: 20 }, { x: 45, y: 30, width: 10, height: 60 }],
    ["ne", { x: 10, y: 70, width: 20, height: 20 }, { x: 10, y: 30, width: 60, height: 60 }],
    ["e", { x: 10, y: 45, width: 20, height: 10 }, { x: 10, y: 45, width: 60, height: 10 }],
    ["se", { x: 10, y: 10, width: 20, height: 20 }, { x: 10, y: 10, width: 60, height: 60 }],
    ["s", { x: 45, y: 10, width: 10, height: 20 }, { x: 45, y: 10, width: 10, height: 60 }],
    ["sw", { x: 70, y: 10, width: 20, height: 20 }, { x: 30, y: 10, width: 60, height: 60 }],
    ["w", { x: 70, y: 45, width: 20, height: 10 }, { x: 30, y: 45, width: 60, height: 10 }],
  ];

  for (const [handle, start, target] of cases) {
    const result = constrainRegionResize(
      { id: handle, ...start },
      { id: handle, ...target },
      handle,
      [blocker],
    ).region;
    const startRight = start.x + start.width;
    const startBottom = start.y + start.height;

    if (!handle.includes("w")) assert.equal(result.x, start.x, `${handle} fixed left`);
    if (!handle.includes("e")) {
      assert.equal(result.x + result.width, startRight, `${handle} fixed right`);
    }
    if (!handle.includes("n")) assert.equal(result.y, start.y, `${handle} fixed top`);
    if (!handle.includes("s")) {
      assert.equal(result.y + result.height, startBottom, `${handle} fixed bottom`);
    }
    assert.equal(regionsOverlap(result, blocker), false, `${handle} overlap`);
  }
});

test("side resize snapping ignores unrelated distant regions", () => {
  const start = { id: "side", x: 10, y: 10, width: 20, height: 10 };
  const distant = { id: "distant", x: 40, y: 70, width: 20, height: 20 };
  const nearby = { id: "nearby", x: 40, y: 15, width: 20, height: 20 };
  const proposed = { ...start, width: 28.5 };

  const unsnapped = constrainRegionResize(start, proposed, "e", [distant], {
    x: 2,
    y: 2,
  });
  assert.equal(unsnapped.region.x + unsnapped.region.width, 38.5);
  assert.deepEqual(unsnapped.guides, { x: null, y: null });

  const snapped = constrainRegionResize(start, proposed, "e", [nearby], {
    x: 2,
    y: 2,
  });
  assert.equal(snapped.region.x + snapped.region.width, 40);
  assert.deepEqual(snapped.guides, { x: 40, y: null });
});

test("all corner handles snap both axes near a neighboring corner", () => {
  const cases = [
    [
      "se",
      { x: 10, y: 10, width: 20, height: 20 },
      { x: 10, y: 10, width: 28.5, height: 28.5 },
      { x: 40, y: 40 },
    ],
    [
      "ne",
      { x: 10, y: 70, width: 20, height: 20 },
      { x: 10, y: 61.5, width: 28.5, height: 28.5 },
      { x: 40, y: 60 },
    ],
    [
      "sw",
      { x: 70, y: 10, width: 20, height: 20 },
      { x: 61.5, y: 10, width: 28.5, height: 28.5 },
      { x: 60, y: 40 },
    ],
    [
      "nw",
      { x: 70, y: 70, width: 20, height: 20 },
      { x: 61.5, y: 61.5, width: 28.5, height: 28.5 },
      { x: 60, y: 60 },
    ],
  ];
  const blocker = { id: "blocker", x: 40, y: 40, width: 20, height: 20 };

  for (const [handle, start, proposed, expectedCorner] of cases) {
    const constrained = constrainRegionResize(
      { id: handle, ...start },
      { id: handle, ...proposed },
      handle,
      [blocker],
      { x: 2, y: 2 },
    );
    const result = constrained.region;
    const corner = {
      x: handle.includes("w") ? result.x : result.x + result.width,
      y: handle.includes("n") ? result.y : result.y + result.height,
    };
    assert.deepEqual(corner, expectedCorner, `${handle} corner`);
    assert.deepEqual(constrained.guides, expectedCorner, `${handle} guides`);
  }
});

test("corner guides stay visible across absolute pointer samples", () => {
  const origin = { id: "moving", x: 10, y: 10, width: 20, height: 20 };
  const blocker = { id: "blocker", x: 40, y: 40, width: 20, height: 20 };
  const snapThreshold = { x: 2, y: 2 };

  const first = constrainRegionResize(
    origin,
    { ...origin, width: 28.5, height: 28.5 },
    "se",
    [blocker],
    snapThreshold,
  );
  const next = constrainRegionResize(
    origin,
    { ...origin, width: 30, height: 29 },
    "se",
    [blocker],
    snapThreshold,
  );

  assert.deepEqual(first.guides, { x: 40, y: 40 });
  assert.deepEqual(next.guides, { x: 40, y: 40 });
});

test("diagonal collision fallback favors the blocking corner", () => {
  const start = { id: "corner", x: 10, y: 10, width: 20, height: 20 };
  const blocker = { id: "blocker", x: 35, y: 35, width: 20, height: 20 };
  const result = constrainRegionResize(
    start,
    { ...start, width: 26, height: 26 },
    "se",
    [blocker],
  ).region;

  assert.deepEqual(
    { right: result.x + result.width, bottom: result.y + result.height },
    { right: 35, bottom: 35 },
  );
});

test("a blocked corner keeps its free axis tracking cumulative pointer movement", () => {
  const origin = { id: "moving", x: 0, y: 0, width: 20, height: 20 };
  const blocker = { id: "blocker", x: 40, y: 40, width: 20, height: 20 };
  let current = origin;

  for (let step = 1; step <= 10; step += 1) {
    current = constrainRegionResize(
      origin,
      {
        ...origin,
        width: origin.width + step * 2.5,
        height: origin.height + step * 3,
      },
      "se",
      [blocker],
    ).region;
  }

  assert.deepEqual(
    { right: current.x + current.width, bottom: current.y + current.height },
    { right: 40, bottom: 50 },
  );
});

test("high-delta corner resize only stops the axis that reaches a blocker", () => {
  const blocker = { id: "blocker", x: 40, y: 40, width: 20, height: 20 };
  const cases = [
    [
      "se",
      { x: 0, y: 10, width: 20, height: 20 },
      { x: 0, y: 10, width: 45, height: 35 },
      { x: 40, y: 45 },
    ],
    [
      "ne",
      { x: 0, y: 70, width: 20, height: 20 },
      { x: 0, y: 55, width: 45, height: 35 },
      { x: 40, y: 55 },
    ],
    [
      "sw",
      { x: 70, y: 0, width: 20, height: 20 },
      { x: 55, y: 0, width: 35, height: 45 },
      { x: 55, y: 40 },
    ],
    [
      "nw",
      { x: 70, y: 80, width: 20, height: 20 },
      { x: 55, y: 55, width: 35, height: 45 },
      { x: 55, y: 60 },
    ],
  ];

  for (const [handle, start, proposed, expected] of cases) {
    const result = constrainRegionResize(
      { id: handle, ...start },
      { id: handle, ...proposed },
      handle,
      [blocker],
    ).region;
    const movingCorner = {
      x: handle.includes("w") ? result.x : result.x + result.width,
      y: handle.includes("n") ? result.y : result.y + result.height,
    };
    assert.deepEqual(movingCorner, expected, `${handle} trajectory`);
    assert.equal(regionsOverlap(result, blocker), false, `${handle} overlap`);

    let sampled = { id: `${handle}-sampled`, ...start };
    for (let step = 1; step <= 20; step += 1) {
      const progress = step / 20;
      sampled = constrainRegionResize(
        { id: sampled.id, ...start },
        {
          id: sampled.id,
          x: start.x + (proposed.x - start.x) * progress,
          y: start.y + (proposed.y - start.y) * progress,
          width: start.width + (proposed.width - start.width) * progress,
          height: start.height + (proposed.height - start.height) * progress,
        },
        handle,
        [blocker],
      ).region;
    }
    const sampledCorner = {
      x: handle.includes("w") ? sampled.x : sampled.x + sampled.width,
      y: handle.includes("n") ? sampled.y : sampled.y + sampled.height,
    };
    assert.deepEqual(sampledCorner, expected, `${handle} sampled trajectory`);
  }
});

test("uneven high-delta corner movement follows collision order", () => {
  const blocker = { id: "blocker", x: 40, y: 40, width: 20, height: 20 };
  const cases = [
    [
      "se",
      { x: 0, y: 10, width: 20, height: 20 },
      { x: 0, y: 10, width: 55, height: 40 },
      { x: 40, y: 50 },
    ],
    [
      "ne",
      { x: 0, y: 70, width: 20, height: 20 },
      { x: 0, y: 50, width: 55, height: 40 },
      { x: 40, y: 50 },
    ],
    [
      "sw",
      { x: 70, y: 0, width: 20, height: 20 },
      { x: 50, y: 0, width: 40, height: 55 },
      { x: 50, y: 40 },
    ],
    [
      "nw",
      { x: 70, y: 80, width: 20, height: 20 },
      { x: 50, y: 45, width: 40, height: 55 },
      { x: 50, y: 60 },
    ],
  ];

  for (const [handle, start, proposed, expected] of cases) {
    const origin = { id: handle, ...start };
    const target = { id: handle, ...proposed };
    const oneShot = constrainRegionResize(origin, target, handle, [blocker]).region;
    let sampled = origin;

    for (let step = 1; step <= 20; step += 1) {
      const progress = step / 20;
      sampled = constrainRegionResize(
        origin,
        {
          id: handle,
          x: origin.x + (target.x - origin.x) * progress,
          y: origin.y + (target.y - origin.y) * progress,
          width: origin.width + (target.width - origin.width) * progress,
          height: origin.height + (target.height - origin.height) * progress,
        },
        handle,
        [blocker],
      ).region;
    }

    for (const [label, result] of [
      ["one shot", oneShot],
      ["sampled", sampled],
    ]) {
      const movingCorner = {
        x: handle.includes("w") ? result.x : result.x + result.width,
        y: handle.includes("n") ? result.y : result.y + result.height,
      };
      assert.deepEqual(movingCorner, expected, `${handle} ${label}`);
      assert.equal(regionsOverlap(result, blocker), false, `${handle} ${label} overlap`);
    }
  }
});

test("a blocked corner slides continuously along stacked neighboring areas", () => {
  const origin = { id: "moving", x: 0, y: 0, width: 20, height: 20 };
  const target = { ...origin, width: 45, height: 50 };
  const blockers = [
    { id: "upper", x: 25, y: 25, width: 10, height: 10 },
    { id: "lower", x: 25, y: 35, width: 10, height: 10 },
  ];
  const expectedCorner = { right: 25, bottom: 50 };

  for (const snapThreshold of [
    { x: 0, y: 0 },
    { x: 2, y: 2 },
  ]) {
    const oneShot = constrainRegionResize(
      origin,
      target,
      "se",
      blockers,
      snapThreshold,
    ).region;
    let sampled = origin;

    for (let step = 1; step <= 20; step += 1) {
      const progress = step / 20;
      sampled = constrainRegionResize(
        origin,
        {
          ...origin,
          width: origin.width + (target.width - origin.width) * progress,
          height: origin.height + (target.height - origin.height) * progress,
        },
        "se",
        blockers,
        snapThreshold,
      ).region;
    }

    for (const [label, result] of [
      ["one shot", oneShot],
      ["sampled", sampled],
    ]) {
      assert.deepEqual(
        { right: result.x + result.width, bottom: result.y + result.height },
        expectedCorner,
        `${label} with ${snapThreshold.x}% snapping`,
      );
      assert.equal(
        blockers.some((blocker) => regionsOverlap(result, blocker)),
        false,
        `${label} overlap`,
      );
    }
  }
});

test("magnetic corner results do not depend on pointer event frequency", () => {
  const origin = { id: "moving", x: 0, y: 0, width: 20, height: 20 };
  const target = { ...origin, width: 55, height: 50 };
  const blocker = { id: "blocker", x: 25, y: 25, width: 10, height: 10 };

  for (const sampleCount of [1, 5, 10, 20, 40]) {
    let result = origin;
    for (let step = 1; step <= sampleCount; step += 1) {
      const progress = step / sampleCount;
      result = constrainRegionResize(
        origin,
        {
          ...origin,
          width: origin.width + (target.width - origin.width) * progress,
          height: origin.height + (target.height - origin.height) * progress,
        },
        "se",
        [blocker],
        { x: 2, y: 2 },
      ).region;
    }

    assert.deepEqual(
      { right: result.x + result.width, bottom: result.y + result.height },
      { right: 55, bottom: 25 },
      `${sampleCount} pointer samples`,
    );
    assert.equal(regionsOverlap(result, blocker), false);
  }
});

test("a one-axis corner drag never changes the untouched axis", () => {
  const horizontalStart = { id: "horizontal", x: 10, y: 10, width: 20, height: 20 };
  const horizontalBlocker = { id: "horizontal-blocker", x: 35, y: 29, width: 20, height: 20 };
  const horizontal = constrainRegionResize(
    horizontalStart,
    { ...horizontalStart, width: 30 },
    "se",
    [horizontalBlocker],
  ).region;
  assert.deepEqual(
    { right: horizontal.x + horizontal.width, bottom: horizontal.y + horizontal.height },
    { right: 35, bottom: 30 },
  );

  const verticalStart = { id: "vertical", x: 10, y: 10, width: 20, height: 20 };
  const verticalBlocker = { id: "vertical-blocker", x: 29, y: 35, width: 20, height: 20 };
  const vertical = constrainRegionResize(
    verticalStart,
    { ...verticalStart, height: 30 },
    "se",
    [verticalBlocker],
  ).region;
  assert.deepEqual(
    { right: vertical.x + vertical.width, bottom: vertical.y + vertical.height },
    { right: 30, bottom: 35 },
  );
});

test("free placement preserves valid positions and finds deterministic nearby space", () => {
  const existing = { id: "first", x: 0, y: 0, width: 24, height: 16 };
  const free = findFreeRegionPlacement(
    { id: "free", x: 50, y: 50, width: 24, height: 16 },
    [existing],
  );
  assert.deepEqual({ x: free.x, y: free.y }, { x: 50, y: 50 });

  const relocated = findFreeRegionPlacement(
    { id: "next", x: 4, y: 4, width: 24, height: 16 },
    [existing],
  );
  assert.deepEqual({ x: relocated.x, y: relocated.y }, { x: 4, y: 16 });
  assert.equal(regionsOverlap(relocated, existing), false);

  assert.equal(
    findFreeRegionPlacement(
      { id: "none", x: 0, y: 0, width: 2, height: 2 },
      [{ id: "full", x: 0, y: 0, width: 100, height: 100 }],
    ),
    null,
  );
});

test("generateBBCode creates deterministic output for an empty map", () => {
  assert.equal(
    generateBBCode("https://example.com/banner.png"),
    "[imagemap]\nhttps://example.com/banner.png\n[/imagemap]",
  );
});

test("generateBBCode formats multiple regions and optional hover text", () => {
  const output = generateBBCode("https://example.com/banner.png", [
    {
      id: "one",
      x: 10,
      y: 12.345,
      width: 25,
      height: 18,
      destination: "https://osu.ppy.sh/users/1",
      title: "View profile",
    },
    {
      id: "two",
      x: 50,
      y: 55,
      width: 20,
      height: 10,
      destination: "",
      title: "",
    },
  ]);

  assert.equal(
    output,
    [
      "[imagemap]",
      "https://example.com/banner.png",
      "10 12.35 25 18 https://osu.ppy.sh/users/1 View profile",
      "50 55 20 10 #",
      "[/imagemap]",
    ].join("\n"),
  );
});

test("generateBBCode prevents line injection from persisted values", () => {
  const output = generateBBCode("https://example.com/banner.png\n[spoiler]", [
    {
      id: "one",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      destination: "https://example.com\n[/imagemap]",
      title: "Hello\nthere",
    },
  ]);

  assert.equal(output.split("\n").length, 4);
  assert.match(output, /Hello there/);
});

test("generateBBCode neutralizes nested imagemap delimiters", () => {
  const output = generateBBCode("https://example.com/banner.png", [
    {
      id: "one",
      x: 5,
      y: 5,
      width: 20,
      height: 20,
      destination: "#",
      title: "safe[/imagemap]trailing [imagemap]",
    },
  ]);

  assert.equal(output.match(/\[\/imagemap\]/gi)?.length, 1);
  assert.ok(output.endsWith("[/imagemap]"));
  assert.match(output, /safe\(\/imagemap\)trailing \(imagemap\)/);
});
