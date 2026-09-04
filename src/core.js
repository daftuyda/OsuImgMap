export const MIN_REGION_SIZE = 2;

export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function roundGeometry(value) {
  const scaled = toFiniteNumber(value) * 100;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
  return Math.round(scaled + Math.sign(scaled) * tolerance) / 100;
}

export function formatNumber(value) {
  return String(roundGeometry(value));
}

export function sanitizeInline(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sanitizeBBCodeValue(value) {
  return sanitizeInline(value).replace(/\[(\/?)(imagemap)\]/gi, "($1$2)");
}

export function canonicalizeWebUrl(value) {
  return new URL(String(value).trim()).href.replaceAll("[", "%5B").replaceAll("]", "%5D");
}

export function imageUrlError(value) {
  const candidate = String(value ?? "").trim();

  if (!candidate) {
    return "Enter a direct image URL first.";
  }

  if (/\s/.test(candidate)) {
    return "Image URLs cannot contain spaces.";
  }

  if (candidate.includes("\\")) {
    return "Image URLs must use forward slashes.";
  }

  if (!/^https?:\/\//i.test(candidate)) {
    return "Enter a complete URL, including https://.";
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Use an http:// or https:// image URL.";
    }
  } catch {
    return "Enter a complete URL, including https://.";
  }

  return "";
}

export function destinationError(value) {
  const candidate = String(value ?? "").trim();

  if (!candidate || candidate === "#") {
    return "";
  }

  if (/\s/.test(candidate)) {
    return "Destination URLs cannot contain spaces.";
  }

  if (candidate.includes("\\")) {
    return "Destination URLs must use forward slashes.";
  }

  if (!/^https?:\/\//i.test(candidate)) {
    return "Use a complete http(s) URL or # for no link.";
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Use a complete http(s) URL or # for no link.";
    }
  } catch {
    return "Use a complete http(s) URL or # for no link.";
  }

  return "";
}

export function normalizeRegion(region, fallbackId = "region") {
  const width = roundGeometry(
    clamp(toFiniteNumber(region?.width, 24), MIN_REGION_SIZE, 100),
  );
  const height = roundGeometry(
    clamp(toFiniteNumber(region?.height, 16), MIN_REGION_SIZE, 100),
  );
  const maximumX = roundGeometry(100 - width);
  const maximumY = roundGeometry(100 - height);

  return {
    id: String(region?.id || fallbackId),
    x: Math.min(roundGeometry(clamp(toFiniteNumber(region?.x, 8), 0, maximumX)), maximumX),
    y: Math.min(roundGeometry(clamp(toFiniteNumber(region?.y, 8), 0, maximumY)), maximumY),
    width,
    height,
    destination: sanitizeInline(region?.destination) || "#",
    title: sanitizeInline(region?.title),
  };
}

const BOARD_SIZE = 100;
const TICKS_PER_PERCENT = 100;
const SWEEP_EPSILON = 1e-9;

function toTicks(value) {
  return Math.round(toFiniteNumber(value) * TICKS_PER_PERCENT);
}

function tickEdges(region) {
  const left = toTicks(region.x);
  const top = toTicks(region.y);
  return {
    left,
    top,
    right: left + toTicks(region.width),
    bottom: top + toTicks(region.height),
  };
}

function regionEdges(region) {
  return {
    left: region.x,
    top: region.y,
    right: region.x + region.width,
    bottom: region.y + region.height,
  };
}

function rangesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart < secondEnd - SWEEP_EPSILON && firstEnd > secondStart + SWEEP_EPSILON;
}

export function regionsOverlap(first, second) {
  const a = tickEdges(first);
  const b = tickEdges(second);
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function hasRegionOverlaps(regions = []) {
  for (let firstIndex = 0; firstIndex < regions.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < regions.length; secondIndex += 1) {
      if (regionsOverlap(regions[firstIndex], regions[secondIndex])) return true;
    }
  }
  return false;
}

function sortedObstacles(regions, excludedId) {
  return regions
    .filter((region) => region.id !== excludedId)
    .map((region, index) => normalizeRegion(region, region?.id || `obstacle-${index}`))
    .sort((first, second) =>
      first.x - second.x || first.y - second.y || first.width - second.width || first.height - second.height,
    );
}

function nearestSnap(value, options, threshold) {
  if (threshold <= 0) return { value, guide: null };

  const candidates = options
    .map((option) => ({ ...option, distance: Math.abs(option.value - value) }))
    .filter((option) => option.distance <= threshold + SWEEP_EPSILON)
    .sort(
      (first, second) =>
        first.distance - second.distance || first.value - second.value || first.guide - second.guide,
    );

  return candidates[0] ?? { value, guide: null };
}

