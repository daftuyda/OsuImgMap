import {
  MIN_REGION_SIZE,
  canonicalizeWebUrl,
  clamp,
  constrainRegionMove,
  constrainRegionResize,
  destinationError,
  findFreeRegionPlacement,
  formatNumber,
  generateBBCode,
  hasRegionOverlaps,
  imageUrlError,
  normalizeRegion,
  regionsOverlap,
  roundGeometry,
  sanitizeInline,
} from "./core.js";

const SAMPLE_IMAGE_URL = "https://i.ibb.co/tTH8hTL0/Untitggged.png";
const STORAGE_KEY = "osu-imagemap-builder:v1";
const RECOVERY_STORAGE_KEY = "osu-imagemap-builder:overlap-recovery";
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const POINTER_SNAP_DISTANCE_PX = {
  mouse: { move: 7, side: 5, corner: 9 },
  touch: { move: 12, side: 9, corner: 14 },
};
const DEFAULT_IMAGE_MESSAGE =
  "Paste a link ending in an image file such as .png, .jpg, .webp, or .gif.";
const DEFAULT_GEOMETRY_MESSAGE =
  "Dragging and resizing snap to nearby edges. All controls prevent overlap.";

const getElement = (id) => document.getElementById(id);

const elements = {
  addRegion: getElement("add-region"),
  bbcodeOutput: getElement("bbcode-output"),
  canvasCount: getElement("canvas-count"),
  canvasEmpty: getElement("canvas-empty"),
  clearAll: getElement("clear-all"),
  clearDialog: getElement("clear-dialog"),
  clearDialogDescription: getElement("clear-dialog-description"),
  copyCode: getElement("copy-code"),
  copyLabel: document.querySelector(".copy-label"),
  deleteRegion: getElement("delete-region"),
  destinationMessage: getElement("destination-message"),
  destinationUrl: getElement("destination-url"),
  duplicateRegion: getElement("duplicate-region"),
  geometryHeight: getElement("geometry-height"),
  geometryMessage: getElement("geometry-message"),
  geometryWidth: getElement("geometry-width"),
  geometryX: getElement("geometry-x"),
  geometryY: getElement("geometry-y"),
  hoverTitle: getElement("hover-title"),
  imageForm: getElement("image-form"),
  imageLoader: getElement("image-loader"),
  imageMeta: getElement("image-meta"),
  imageStage: getElement("image-stage"),
  imageStatus: getElement("image-status"),
  imageUrl: getElement("image-url"),
  inspectorEmpty: getElement("inspector-empty"),
  liveRegion: getElement("live-region"),
  loadImage: getElement("load-image"),
  loadImageLabel: document.querySelector("#load-image .button-label"),
  outputReadyBadge: getElement("output-ready-badge"),
  outputStatus: getElement("output-status"),
  regionCount: getElement("region-count"),
  regionInspector: getElement("region-inspector"),
  regionList: getElement("region-list"),
  regionsLayer: getElement("regions-layer"),
  selectedRegionName: getElement("selected-region-name"),
  snapGuideX: getElement("snap-guide-x"),
  snapGuideY: getElement("snap-guide-y"),
  sourceImage: getElement("source-image"),
  toast: getElement("toast"),
  toastAction: getElement("toast-action"),
  toastDismiss: getElement("toast-dismiss"),
  toastMessage: getElement("toast-message"),
  useSample: getElement("use-sample"),
  workflowSteps: [...document.querySelectorAll(".workflow-step")],
};

const geometryInputs = {
  x: elements.geometryX,
  y: elements.geometryY,
  width: elements.geometryWidth,
  height: elements.geometryHeight,
};

const state = {
  imageLoaded: false,
  imageUrl: "",
  naturalHeight: 0,
  naturalWidth: 0,
  regions: [],
  selectedId: null,
};

let activeGesture = null;
let copyFeedbackTimer = null;
let imageLoadToken = 0;
let guideFeedbackTimer = null;
let lastConstraintAnnouncementAt = Number.NEGATIVE_INFINITY;
let nudgeAnnouncementTimer = null;
let restoredRegionChanges = 0;
let restoredRegionSkips = 0;
let toastTimer = null;
let toastHasAction = false;

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function selectedRegion() {
  return state.regions.find((region) => region.id === state.selectedId) ?? null;
}

function regionIndex(id) {
  return state.regions.findIndex((region) => region.id === id);
}

function pluralizeAreas(count) {
  return `${count} ${count === 1 ? "area" : "areas"}`;
}

function restoreProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return;

    if (!imageUrlError(saved.imageUrl)) {
      state.imageUrl = saved.imageUrl.trim();
    }

    if (Array.isArray(saved.regions)) {
      const usedIds = new Set();
      const repairedRegions = [];
      for (const region of saved.regions.slice(0, 100)) {
        let id = String(region?.id || createId());
        if (usedIds.has(id)) id = createId();
        usedIds.add(id);
        const normalized = normalizeRegion({ ...region, id }, id);
        const placement = findFreeRegionPlacement(normalized, repairedRegions);
        if (!placement) {
          restoredRegionSkips += 1;
          continue;
        }
        if (placement.x !== normalized.x || placement.y !== normalized.y) {
          restoredRegionChanges += 1;
        }
        repairedRegions.push(placement);
      }
      state.regions = repairedRegions;

      if (restoredRegionChanges || restoredRegionSkips) {
        try {
          localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(saved));
        } catch {
          // Recovery backup is best-effort when browser storage is available.
        }
      }
    }
  } catch {
    // A corrupt or unavailable localStorage entry should never stop the editor.
  }
}