function moveSnapOptions(region, obstacles) {
  const horizontal = [
    { value: 0, guide: 0 },
    { value: BOARD_SIZE - region.width, guide: BOARD_SIZE },
  ];
  const vertical = [
    { value: 0, guide: 0 },
    { value: BOARD_SIZE - region.height, guide: BOARD_SIZE },
  ];

  for (const obstacle of obstacles) {
    const edge = regionEdges(obstacle);
    horizontal.push(
      { value: edge.left, guide: edge.left },
      { value: edge.right, guide: edge.right },
      { value: edge.left - region.width, guide: edge.left },
      { value: edge.right - region.width, guide: edge.right },
    );
    vertical.push(
      { value: edge.top, guide: edge.top },
      { value: edge.bottom, guide: edge.bottom },
      { value: edge.top - region.height, guide: edge.top },
      { value: edge.bottom - region.height, guide: edge.bottom },
    );
  }

  return {
    horizontal: horizontal.filter(
      (option) => option.value >= 0 && option.value <= BOARD_SIZE - region.width,
    ),
    vertical: vertical.filter(
      (option) => option.value >= 0 && option.value <= BOARD_SIZE - region.height,
    ),
  };
}

function axisSweep(movingStart, movingEnd, delta, obstacleStart, obstacleEnd) {
  if (Math.abs(delta) <= SWEEP_EPSILON) {
    return rangesOverlap(movingStart, movingEnd, obstacleStart, obstacleEnd)
      ? { entry: Number.NEGATIVE_INFINITY, exit: Number.POSITIVE_INFINITY }
      : null;
  }

  if (delta > 0) {
    return {
      entry: (obstacleStart - movingEnd) / delta,
      exit: (obstacleEnd - movingStart) / delta,
    };
  }

  return {
    entry: (obstacleEnd - movingStart) / delta,
    exit: (obstacleStart - movingEnd) / delta,
  };
}

function sweptCollision(region, deltaX, deltaY, obstacle) {
  const moving = regionEdges(region);
  const fixed = regionEdges(obstacle);
  const horizontal = axisSweep(moving.left, moving.right, deltaX, fixed.left, fixed.right);
  const vertical = axisSweep(moving.top, moving.bottom, deltaY, fixed.top, fixed.bottom);
  if (!horizontal || !vertical) return null;

  const entry = Math.max(horizontal.entry, vertical.entry);
  const exit = Math.min(horizontal.exit, vertical.exit);
  if (
    entry >= exit - SWEEP_EPSILON ||
    entry < -SWEEP_EPSILON ||
    entry > 1 + SWEEP_EPSILON
  ) {
    return null;
  }

  let axis = "both";
  if (horizontal.entry > vertical.entry + SWEEP_EPSILON) axis = "x";
  if (vertical.entry > horizontal.entry + SWEEP_EPSILON) axis = "y";
  return { axis, time: clamp(entry, 0, 1) };
}

function earliestCollision(region, deltaX, deltaY, obstacles) {
  let earliest = null;

  for (const obstacle of obstacles) {
    const collision = sweptCollision(region, deltaX, deltaY, obstacle);
    if (!collision) continue;

    if (!earliest || collision.time < earliest.time - SWEEP_EPSILON) {
      earliest = collision;
    } else if (Math.abs(collision.time - earliest.time) <= SWEEP_EPSILON) {
      if (collision.axis !== earliest.axis) earliest.axis = "both";
    }
  }

  return earliest;
}

export function alignmentGuides(region, others = []) {
  const current = tickEdges(region);
  const horizontalTargets = new Set([0, BOARD_SIZE * TICKS_PER_PERCENT]);
  const verticalTargets = new Set([0, BOARD_SIZE * TICKS_PER_PERCENT]);

  for (const obstacle of others) {
    const edge = tickEdges(obstacle);
    horizontalTargets.add(edge.left);
    horizontalTargets.add(edge.right);
    verticalTargets.add(edge.top);
    verticalTargets.add(edge.bottom);
  }

  const matchingX = [current.left, current.right].find((edge) => horizontalTargets.has(edge));
  const matchingY = [current.top, current.bottom].find((edge) => verticalTargets.has(edge));
  return {
    x: matchingX === undefined ? null : matchingX / TICKS_PER_PERCENT,
    y: matchingY === undefined ? null : matchingY / TICKS_PER_PERCENT,
  };
}

export function constrainRegionMove(
  previous,
  proposed,
  otherRegions = [],
  snapThreshold = { x: 0, y: 0 },
) {
  const start = normalizeRegion(previous, previous?.id);
  const obstacles = sortedObstacles(otherRegions, start.id);
  const requestedX = toFiniteNumber(proposed?.x, start.x);
  const requestedY = toFiniteNumber(proposed?.y, start.y);
  const boundedX = clamp(requestedX, 0, BOARD_SIZE - start.width);
  const boundedY = clamp(requestedY, 0, BOARD_SIZE - start.height);
  let target = normalizeRegion(
    {
      ...start,
      x: requestedX,
      y: requestedY,
      width: start.width,
      height: start.height,
    },
    start.id,
  );

  const snapOptions = moveSnapOptions(start, obstacles);
  const snappedX = nearestSnap(target.x, snapOptions.horizontal, snapThreshold.x ?? 0);
  const snappedY = nearestSnap(target.y, snapOptions.vertical, snapThreshold.y ?? 0);
  target = normalizeRegion({ ...target, x: snappedX.value, y: snappedY.value }, start.id);

  let current = { ...start };
  let targetX = target.x;
  let targetY = target.y;

  for (let iteration = 0; iteration < obstacles.length + 2; iteration += 1) {
    const deltaX = targetX - current.x;
    const deltaY = targetY - current.y;
    if (Math.abs(deltaX) <= SWEEP_EPSILON && Math.abs(deltaY) <= SWEEP_EPSILON) break;

    const collision = earliestCollision(current, deltaX, deltaY, obstacles);
    if (!collision) {
      current.x = targetX;
      current.y = targetY;
      break;
    }

    current.x += deltaX * collision.time;
    current.y += deltaY * collision.time;

    if (collision.axis === "both") {
      targetX = current.x;
      targetY = current.y;
      break;
    }
    if (collision.axis === "x") targetX = current.x;
    if (collision.axis === "y") targetY = current.y;
  }

  const result = normalizeRegion({ ...start, x: current.x, y: current.y }, start.id);
  const safeResult = obstacles.some((obstacle) => regionsOverlap(result, obstacle)) ? start : result;
  return {
    region: safeResult,
    guides: alignmentGuides(safeResult, obstacles),
    blockedAxes: {
      x:
        Math.abs(requestedX - boundedX) > SWEEP_EPSILON ||
        toTicks(safeResult.x) !== toTicks(target.x),
      y:
        Math.abs(requestedY - boundedY) > SWEEP_EPSILON ||
        toTicks(safeResult.y) !== toTicks(target.y),
    },
  };
}

function uniqueGeometryValues(values) {
  return [...new Map(values.map((value) => [toTicks(value), roundGeometry(value)])).values()].sort(
    (first, second) => first - second,
  );
}