function persistProject() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ imageUrl: state.imageUrl, regions: state.regions }),
    );
  } catch {
    // Browsers can disable storage; the rest of the editor still works without it.
  }
}

function announce(message) {
  elements.liveRegion.textContent = "";
  window.setTimeout(() => {
    elements.liveRegion.textContent = message;
  }, 20);
}

function showToast(message, action = null) {
  window.clearTimeout(toastTimer);
  toastHasAction = Boolean(action);
  elements.toastMessage.textContent = message;
  elements.toastAction.hidden = !action;
  elements.toastAction.textContent = action?.label ?? "";
  elements.toastAction.onclick = action?.handler ?? null;
  elements.toast.hidden = false;

  scheduleToastHide();
}

function scheduleToastHide() {
  window.clearTimeout(toastTimer);
  if (toastHasAction) return;
  toastTimer = window.setTimeout(
    () => {
      elements.toast.hidden = true;
      elements.toastAction.onclick = null;
    },
    4000,
  );
}

function hideToast() {
  window.clearTimeout(toastTimer);
  toastHasAction = false;
  elements.toast.hidden = true;
  elements.toastAction.onclick = null;
}

function setImageMessage(message, type = "neutral") {
  elements.imageStatus.textContent = message;
  elements.imageStatus.classList.toggle("is-error", type === "error");
  elements.imageStatus.classList.toggle("is-success", type === "success");
  elements.imageUrl.setAttribute("aria-invalid", String(type === "error"));
  elements.imageUrl.closest(".input-shell").classList.toggle("has-error", type === "error");
}

function setImageLoading(isLoading) {
  elements.imageLoader.hidden = !isLoading;
  elements.loadImage.disabled = isLoading;
  elements.useSample.disabled = isLoading;
  elements.clearAll.disabled = !hasProjectContent();
  elements.loadImageLabel.textContent = isLoading ? "Loading…" : "Load image";
  if (!isLoading) elements.addRegion.disabled = !state.imageLoaded;
}

function hasProjectContent() {
  return Boolean(state.imageLoaded || state.regions.length || elements.imageUrl.value.trim());
}

function updateClearAllButton() {
  elements.clearAll.disabled = !hasProjectContent();
}

function getDisplayDestination(region) {
  const destination = region.destination.trim();
  if (!destination || destination === "#") return "No destination yet";

  try {
    const url = new URL(destination);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return destination;
  }
}

function createRegionElement(region, index) {
  const node = document.createElement("div");
  node.className = `region${region.id === state.selectedId ? " is-selected" : ""}`;
  node.dataset.regionId = region.id;
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-pressed", String(region.id === state.selectedId));
  node.setAttribute("aria-describedby", "canvas-keyboard-help");
  node.setAttribute(
    "aria-label",
    `Area ${index + 1}. ${region.title || "No hover text"}.`,
  );
  if (region.title) node.title = region.title;

  const label = document.createElement("span");
  label.className = "region-label";
  label.textContent = String(index + 1);
  node.append(label);

  for (const handleName of HANDLES) {
    const handle = document.createElement("span");
    handle.className = `resize-handle handle-${handleName}`;
    handle.dataset.handle = handleName;
    handle.setAttribute("aria-hidden", "true");
    node.append(handle);
  }

  applyRegionStyle(node, region);
  return node;
}

function applyRegionStyle(node, region) {
  node.style.left = `${region.x}%`;
  node.style.top = `${region.y}%`;
  node.style.width = `${region.width}%`;
  node.style.height = `${region.height}%`;
}

function showSnapGuides(guides) {
  const hasHorizontalGuide = guides?.x !== null && guides?.x !== undefined;
  const hasVerticalGuide = guides?.y !== null && guides?.y !== undefined;
  elements.snapGuideX.hidden = !hasHorizontalGuide;
  elements.snapGuideY.hidden = !hasVerticalGuide;
  if (hasHorizontalGuide) elements.snapGuideX.style.left = `${guides.x}%`;
  if (hasVerticalGuide) elements.snapGuideY.style.top = `${guides.y}%`;
}

function hideSnapGuides() {
  elements.snapGuideX.hidden = true;
  elements.snapGuideY.hidden = true;
}

function showTemporaryGuides(guides) {
  window.clearTimeout(guideFeedbackTimer);
  showSnapGuides(guides);
  guideFeedbackTimer = window.setTimeout(hideSnapGuides, 650);
}

function setGeometryMessage(message = DEFAULT_GEOMETRY_MESSAGE) {
  elements.geometryMessage.textContent = message;
}