function rangeGap(firstStart, firstEnd, secondStart, secondEnd) {
  if (rangesOverlap(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  if (firstEnd <= secondStart) return secondStart - firstEnd;
  return firstStart - secondEnd;
}

function edgeSnapTargets(obstacles, axis, movingEdge, crossAxisThreshold = 0) {
  const values = [0, BOARD_SIZE];
  for (const obstacle of obstacles) {
    const edge = regionEdges(obstacle);
    const crossAxisGap =
      axis === "x"
        ? rangeGap(movingEdge.top, movingEdge.bottom, edge.top, edge.bottom)
        : rangeGap(movingEdge.left, movingEdge.right, edge.left, edge.right);
    if (crossAxisGap > crossAxisThreshold + SWEEP_EPSILON) continue;
    values.push(axis === "x" ? edge.left : edge.top, axis === "x" ? edge.right : edge.bottom);
  }
  return uniqueGeometryValues(values).map((value) => ({ value, guide: value }));
}

function edgeIsOnPath(value, start, target) {
  return (
    value >= Math.min(start, target) - SWEEP_EPSILON &&
    value <= Math.max(start, target) + SWEEP_EPSILON
  );
}

function resizeAlignmentGuides(region, obstacles, activeEdges, snapThreshold) {
  const edge = regionEdges(region);
  const horizontalTargets = edgeSnapTargets(
    obstacles,
    "x",
    edge,
    snapThreshold.y ?? 0,
  );
  const verticalTargets = edgeSnapTargets(
    obstacles,
    "y",
    edge,
    snapThreshold.x ?? 0,
  );
  const activeX = activeEdges.w ? edge.left : activeEdges.e ? edge.right : null;
  const activeY = activeEdges.n ? edge.top : activeEdges.s ? edge.bottom : null;
  const matchingX =
    activeX === null
      ? null
      : horizontalTargets.find((option) => toTicks(option.value) === toTicks(activeX))?.guide ?? null;
  const matchingY =
    activeY === null
      ? null
      : verticalTargets.find((option) => toTicks(option.value) === toTicks(activeY))?.guide ?? null;
  return { x: matchingX, y: matchingY };
}

function resizeAxisEntry(startMinimum, startMaximum, targetMinimum, targetMaximum, fixedMinimum, fixedMaximum) {
  if (rangesOverlap(startMinimum, startMaximum, fixedMinimum, fixedMaximum)) {
    return Number.NEGATIVE_INFINITY;
  }

  if (startMaximum <= fixedMinimum + SWEEP_EPSILON) {
    const delta = targetMaximum - startMaximum;
    return delta > SWEEP_EPSILON ? (fixedMinimum - startMaximum) / delta : null;
  }

  if (startMinimum >= fixedMaximum - SWEEP_EPSILON) {
    const delta = targetMinimum - startMinimum;
    return delta < -SWEEP_EPSILON ? (fixedMaximum - startMinimum) / delta : null;
  }

  return null;
}

function resizeCollisionIntent(startEdge, targetEdge, obstacles) {
  let earliest = null;

  for (const obstacle of obstacles) {
    const fixed = regionEdges(obstacle);
    const horizontalEntry = resizeAxisEntry(
      startEdge.left,
      startEdge.right,
      targetEdge.left,
      targetEdge.right,
      fixed.left,
      fixed.right,
    );
    const verticalEntry = resizeAxisEntry(
      startEdge.top,
      startEdge.bottom,
      targetEdge.top,
      targetEdge.bottom,
      fixed.top,
      fixed.bottom,
    );
    if (horizontalEntry === null || verticalEntry === null) continue;

    const time = Math.max(horizontalEntry, verticalEntry);
    if (time < -SWEEP_EPSILON || time > 1 + SWEEP_EPSILON) continue;

    let axis = "both";
    if (horizontalEntry > verticalEntry + SWEEP_EPSILON) axis = "x";
    if (verticalEntry > horizontalEntry + SWEEP_EPSILON) axis = "y";

    if (!earliest || time < earliest.time - SWEEP_EPSILON) {
      earliest = { axis, time };
    } else if (Math.abs(time - earliest.time) <= SWEEP_EPSILON && axis !== earliest.axis) {
      if (earliest.axis === "both") {
        earliest.axis = axis;
      } else if (axis !== "both") {
        earliest.axis = "both";
      }
    }
  }

  return earliest?.axis ?? "both";
}

export function constrainRegionResize(
  previous,
  proposed,
  handle,
  otherRegions = [],
  snapThreshold = { x: 0, y: 0 },
) {
  const start = normalizeRegion(previous, previous?.id);
  const target = normalizeRegion({ ...start, ...proposed }, start.id);
  const obstacles = sortedObstacles(otherRegions, start.id);
  const startEdge = regionEdges(start);
  const targetEdge = regionEdges(target);
  if (!handle.includes("w")) targetEdge.left = startEdge.left;
  if (!handle.includes("e")) targetEdge.right = startEdge.right;
  if (!handle.includes("n")) targetEdge.top = startEdge.top;
  if (!handle.includes("s")) targetEdge.bottom = startEdge.bottom;

  const activeEdges = {
    w: handle.includes("w") && Math.abs(targetEdge.left - startEdge.left) > SWEEP_EPSILON,
    e: handle.includes("e") && Math.abs(targetEdge.right - startEdge.right) > SWEEP_EPSILON,
    n: handle.includes("n") && Math.abs(targetEdge.top - startEdge.top) > SWEEP_EPSILON,
    s: handle.includes("s") && Math.abs(targetEdge.bottom - startEdge.bottom) > SWEEP_EPSILON,
  };
  const horizontalTargets = edgeSnapTargets(
    obstacles,
    "x",
    targetEdge,
    snapThreshold.y ?? 0,
  );
  const verticalTargets = edgeSnapTargets(
    obstacles,
    "y",
    targetEdge,
    snapThreshold.x ?? 0,
  );

  if (activeEdges.w) {
    targetEdge.left = nearestSnap(
      targetEdge.left,
      horizontalTargets.filter((option) => option.value <= startEdge.right - MIN_REGION_SIZE),
      snapThreshold.x ?? 0,
    ).value;
  }
  if (activeEdges.e) {
    targetEdge.right = nearestSnap(
      targetEdge.right,
      horizontalTargets.filter((option) => option.value >= startEdge.left + MIN_REGION_SIZE),
      snapThreshold.x ?? 0,
    ).value;
  }
  if (activeEdges.n) {
    targetEdge.top = nearestSnap(
      targetEdge.top,
      verticalTargets.filter((option) => option.value <= startEdge.bottom - MIN_REGION_SIZE),
      snapThreshold.y ?? 0,
    ).value;
  }
  if (activeEdges.s) {
    targetEdge.bottom = nearestSnap(
      targetEdge.bottom,
      verticalTargets.filter((option) => option.value >= startEdge.top + MIN_REGION_SIZE),
      snapThreshold.y ?? 0,
    ).value;
  }

  const directResult = normalizeRegion(
    {
      ...start,
      x: targetEdge.left,
      y: targetEdge.top,
      width: targetEdge.right - targetEdge.left,
      height: targetEdge.bottom - targetEdge.top,
    },
    start.id,
  );
  if (!obstacles.some((obstacle) => regionsOverlap(directResult, obstacle))) {
    return {
      region: directResult,
      guides: resizeAlignmentGuides(directResult, obstacles, activeEdges, snapThreshold),
    };
  }

  const blockingObstacles = obstacles.filter((obstacle) => regionsOverlap(directResult, obstacle));
  const collisionIntent = resizeCollisionIntent(startEdge, targetEdge, blockingObstacles);

  const leftValues = activeEdges.w
    ? uniqueGeometryValues([
        targetEdge.left,
        startEdge.left,
        ...blockingObstacles.map((obstacle) => regionEdges(obstacle).right),
      ]).filter((value) => edgeIsOnPath(value, startEdge.left, targetEdge.left))
    : [startEdge.left];
  const rightValues = activeEdges.e
    ? uniqueGeometryValues([
        targetEdge.right,
        startEdge.right,
        ...blockingObstacles.map((obstacle) => regionEdges(obstacle).left),
      ]).filter((value) => edgeIsOnPath(value, startEdge.right, targetEdge.right))
    : [startEdge.right];
  const topValues = activeEdges.n
    ? uniqueGeometryValues([
        targetEdge.top,
        startEdge.top,
        ...blockingObstacles.map((obstacle) => regionEdges(obstacle).bottom),
      ]).filter((value) => edgeIsOnPath(value, startEdge.top, targetEdge.top))
    : [startEdge.top];
  const bottomValues = activeEdges.s
    ? uniqueGeometryValues([
        targetEdge.bottom,
        startEdge.bottom,
        ...blockingObstacles.map((obstacle) => regionEdges(obstacle).top),
      ]).filter((value) => edgeIsOnPath(value, startEdge.bottom, targetEdge.bottom))
    : [startEdge.bottom];

  const candidates = [];
  for (const left of leftValues) {
    for (const right of rightValues) {
      if (left < 0 || right > BOARD_SIZE || right - left < MIN_REGION_SIZE) continue;
      for (const top of topValues) {
        for (const bottom of bottomValues) {
          if (top < 0 || bottom > BOARD_SIZE || bottom - top < MIN_REGION_SIZE) continue;

          const candidate = normalizeRegion(
            {
              ...start,
              x: left,
              y: top,
              width: right - left,
              height: bottom - top,
            },
            start.id,
          );
          if (obstacles.some((obstacle) => regionsOverlap(candidate, obstacle))) continue;

          const edge = regionEdges(candidate);
          const horizontalScale = (snapThreshold.x ?? 0) > 0 ? snapThreshold.x : 1;
          const verticalScale = (snapThreshold.y ?? 0) > 0 ? snapThreshold.y : 1;
          const horizontalError = activeEdges.w
            ? Math.abs(edge.left - targetEdge.left) / horizontalScale
            : activeEdges.e
              ? Math.abs(edge.right - targetEdge.right) / horizontalScale
              : 0;
          const verticalError = activeEdges.n
            ? Math.abs(edge.top - targetEdge.top) / verticalScale
            : activeEdges.s
              ? Math.abs(edge.bottom - targetEdge.bottom) / verticalScale
              : 0;
          const isCorner =
            (activeEdges.w || activeEdges.e) && (activeEdges.n || activeEdges.s);
          const score = isCorner
            ? Math.max(horizontalError, verticalError)
            : horizontalError + verticalError;
          const horizontalContact = activeEdges.w
            ? blockingObstacles.some(
                (obstacle) => toTicks(edge.left) === toTicks(regionEdges(obstacle).right),
              )
            : activeEdges.e
              ? blockingObstacles.some(
                  (obstacle) => toTicks(edge.right) === toTicks(regionEdges(obstacle).left),
                )
              : false;
          const verticalContact = activeEdges.n
            ? blockingObstacles.some(
                (obstacle) => toTicks(edge.top) === toTicks(regionEdges(obstacle).bottom),
              )
            : activeEdges.s
              ? blockingObstacles.some(
                  (obstacle) => toTicks(edge.bottom) === toTicks(regionEdges(obstacle).top),
                )
              : false;
          candidates.push({
            contactCount: Number(horizontalContact) + Number(verticalContact),
            intentError:
              collisionIntent === "x"
                ? verticalError
                : collisionIntent === "y"
                  ? horizontalError
                  : -(Number(horizontalContact) + Number(verticalContact)),
            region: candidate,
            score,
            totalError: horizontalError + verticalError,
          });
        }
      }
    }
  }

  candidates.sort(
    (first, second) =>
      first.intentError - second.intentError ||
      first.score - second.score ||
      first.totalError - second.totalError ||
      second.contactCount - first.contactCount ||
      first.region.y - second.region.y ||
      first.region.x - second.region.x ||
      first.region.width - second.region.width ||
      first.region.height - second.region.height,
  );
  const result = candidates[0]?.region ?? start;
  return {
    region: result,
    guides: resizeAlignmentGuides(result, obstacles, activeEdges, snapThreshold),
  };
}

export function findFreeRegionPlacement(region, otherRegions = []) {
  const preferred = normalizeRegion(region, region?.id);
  const obstacles = sortedObstacles(otherRegions, preferred.id);
  if (!obstacles.some((obstacle) => regionsOverlap(preferred, obstacle))) return preferred;

  const horizontal = [preferred.x, 0, BOARD_SIZE - preferred.width];
  const vertical = [preferred.y, 0, BOARD_SIZE - preferred.height];
  for (const obstacle of obstacles) {
    const edge = regionEdges(obstacle);
    horizontal.push(edge.left, edge.right, edge.left - preferred.width, edge.right - preferred.width);
    vertical.push(edge.top, edge.bottom, edge.top - preferred.height, edge.bottom - preferred.height);
  }

  const candidates = [];
  for (const x of uniqueGeometryValues(horizontal)) {
    if (x < 0 || x > BOARD_SIZE - preferred.width) continue;
    for (const y of uniqueGeometryValues(vertical)) {
      if (y < 0 || y > BOARD_SIZE - preferred.height) continue;
      const candidate = normalizeRegion({ ...preferred, x, y }, preferred.id);
      if (obstacles.some((obstacle) => regionsOverlap(candidate, obstacle))) continue;
      candidates.push({
        region: candidate,
        score: (candidate.x - preferred.x) ** 2 + (candidate.y - preferred.y) ** 2,
      });
    }
  }

  candidates.sort(
    (first, second) =>
      first.score - second.score || first.region.y - second.region.y || first.region.x - second.region.x,
  );
  return candidates[0]?.region ?? null;
}

export function generateBBCode(imageUrl, regions = []) {
  const cleanImageUrl = sanitizeBBCodeValue(imageUrl);
  const outputImageUrl = imageUrlError(cleanImageUrl)
    ? cleanImageUrl
    : canonicalizeWebUrl(cleanImageUrl);
  const lines = ["[imagemap]", outputImageUrl];

  for (const rawRegion of regions) {
    const region = normalizeRegion(rawRegion, rawRegion?.id);
    const geometry = [region.x, region.y, region.width, region.height]
      .map(formatNumber)
      .join(" ");
    const cleanDestination = sanitizeBBCodeValue(region.destination) || "#";
    const destination = destinationError(cleanDestination)
      ? cleanDestination
      : cleanDestination === "#"
        ? "#"
        : canonicalizeWebUrl(cleanDestination);
    const title = sanitizeBBCodeValue(region.title);
    lines.push(`${geometry} ${destination}${title ? ` ${title}` : ""}`);
  }

  lines.push("[/imagemap]");
  return lines.join("\n");
}