function syncRegionElement(region) {
  const node = [...elements.regionsLayer.children].find(
    (candidate) => candidate.dataset.regionId === region.id,
  );
  if (node) applyRegionStyle(node, region);
}

function renderRegions() {
  const fragment = document.createDocumentFragment();
  state.regions.forEach((region, index) => fragment.append(createRegionElement(region, index)));
  elements.regionsLayer.replaceChildren(fragment);
}

function renderRegionList() {
  if (state.regions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "region-list-empty";
    empty.innerHTML = `
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14M3 10h14"></path></svg>
      <span>Your link areas will be listed here.</span>
    `;
    elements.regionList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.regions.forEach((region, index) => {
    const button = document.createElement("button");
    const isSelected = region.id === state.selectedId;
    button.type = "button";
    button.className = `region-list-item${isSelected ? " is-selected" : ""}`;
    button.dataset.regionId = region.id;
    button.setAttribute("aria-pressed", String(isSelected));
    button.setAttribute("aria-describedby", "canvas-keyboard-help");

    const number = document.createElement("span");
    number.className = "region-list-number";
    number.textContent = String(index + 1);

    const copy = document.createElement("span");
    copy.className = "region-list-copy";
    const name = document.createElement("strong");
    name.textContent = region.title || `Area ${index + 1}`;
    const destination = document.createElement("small");
    destination.textContent = getDisplayDestination(region);
    copy.append(name, destination);

    const selectionState = document.createElement("span");
    selectionState.className = "region-list-state";
    selectionState.textContent = isSelected ? "Selected" : "";

    button.append(number, copy, selectionState);
    fragment.append(button);
  });
  elements.regionList.replaceChildren(fragment);
}

function renderDestinationState() {
  const region = selectedRegion();
  const error = region ? destinationError(region.destination) : "";
  elements.destinationUrl.setAttribute("aria-invalid", String(Boolean(error)));
  elements.destinationMessage.classList.toggle("is-error", Boolean(error));
  elements.destinationMessage.textContent = error || "Use a complete web URL, or # for no link.";
}

function renderGeometryInputs() {
  const region = selectedRegion();
  if (!region) return;

  for (const [property, input] of Object.entries(geometryInputs)) {
    input.value = formatNumber(region[property]);
  }

  elements.geometryX.max = formatNumber(100 - region.width);
  elements.geometryY.max = formatNumber(100 - region.height);
  elements.geometryWidth.max = formatNumber(100 - region.x);
  elements.geometryHeight.max = formatNumber(100 - region.y);
}

function renderInspector() {
  const region = selectedRegion();
  elements.inspectorEmpty.hidden = Boolean(region);
  elements.regionInspector.hidden = !region;
  if (!region) return;

  const index = regionIndex(region.id);
  elements.selectedRegionName.textContent = `Area ${index + 1}`;
  elements.destinationUrl.value = region.destination;
  elements.hoverTitle.value = region.title;
  setGeometryMessage();
  renderGeometryInputs();
  renderDestinationState();
}

function updateWorkflow(readyToCopy) {
  elements.workflowSteps.forEach((step) => {
    step.classList.remove("is-active", "is-complete");
    step.removeAttribute("aria-current");
  });

  if (!state.imageLoaded) {
    elements.workflowSteps[0]?.classList.add("is-active");
  } else if (state.regions.length === 0) {
    elements.workflowSteps[0]?.classList.add("is-complete");
    elements.workflowSteps[1]?.classList.add("is-active");
  } else {
    elements.workflowSteps[0]?.classList.add("is-complete");
    elements.workflowSteps[1]?.classList.add("is-complete");
    elements.workflowSteps[2]?.classList.add("is-active");
    if (readyToCopy) elements.workflowSteps[2]?.classList.add("is-complete");
  }

  elements.workflowSteps.forEach((step) => {
    const name = step.querySelector("strong")?.textContent ?? "Workflow step";
    const status = step.classList.contains("is-complete")
      ? "complete"
      : step.classList.contains("is-active")
        ? "current step"
        : "upcoming";
    step.setAttribute("aria-label", `${name}, ${status}`);
    if (step.classList.contains("is-active")) step.setAttribute("aria-current", "step");
  });
}

function renderOutput() {
  const generatedCode = generateBBCode(state.imageUrl, state.regions);
  const outputChanged = elements.bbcodeOutput.value !== generatedCode;
  elements.bbcodeOutput.value = generatedCode;
  if (outputChanged && elements.copyCode.classList.contains("is-copied")) {
    window.clearTimeout(copyFeedbackTimer);
    elements.copyCode.classList.remove("is-copied");
    elements.copyLabel.textContent = "Copy BBCode";
  }
  const invalidIndex = state.regions.findIndex((region) => destinationError(region.destination));
  const overlappingRegions = hasRegionOverlaps(state.regions);
  const ready =
    state.imageLoaded && state.regions.length > 0 && invalidIndex === -1 && !overlappingRegions;

  elements.copyCode.disabled = !ready;
  elements.outputReadyBadge.classList.toggle("is-ready", ready);
  elements.outputReadyBadge.classList.toggle("has-error", invalidIndex >= 0 || overlappingRegions);
  elements.outputStatus.classList.toggle("is-ready", ready);
  elements.outputStatus.classList.toggle("has-error", invalidIndex >= 0 || overlappingRegions);

  if (!state.imageLoaded) {
    elements.outputReadyBadge.textContent = "Needs image";
    elements.outputStatus.textContent = "Load a valid image to start generating your imagemap.";
  } else if (state.regions.length === 0) {
    elements.outputReadyBadge.textContent = "Needs an area";
    elements.outputStatus.textContent = "Add at least one link area to finish your imagemap.";
  } else if (invalidIndex >= 0) {
    elements.outputReadyBadge.textContent = "Check links";
    elements.outputStatus.textContent = `Fix Area ${invalidIndex + 1}'s destination URL before copying.`;
  } else if (overlappingRegions) {
    elements.outputReadyBadge.textContent = "Fix overlap";
    elements.outputStatus.textContent = "Move overlapping areas apart before copying.";
  } else {
    elements.outputReadyBadge.textContent = "Ready to copy";
    elements.outputStatus.textContent = `${pluralizeAreas(state.regions.length)} ready to paste into osu!.`;
  }

  updateWorkflow(ready);
}

function renderCounts() {
  elements.canvasCount.textContent = pluralizeAreas(state.regions.length);
  elements.regionCount.textContent = String(state.regions.length);
}

function renderAll() {
  renderCounts();
  renderRegions();
  renderRegionList();
  renderInspector();
  renderOutput();
}

function loadImage(candidate, { initial = false } = {}) {
  const trimmedUrl = String(candidate ?? "").trim();
  const validationError = imageUrlError(trimmedUrl);
  if (validationError) {
    setImageMessage(validationError, "error");
    elements.imageUrl.focus();
    return;
  }

  const canonicalUrl = canonicalizeWebUrl(trimmedUrl);

  const token = ++imageLoadToken;
  const hadLoadedImage = state.imageLoaded;
  const probe = new Image();
  probe.decoding = "async";
  probe.referrerPolicy = "no-referrer";

  setImageLoading(true);
  setImageMessage("Checking that image…");

  probe.onload = () => {
    if (token !== imageLoadToken) return;

    state.imageUrl = canonicalUrl;
    state.imageLoaded = true;
    state.naturalWidth = probe.naturalWidth;
    state.naturalHeight = probe.naturalHeight;
    elements.sourceImage.src = canonicalUrl;
    elements.imageStage.hidden = false;
    elements.canvasEmpty.hidden = true;
    elements.imageMeta.textContent = `${probe.naturalWidth} × ${probe.naturalHeight}px`;
    elements.imageUrl.value = canonicalUrl;
    elements.addRegion.disabled = false;
    setImageLoading(false);
    setImageMessage(`Image loaded — ${probe.naturalWidth} × ${probe.naturalHeight}px`, "success");
    persistProject();
    renderOutput();
    if (!initial) announce("Image loaded successfully.");
  };

  probe.onerror = () => {
    if (token !== imageLoadToken) return;

    state.imageLoaded = hadLoadedImage;
    setImageLoading(false);
    elements.addRegion.disabled = !state.imageLoaded;
    if (!state.imageLoaded) {
      elements.imageStage.hidden = true;
      elements.canvasEmpty.hidden = false;
      elements.imageMeta.textContent = "No image loaded";
    }
    setImageMessage(
      "That image could not be loaded. Check that the URL is public and points directly to an image.",
      "error",
    );
    renderOutput();
    announce("The image could not be loaded.");
  };

  probe.src = canonicalUrl;
}

function clearProject() {
  imageLoadToken += 1;
  if (activeGesture && elements.regionsLayer.hasPointerCapture?.(activeGesture.pointerId)) {
    elements.regionsLayer.releasePointerCapture(activeGesture.pointerId);
  }
  activeGesture = null;
  document.body.classList.remove("is-manipulating");
  window.clearTimeout(guideFeedbackTimer);
  window.clearTimeout(copyFeedbackTimer);
  window.clearTimeout(nudgeAnnouncementTimer);
  hideSnapGuides();
  hideToast();

  state.imageLoaded = false;
  state.imageUrl = "";
  state.naturalHeight = 0;
  state.naturalWidth = 0;
  state.regions = [];
  state.selectedId = null;
  restoredRegionChanges = 0;
  restoredRegionSkips = 0;

  elements.imageUrl.value = "";
  elements.sourceImage.removeAttribute("src");
  elements.imageStage.hidden = true;
  elements.canvasEmpty.hidden = false;
  elements.imageMeta.textContent = "No image loaded";
  elements.addRegion.disabled = true;
  elements.copyCode.classList.remove("is-copied");
  elements.copyLabel.textContent = "Copy BBCode";
  setImageLoading(false);
  setImageMessage(DEFAULT_IMAGE_MESSAGE);

  let storageCleared = true;
  for (const key of [STORAGE_KEY, RECOVERY_STORAGE_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      storageCleared = false;
    }
  }
  renderAll();
  updateClearAllButton();
  const message = storageCleared
    ? "Project cleared."
    : "Project cleared, but the browser autosave could not be removed.";
  showToast(message);
  announce(message);
  window.requestAnimationFrame(() => elements.imageUrl.focus());
}

function requestClearProject() {
  if (!hasProjectContent()) return;
  const imageDescription = state.imageLoaded ? "the current image" : "the entered image URL";
  const areaDescription = state.regions.length
    ? pluralizeAreas(state.regions.length)
    : "any link areas";
  elements.clearDialogDescription.textContent =
    `This removes ${imageDescription}, ${areaDescription}, and the saved project from this browser. ` +
    "This cannot be undone.";
  elements.clearDialog.showModal();
}

function addRegion() {
  if (!state.imageLoaded) return;

  const offset = (state.regions.length * 4) % 36;
  const proposedRegion = normalizeRegion(
    {
      id: createId(),
      x: 8 + offset,
      y: 8 + offset,
      width: 24,
      height: 16,
      destination: "#",
      title: "",
    },
    "new-area",
  );

  const region = findFreeRegionPlacement(proposedRegion, state.regions);
  if (!region) {
    showToast("No room for another area of this size.");
    announce("No room for another link area. Resize or delete an existing area first.");
    return;
  }

  state.regions.push(region);
  state.selectedId = region.id;
  persistProject();
  renderAll();
  announce(`Area ${state.regions.length} added and selected.`);
  window.requestAnimationFrame(() => focusCanvasRegion(region.id));
}

function selectRegion(id, { focusCanvas = false, focusList = false } = {}) {
  if (id !== null && regionIndex(id) === -1) return;
  state.selectedId = id;
  renderRegions();
  renderRegionList();
  renderInspector();

  if (focusCanvas && id) {
    window.requestAnimationFrame(() => focusCanvasRegion(id));
  } else if (focusList && id) {
    window.requestAnimationFrame(() => focusRegionListButton(id));
  }
}

function focusCanvasRegion(id) {
  const node = [...elements.regionsLayer.children].find(
    (candidate) => candidate.dataset.regionId === id,
  );
  node?.focus({ preventScroll: true });
}

function focusRegionListButton(id) {
  const button = [...elements.regionList.querySelectorAll("[data-region-id]")].find(
    (candidate) => candidate.dataset.regionId === id,
  );
  button?.focus({ preventScroll: true });
}

function duplicateSelectedRegion() {
  const source = selectedRegion();
  if (!source) return;

  const sourceIndex = regionIndex(source.id);
  const proposedDuplicate = normalizeRegion(
    {
      ...source,
      id: createId(),
      x: source.x + 3,
      y: source.y + 3,
    },
    "duplicate-area",
  );

  const duplicate = findFreeRegionPlacement(proposedDuplicate, state.regions);
  if (!duplicate) {
    showToast("No room to duplicate this area.");
    announce("No room to duplicate this link area. Resize or delete an existing area first.");
    return;
  }

  state.regions.splice(sourceIndex + 1, 0, duplicate);
  state.selectedId = duplicate.id;
  persistProject();
  renderAll();
  announce(`Area ${sourceIndex + 2} duplicated and selected.`);
  window.requestAnimationFrame(() => focusCanvasRegion(duplicate.id));
}

function deleteSelectedRegion() {
  const index = regionIndex(state.selectedId);
  if (index < 0) return;

  const [deleted] = state.regions.splice(index, 1);
  const nextRegion = state.regions[index] ?? state.regions[index - 1] ?? null;
  state.selectedId = nextRegion?.id ?? null;
  persistProject();
  renderAll();
  announce(`Area ${index + 1} deleted.`);

  window.requestAnimationFrame(() => {
    const nextButton = state.selectedId
      ? [...elements.regionList.querySelectorAll("[data-region-id]")].find(
          (candidate) => candidate.dataset.regionId === state.selectedId,
        )
      : null;
    (nextButton ?? elements.addRegion).focus();
  });

  showToast(`Area ${index + 1} deleted.`, {
    label: "Undo",
    handler: () => {
      const restoreIndex = Math.min(index, state.regions.length);
      const restored = findFreeRegionPlacement(deleted, state.regions);
      if (!restored) {
        showToast("There is no longer room to restore that area.");
        announce("The deleted area could not be restored because there is no free space.");
        return;
      }
      state.regions.splice(restoreIndex, 0, restored);
      state.selectedId = restored.id;
      persistProject();
      renderAll();
      const wasRelocated = restored.x !== deleted.x || restored.y !== deleted.y;
      showToast(
        wasRelocated
          ? `Area ${restoreIndex + 1} restored in the nearest open space.`
          : `Area ${restoreIndex + 1} restored.`,
      );
      announce(`Area ${restoreIndex + 1} restored and selected.`);
      window.requestAnimationFrame(() => {
        const restoredButton = [...elements.regionList.querySelectorAll("[data-region-id]")].find(
          (candidate) => candidate.dataset.regionId === deleted.id,
        );
        restoredButton?.focus();
      });
    },
  });
}

function applyGeometryInput(property, rawValue) {
  const region = selectedRegion();
  if (rawValue === "") return;
  const value = Number(rawValue);
  if (!region || !Number.isFinite(value)) return;

  const previous = { ...region };
  const others = state.regions.filter((candidate) => candidate.id !== region.id);
  let constrained;
  if (property === "x" || property === "y") {
    const directPlacement = normalizeRegion({ ...previous, [property]: value }, previous.id);
    constrained = others.some((candidate) => regionsOverlap(directPlacement, candidate))
      ? constrainRegionMove(previous, directPlacement, others).region
      : directPlacement;
  } else {
    const proposed = {
      ...previous,
      [property]: roundGeometry(
        clamp(
          value,
          MIN_REGION_SIZE,
          property === "width" ? 100 - previous.x : 100 - previous.y,
        ),
      ),
    };
    constrained = constrainRegionResize(
      previous,
      proposed,
      property === "width" ? "e" : "s",
      others,
    ).region;
  }

  Object.assign(region, constrained);
  geometryInputs[property].value = formatNumber(region[property]);
  if (Math.abs(region[property] - value) > 0.005) {
    const label = property === "x" || property === "y" ? property.toUpperCase() : property;
    setGeometryMessage(
      `${label} adjusted to ${formatNumber(region[property])}% to stay in bounds and avoid overlap.`,
    );
  } else {
    setGeometryMessage();
  }

  syncRegionElement(region);
  renderOutput();
  persistProject();
}

function beginGesture(event, id, handle) {
  const region = state.regions.find((candidate) => candidate.id === id);
  const stageBounds = elements.regionsLayer.getBoundingClientRect();
  if (!region || !stageBounds.width || !stageBounds.height) return;

  activeGesture = {
    handle,
    id,
    originRegion: { ...region },
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    rawRegion: { ...region },
    startClientX: event.clientX,
    startClientY: event.clientY,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    stageBounds,
  };
  window.clearTimeout(guideFeedbackTimer);
  elements.regionsLayer.setPointerCapture?.(event.pointerId);
  document.body.classList.add("is-manipulating");
}

function gestureSnapDistance(handle, pointerType) {
  const profile =
    pointerType === "touch" ? POINTER_SNAP_DISTANCE_PX.touch : POINTER_SNAP_DISTANCE_PX.mouse;
  if (handle === "move") return profile.move;
  return handle.length === 2 ? profile.corner : profile.side;
}

function moveGesture(event) {
  if (!activeGesture || event.pointerId !== activeGesture.pointerId) return;
  event.preventDefault();

  const region = state.regions.find((candidate) => candidate.id === activeGesture.id);
  if (!region) return;

  const {
    handle,
    originRegion,
    pointerType,
    rawRegion,
    stageBounds,
    startClientX,
    startClientY,
    lastClientX,
    lastClientY,
  } = activeGesture;
  const deltaX = ((event.clientX - lastClientX) / stageBounds.width) * 100;
  const deltaY = ((event.clientY - lastClientY) / stageBounds.height) * 100;
  activeGesture.lastClientX = event.clientX;
  activeGesture.lastClientY = event.clientY;
  const previous = { ...region };
  const others = state.regions.filter((candidate) => candidate.id !== region.id);
  const snapDistance = gestureSnapDistance(handle, pointerType);
  const snapThreshold = {
    x: (snapDistance / stageBounds.width) * 100,
    y: (snapDistance / stageBounds.height) * 100,
  };
  let result;

  if (handle === "move") {
    rawRegion.x += deltaX;
    rawRegion.y += deltaY;
    result = constrainRegionMove(
      previous,
      {
        ...rawRegion,
      },
      others,
      snapThreshold,
    );
    if (result.blockedAxes.x) rawRegion.x = result.region.x;
    if (result.blockedAxes.y) rawRegion.y = result.region.y;
  } else {
    const totalDeltaX = ((event.clientX - startClientX) / stageBounds.width) * 100;
    const totalDeltaY = ((event.clientY - startClientY) / stageBounds.height) * 100;
    let left = originRegion.x;
    let top = originRegion.y;
    let right = originRegion.x + originRegion.width;
    let bottom = originRegion.y + originRegion.height;

    if (handle.includes("w")) {
      left = clamp(originRegion.x + totalDeltaX, 0, right - MIN_REGION_SIZE);
    }
    if (handle.includes("e")) {
      right = clamp(
        originRegion.x + originRegion.width + totalDeltaX,
        left + MIN_REGION_SIZE,
        100,
      );
    }
    if (handle.includes("n")) {
      top = clamp(originRegion.y + totalDeltaY, 0, bottom - MIN_REGION_SIZE);
    }
    if (handle.includes("s")) {
      bottom = clamp(
        originRegion.y + originRegion.height + totalDeltaY,
        top + MIN_REGION_SIZE,
        100,
      );
    }

    result = constrainRegionResize(
      originRegion,
      {
        ...previous,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      },
      handle,
      others,
      snapThreshold,
    );
  }

  Object.assign(region, result.region);
  showSnapGuides(result.guides);
  syncRegionElement(region);
  renderGeometryInputs();
  renderOutput();
}

function endGesture(event) {
  if (!activeGesture || event.pointerId !== activeGesture.pointerId) return;
  if (elements.regionsLayer.hasPointerCapture?.(event.pointerId)) {
    elements.regionsLayer.releasePointerCapture(event.pointerId);
  }
  activeGesture = null;
  document.body.classList.remove("is-manipulating");
  hideSnapGuides();
  persistProject();
  renderGeometryInputs();
}

function nudgeRegion(event, region) {
  const movement = event.altKey ? 0.1 : event.shiftKey ? 2 : 0.5;
  if (!ARROW_KEYS.has(event.key)) return false;

  event.preventDefault();
  const previous = { ...region };
  const proposed = { ...region };
  if (event.key === "ArrowLeft") proposed.x -= movement;
  if (event.key === "ArrowRight") proposed.x += movement;
  if (event.key === "ArrowUp") proposed.y -= movement;
  if (event.key === "ArrowDown") proposed.y += movement;
  const others = state.regions.filter((candidate) => candidate.id !== region.id);
  const result = constrainRegionMove(region, proposed, others);
  const wasBlocked =
    Math.abs(result.region.x - proposed.x) > 0.005 ||
    Math.abs(result.region.y - proposed.y) > 0.005;
  Object.assign(region, result.region);
  if (wasBlocked) {
    window.clearTimeout(nudgeAnnouncementTimer);
    showTemporaryGuides(result.guides);
    const now = performance.now();
    if (now - lastConstraintAnnouncementAt > 700) {
      announce(`Area ${regionIndex(region.id) + 1} stopped to prevent an overlap or stay in bounds.`);
      lastConstraintAnnouncementAt = now;
    }
  } else if (region.x !== previous.x || region.y !== previous.y) {
    window.clearTimeout(nudgeAnnouncementTimer);
    const id = region.id;
    nudgeAnnouncementTimer = window.setTimeout(() => {
      const current = state.regions.find((candidate) => candidate.id === id);
      if (!current) return;
      announce(
        `Area ${regionIndex(id) + 1} moved to X ${formatNumber(current.x)} percent, ` +
          `Y ${formatNumber(current.y)} percent.`,
      );
    }, 180);
  }
  syncRegionElement(region);
  renderGeometryInputs();
  renderOutput();
  persistProject();
  return true;
}

function handleRegionKeydown(event, surface) {
  const target = event.target.closest("[data-region-id]");
  if (!target) return;
  const id = target.dataset.regionId;
  const region = state.regions.find((candidate) => candidate.id === id);
  if (!region) return;

  if (surface === "canvas" && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    selectRegion(id, { focusCanvas: true });
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    event.stopPropagation();
    state.selectedId = id;
    deleteSelectedRegion();
    return;
  }

  if (!ARROW_KEYS.has(event.key)) return;
  if (state.selectedId !== id) {
    selectRegion(id, {
      focusCanvas: surface === "canvas",
      focusList: surface === "list",
    });
  }
  nudgeRegion(event, region);
}

function fallbackCopy() {
  elements.bbcodeOutput.focus();
  elements.bbcodeOutput.select();
  elements.bbcodeOutput.setSelectionRange(0, elements.bbcodeOutput.value.length);
  return document.execCommand?.("copy") === true;
}

function downloadRecoveryBackup() {
  let savedLayout = "";
  try {
    savedLayout = localStorage.getItem(RECOVERY_STORAGE_KEY) ?? "";
  } catch {
    // The message below also covers browsers where storage became unavailable.
  }

  if (!savedLayout) {
    showToast("The original saved layout is no longer available.");
    announce("The original saved layout is no longer available.");
    return;
  }

  const downloadUrl = URL.createObjectURL(
    new Blob([savedLayout], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = "osu-imagemap-layout-backup.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  showToast("Original saved layout downloaded.");
  announce("Original saved layout downloaded.");
}

async function copyBBCode() {
  if (elements.copyCode.disabled) return;

  let copied = false;
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(elements.bbcodeOutput.value);
      copied = true;
    } else {
      copied = fallbackCopy();
    }
  } catch {
    copied = fallbackCopy();
  }

  if (!copied) {
    elements.bbcodeOutput.focus();
    elements.bbcodeOutput.select();
    showToast("Copy was blocked. The code is selected — press Ctrl+C.");
    announce("Copy was blocked. The code is selected for manual copying.");
    return;
  }

  window.clearTimeout(copyFeedbackTimer);
  elements.copyCode.classList.add("is-copied");
  elements.copyLabel.textContent = "Copied!";
  showToast("BBCode copied to your clipboard.");
  announce("BBCode copied to your clipboard.");
  copyFeedbackTimer = window.setTimeout(() => {
    elements.copyCode.classList.remove("is-copied");
    elements.copyLabel.textContent = "Copy BBCode";
  }, 2200);
}

function bindEvents() {
  elements.imageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadImage(elements.imageUrl.value);
  });

  elements.imageUrl.addEventListener("input", () => {
    if (elements.imageUrl.getAttribute("aria-invalid") === "true") {
      setImageMessage("Press Load image to check this URL.");
    }
    updateClearAllButton();
  });

  elements.useSample.addEventListener("click", () => {
    elements.imageUrl.value = SAMPLE_IMAGE_URL;
    loadImage(SAMPLE_IMAGE_URL);
  });
  elements.clearAll.addEventListener("click", requestClearProject);
  elements.clearDialog.addEventListener("close", () => {
    const shouldClear = elements.clearDialog.returnValue === "clear";
    elements.clearDialog.returnValue = "";
    if (shouldClear) {
      clearProject();
    } else {
      window.requestAnimationFrame(() => elements.clearAll.focus());
    }
  });

  elements.addRegion.addEventListener("click", addRegion);
  elements.duplicateRegion.addEventListener("click", duplicateSelectedRegion);
  elements.deleteRegion.addEventListener("click", deleteSelectedRegion);
  elements.copyCode.addEventListener("click", copyBBCode);

  elements.regionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-region-id]");
    if (button) selectRegion(button.dataset.regionId, { focusList: true });
  });
  elements.regionList.addEventListener("keydown", (event) => {
    handleRegionKeydown(event, "list");
  });

  elements.regionsLayer.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || activeGesture) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const regionNode = event.target.closest(".region");
    if (!regionNode) {
      selectRegion(null);
      return;
    }

    event.preventDefault();
    const id = regionNode.dataset.regionId;
    const handle = event.target.closest("[data-handle]")?.dataset.handle ?? "move";
    if (state.selectedId !== id) selectRegion(id);
    focusCanvasRegion(id);
    beginGesture(event, id, handle);
  });

  elements.regionsLayer.addEventListener("keydown", (event) => {
    handleRegionKeydown(event, "canvas");
  });

  window.addEventListener("pointermove", moveGesture, { passive: false });
  window.addEventListener("pointerup", endGesture);
  window.addEventListener("pointercancel", endGesture);

  elements.destinationUrl.addEventListener("input", () => {
    const region = selectedRegion();
    if (!region) return;
    region.destination = elements.destinationUrl.value.replace(/[\r\n\t]/g, " ");
    renderDestinationState();
    renderRegionList();
    renderOutput();
    persistProject();
  });

  elements.destinationUrl.addEventListener("blur", () => {
    const region = selectedRegion();
    if (!region) return;
    region.destination = sanitizeInline(region.destination);
    if (
      region.destination &&
      region.destination !== "#" &&
      !destinationError(region.destination)
    ) {
      region.destination = canonicalizeWebUrl(region.destination);
    }
    elements.destinationUrl.value = region.destination;
    renderDestinationState();
    renderOutput();
    persistProject();
    const error = destinationError(region.destination);
    if (error) announce(error);
  });

  elements.hoverTitle.addEventListener("input", () => {
    const region = selectedRegion();
    if (!region) return;
    region.title = elements.hoverTitle.value.replace(/[\r\n\t]/g, " ");
    renderRegions();
    renderRegionList();
    renderOutput();
    persistProject();
  });

  elements.hoverTitle.addEventListener("blur", () => {
    const region = selectedRegion();
    if (!region) return;
    region.title = sanitizeInline(region.title);
    elements.hoverTitle.value = region.title;
    renderRegions();
    renderRegionList();
    renderOutput();
    persistProject();
  });

  for (const [property, input] of Object.entries(geometryInputs)) {
    input.addEventListener("input", () => applyGeometryInput(property, input.value));
    input.addEventListener("blur", renderGeometryInputs);
  }

  elements.toast.addEventListener("mouseenter", () => window.clearTimeout(toastTimer));
  elements.toast.addEventListener("mouseleave", scheduleToastHide);
  elements.toast.addEventListener("focusin", () => window.clearTimeout(toastTimer));
  elements.toast.addEventListener("focusout", (event) => {
    if (!elements.toast.contains(event.relatedTarget)) scheduleToastHide();
  });
  elements.toastDismiss.addEventListener("click", hideToast);

  document.addEventListener("keydown", (event) => {
    const tagName = event.target.tagName;
    const isInteractive = ["INPUT", "TEXTAREA", "BUTTON", "A"].includes(tagName);
    if (isInteractive) return;

    if (event.key === "Escape") {
      selectRegion(null);
    } else if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
      event.preventDefault();
      deleteSelectedRegion();
    }
  });
}

function init() {
  restoreProject();
  elements.imageUrl.value = state.imageUrl;
  bindEvents();
  renderAll();

  if (restoredRegionChanges || restoredRegionSkips) {
    persistProject();
    const repairMessage = [
      restoredRegionChanges
        ? `${pluralizeAreas(restoredRegionChanges)} moved to prevent overlap`
        : "",
      restoredRegionSkips
        ? `${pluralizeAreas(restoredRegionSkips)} could not fit and were skipped`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    showToast(`Saved layout repaired: ${repairMessage}.`, {
      label: "Download original",
      handler: downloadRecoveryBackup,
    });
    announce(`Saved layout repaired. ${repairMessage}.`);
  }

  if (state.imageUrl) {
    loadImage(state.imageUrl, { initial: true });
  } else {
    setImageMessage(DEFAULT_IMAGE_MESSAGE);
    updateClearAllButton();
  }
}

init();
