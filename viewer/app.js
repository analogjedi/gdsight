import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const DATASETS = [
  { slug: "cw-top", label: "CW Top Overview", mode: "json", metaPath: "./data/cw-top.json" },
  { slug: "main-overview", label: "Main Support Overview", mode: "json", metaPath: "./data/main-overview.json" },
  { slug: "sar-overview", label: "SAR ADC Overview", mode: "json", metaPath: "./data/sar-overview.json" },
  { slug: "bandgap", label: "Bandgap Detail", mode: "glb", metaPath: "./data/bandgap.json", glbPath: "/glb/bandgap.glb" },
  { slug: "regulator", label: "LDO Detail", mode: "glb", metaPath: "./data/regulator.json", glbPath: "/glb/regulator.glb" },
  { slug: "bias", label: "Bias Detail", mode: "glb", metaPath: "./data/bias.json", glbPath: "/glb/bias.glb" },
  { slug: "sar-comparator", label: "Comparator Detail", mode: "glb", metaPath: "./data/sar-comparator.json", glbPath: "/glb/sar-comparator.glb" },
  { slug: "sar-dac", label: "SAR DAC Detail", mode: "glb", metaPath: "./data/sar-dac.json", glbPath: "/glb/sar-dac.glb" },
];

const QUICK_DATASETS = ["cw-top", "main-overview", "sar-overview", "bandgap", "regulator", "bias", "sar-comparator", "sar-dac"];
const DATASET_BY_SLUG = new Map(DATASETS.map((dataset) => [dataset.slug, dataset]));
const gltfLoader = new GLTFLoader();

const dom = {
  canvas: document.querySelector("#scene"),
  quickActions: document.querySelector("#quick-actions"),
  snapshotView: document.querySelector("#snapshot-view"),
  toggleMetals: document.querySelector("#toggle-metals"),
  toggleVias: document.querySelector("#toggle-vias"),
  toggleBase: document.querySelector("#toggle-base"),
  quickMixButton: document.querySelector("#quick-mix-button"),
  quickMixMenu: document.querySelector("#quick-mix-menu"),
  mixMetals: document.querySelector("#mix-metals"),
  mixVias: document.querySelector("#mix-vias"),
  mixBase: document.querySelector("#mix-base"),
  mixPoly: document.querySelector("#mix-poly"),
  datasetSelect: document.querySelector("#dataset-select"),
  datasetButtons: document.querySelector("#dataset-buttons"),
  loadStatus: document.querySelector("#load-status"),
  loadProgressTrack: document.querySelector("#load-progress-track"),
  loadProgressBar: document.querySelector("#load-progress-bar"),
  layerList: document.querySelector("#layer-list"),
  sceneStats: document.querySelector("#scene-stats"),
  datasetMeta: document.querySelector("#dataset-meta"),
  explodeRange: document.querySelector("#explode-range"),
  resetCamera: document.querySelector("#reset-camera"),
  controlHint: document.querySelector("#control-hint"),
  flyMode: document.querySelector("#fly-mode"),
  grabMode: document.querySelector("#grab-mode"),
  orbitMode: document.querySelector("#orbit-mode"),
  hudPrimary: document.querySelector("#hud-primary"),
  hudSecondary: document.querySelector("#hud-secondary"),
  hudTertiary: document.querySelector("#hud-tertiary"),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#08111a");
scene.fog = new THREE.Fog("#08111a", 800, 6800);

const renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 30000);
camera.position.set(420, 340, 520);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 25, 0);
controls.minDistance = 8;
controls.maxDistance = 12000;
controls.zoomToCursor = true;

const interactionState = { mode: "fly" };
const dragState = { active: false, pointerId: null, lastX: 0, lastY: 0 };
const flyState = {
  activeKeys: new Set(),
  pointerLocked: false,
  yaw: 0,
  pitch: -0.38,
  speed: 80,
};
const clock = new THREE.Clock();
const worldUp = new THREE.Vector3(0, 1, 0);
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraUp = new THREE.Vector3();
const translationDelta = new THREE.Vector3();
const planarForward = new THREE.Vector3();
const planarRight = new THREE.Vector3();
const flyDirection = new THREE.Vector3();
const lookDirection = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
const orbitPivot = new THREE.Vector3();
const lookEuler = new THREE.Euler(0, 0, 0, "YXZ");

const FLY_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "KeyR", "KeyF", "ShiftLeft", "ShiftRight"]);

const ambient = new THREE.HemisphereLight("#dbe6f5", "#07111b", 1.7);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight("#fff7ea", 1.25);
keyLight.position.set(900, 1200, 700);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight("#7ac9ff", 0.45);
fillLight.position.set(-550, 640, -320);
scene.add(fillLight);

const grid = new THREE.GridHelper(5000, 50, "#35546c", "#122030");
grid.position.y = -7.1;
scene.add(grid);

const axes = new THREE.AxesHelper(60);
scene.add(axes);

const contentRoot = new THREE.Group();
scene.add(contentRoot);

const state = {
  activeDataset: null,
  activeGroup: null,
  activeItems: [],
  activeRenderMode: "json",
  explodeAmount: Number(dom.explodeRange.value),
  loadToken: 0,
};

function classifyLayerCategory(layer) {
  if (!layer) {
    return "other";
  }

  const name = layer.name.toLowerCase();
  if (layer.datatype === 44) {
    return "via";
  }
  if (name.includes("poly")) {
    return "poly";
  }
  if (name.startsWith("metal") || name === "li") {
    return "metal";
  }
  if (name.includes("well") || name.includes("diffusion")) {
    return "base";
  }
  return "other";
}

function getLayerItems() {
  return state.activeItems.filter((item) => item.category !== "overview");
}

function getItemsByCategories(categories) {
  const categorySet = new Set(categories);
  return state.activeItems.filter((item) => categorySet.has(item.category));
}

function setQuickMixOpen(open) {
  dom.quickMixMenu.hidden = !open;
  dom.quickMixButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function setItemVisibility(item, visible) {
  item.object.visible = visible;
  if (item.companion) {
    item.companion.visible = visible;
  }
  if (item.checkbox) {
    item.checkbox.checked = visible;
  }
}

function syncMixCheckbox(input, categories) {
  const items = getItemsByCategories(categories);
  const visibleCount = items.filter((item) => item.object.visible).length;
  input.disabled = items.length === 0;
  input.checked = items.length > 0 && visibleCount === items.length;
  input.indeterminate = visibleCount > 0 && visibleCount < items.length;
}

function updateQuickActionState() {
  const hasDetailLayers = state.activeDataset?.kind === "detail" && getLayerItems().length > 0;
  dom.quickActions.hidden = !hasDetailLayers;
  if (!hasDetailLayers) {
    setQuickMixOpen(false);
    dom.quickMixButton.textContent = "Quick Mix";
    return;
  }

  const groups = [
    { button: dom.toggleMetals, items: getItemsByCategories(["metal"]), label: "Metals" },
    { button: dom.toggleVias, items: getItemsByCategories(["via"]), label: "Vias" },
    { button: dom.toggleBase, items: getItemsByCategories(["base", "poly"]), label: "Base Layers" },
  ];

  groups.forEach(({ button, items, label }) => {
    const visibleCount = items.filter((item) => item.object.visible).length;
    const allVisible = items.length > 0 && visibleCount === items.length;
    const partialVisible = visibleCount > 0 && visibleCount < items.length;

    button.disabled = items.length === 0;
    button.textContent = `${allVisible ? "Hide" : "Show"} ${label}`;
    button.classList.toggle("is-active", allVisible);
    button.classList.toggle("is-mixed", partialVisible);
  });

  syncMixCheckbox(dom.mixMetals, ["metal"]);
  syncMixCheckbox(dom.mixVias, ["via"]);
  syncMixCheckbox(dom.mixBase, ["base"]);
  syncMixCheckbox(dom.mixPoly, ["poly"]);

  const activeMixCount = [dom.mixMetals, dom.mixVias, dom.mixBase, dom.mixPoly].filter((input) => input.checked).length;
  dom.quickMixButton.textContent = activeMixCount === 4 ? "Quick Mix: All" : `Quick Mix (${activeMixCount}/4)`;
}

function refreshVisibilityUi() {
  updateStats();
  updateQuickActionState();
}

function setCategoriesVisibility(categories, visible) {
  getItemsByCategories(categories).forEach((item) => setItemVisibility(item, visible));
  refreshVisibilityUi();
}

function buildSnapshotFilename() {
  const slug = state.activeDataset?.slug || "scene";
  const stamp = new Date()
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `gdsight-${slug}-${stamp}.png`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function captureSnapshot() {
  renderer.render(scene, camera);
  const filename = buildSnapshotFilename();

  const handleBlob = (blob) => {
    if (!blob) {
      setLoadProgress("Snapshot failed: browser did not return image data.", 1, { error: true });
      return;
    }
    triggerDownload(blob, filename);
    dom.loadStatus.textContent = `Saved snapshot ${filename}`;
  };

  if (typeof dom.canvas.toBlob === "function") {
    dom.canvas.toBlob(handleBlob, "image/png");
    return;
  }

  const dataUrl = dom.canvas.toDataURL("image/png");
  fetch(dataUrl)
    .then((response) => response.blob())
    .then(handleBlob)
    .catch((error) => {
      console.error(error);
      setLoadProgress(`Snapshot failed: ${error.message}`, 1, { error: true });
    });
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  material.dispose();
}

function disposeGroup(group) {
  if (!group) {
    return;
  }
  group.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      disposeMaterial(child.material);
    }
  });
}

function setLoadProgress(text, fraction = null, options = {}) {
  const { indeterminate = false, error = false } = options;
  dom.loadStatus.textContent = text;
  dom.loadProgressTrack.classList.remove("is-indeterminate", "is-error");

  if (error) {
    dom.loadProgressTrack.classList.add("is-error");
    dom.loadProgressBar.style.width = "100%";
    return;
  }

  if (indeterminate || fraction === null) {
    dom.loadProgressTrack.classList.add("is-indeterminate");
    dom.loadProgressBar.style.width = "38%";
    return;
  }

  dom.loadProgressBar.style.width = `${Math.max(0, Math.min(fraction, 1)) * 100}%`;
}

function updateFlyHud() {
  if (interactionState.mode === "fly") {
    dom.hudPrimary.textContent = flyState.pointerLocked ? "Fly: mouse look active" : "Fly: click view to capture mouse";
    dom.hudSecondary.textContent = "WASD move, arrows or R/F change height, wheel sets speed";
    dom.hudTertiary.textContent = `Speed ${flyState.speed.toFixed(0)} um/s${flyState.pointerLocked ? " | Esc releases mouse" : ""}`;
    return;
  }

  if (interactionState.mode === "grab") {
    dom.hudPrimary.textContent = "Grab: drag X/Y";
    dom.hudSecondary.textContent = "Hold Shift while dragging to push or pull depth";
    dom.hudTertiary.textContent = "Quest path: world grab analogue";
    return;
  }

  dom.hudPrimary.textContent = "Orbit: left drag rotates";
  dom.hudSecondary.textContent = "Right drag pans, wheel zooms toward the pointer";
  dom.hudTertiary.textContent = "Pivot retargets to the visible hit point";
}

function syncFlyAnglesFromCamera() {
  lookEuler.setFromQuaternion(camera.quaternion);
  flyState.yaw = lookEuler.y;
  flyState.pitch = THREE.MathUtils.clamp(lookEuler.x, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
}

function applyFlyLook() {
  camera.rotation.order = "YXZ";
  camera.rotation.y = flyState.yaw;
  camera.rotation.x = flyState.pitch;
  camera.rotation.z = 0;
  camera.getWorldDirection(lookDirection);
  controls.target.copy(camera.position).addScaledVector(lookDirection, 100);
}

function requestFlyPointerLock() {
  if (interactionState.mode !== "fly" || document.pointerLockElement === dom.canvas) {
    return;
  }
  dom.canvas.requestPointerLock?.();
}

function exitFlyPointerLock() {
  if (document.pointerLockElement === dom.canvas) {
    document.exitPointerLock?.();
  }
}

function setInteractionMode(mode) {
  interactionState.mode = mode;
  controls.enabled = mode === "orbit";
  dom.canvas.style.cursor =
    mode === "grab" ? (dragState.active ? "grabbing" : "grab") : mode === "fly" ? "crosshair" : "default";
  dom.flyMode.classList.toggle("is-active", mode === "fly");
  dom.grabMode.classList.toggle("is-active", mode === "grab");
  dom.orbitMode.classList.toggle("is-active", mode === "orbit");
  dom.controlHint.textContent =
    mode === "fly"
      ? "Click the view to capture the mouse. WASD moves across the layout plane, arrows or R/F move through the layer stack, and the wheel adjusts fly speed."
      : mode === "grab"
      ? "Drag to move the layout in X/Y. Hold Shift while dragging to push or pull depth."
      : "Left drag orbits around the center-screen hit point, right drag pans, and wheel or trackpad zoom goes toward the pointer.";

  if (mode !== "fly") {
    exitFlyPointerLock();
    flyState.activeKeys.clear();
  } else {
    syncFlyAnglesFromCamera();
    applyFlyLook();
  }

  if (mode === "orbit") {
    retargetOrbitPivot();
  }

  updateFlyHud();
}

function translateView(delta) {
  camera.position.add(delta);
  if (interactionState.mode === "fly") {
    applyFlyLook();
  } else {
    controls.target.add(delta);
    controls.update();
  }
}

function moveViewFromDrag(deltaX, deltaY, depthOnly) {
  const distance = camera.position.distanceTo(controls.target);
  const moveScale = Math.max(distance * 0.0028, 0.04);

  camera.getWorldDirection(cameraForward).normalize();
  cameraRight.crossVectors(cameraForward, camera.up).normalize();
  cameraUp.copy(camera.up).normalize();
  translationDelta.set(0, 0, 0);

  if (depthOnly) {
    translationDelta.addScaledVector(cameraForward, deltaY * moveScale * 1.5);
  } else {
    translationDelta.addScaledVector(cameraRight, -deltaX * moveScale);
    translationDelta.addScaledVector(cameraUp, deltaY * moveScale);
  }

  translateView(translationDelta);
}

function adjustFlySpeed(deltaY) {
  const multiplier = deltaY > 0 ? 0.88 : 1.14;
  flyState.speed = THREE.MathUtils.clamp(flyState.speed * multiplier, 6, 1600);
  updateFlyHud();
}

function updateFlyMovement(deltaSeconds) {
  if (interactionState.mode !== "fly") {
    return;
  }

  flyDirection.set(0, 0, 0);
  planarForward.set(-Math.sin(flyState.yaw), 0, -Math.cos(flyState.yaw));
  planarRight.set(Math.cos(flyState.yaw), 0, -Math.sin(flyState.yaw));

  if (flyState.activeKeys.has("KeyW")) {
    flyDirection.add(planarForward);
  }
  if (flyState.activeKeys.has("KeyS")) {
    flyDirection.sub(planarForward);
  }
  if (flyState.activeKeys.has("KeyD")) {
    flyDirection.add(planarRight);
  }
  if (flyState.activeKeys.has("KeyA")) {
    flyDirection.sub(planarRight);
  }
  if (flyState.activeKeys.has("ArrowUp") || flyState.activeKeys.has("KeyR")) {
    flyDirection.add(worldUp);
  }
  if (flyState.activeKeys.has("ArrowDown") || flyState.activeKeys.has("KeyF")) {
    flyDirection.sub(worldUp);
  }

  if (flyDirection.lengthSq() < 1e-7) {
    return;
  }

  flyDirection.normalize();
  const speedMultiplier = flyState.activeKeys.has("ShiftLeft") || flyState.activeKeys.has("ShiftRight") ? 2.6 : 1;
  translateView(flyDirection.multiplyScalar(flyState.speed * speedMultiplier * deltaSeconds));
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const fitHeightDistance = maxSize / (2 * Math.tan((Math.PI * camera.fov) / 360));
  const distance = fitHeightDistance * 1.6;

  camera.position.set(center.x + distance * 0.96, center.y + distance * 0.72, center.z + distance * 0.88);
  controls.target.copy(center);
  camera.lookAt(center);
  flyState.speed = THREE.MathUtils.clamp(maxSize * 0.18, 12, 420);
  syncFlyAnglesFromCamera();
  if (interactionState.mode === "fly") {
    applyFlyLook();
  } else {
    controls.update();
  }
  updateFlyHud();
}

function getOrbitableObjects() {
  return state.activeItems
    .filter((item) => item.object.visible)
    .map((item) => item.object);
}

function retargetOrbitPivot(ndc = screenCenter) {
  if (interactionState.mode !== "orbit" || !state.activeGroup) {
    return false;
  }

  const orbitableObjects = getOrbitableObjects();
  if (!orbitableObjects.length) {
    return false;
  }

  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(orbitableObjects, false);
  if (!hits.length) {
    return false;
  }

  orbitPivot.copy(hits[0].point);
  controls.target.copy(orbitPivot);
  controls.update();
  return true;
}

function makeShape(points, offsetX, offsetY) {
  return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x - offsetX, y - offsetY)));
}

function buildDetailScene(data) {
  const root = new THREE.Group();
  const items = [];
  const offsetX = data.size_um[0] / 2;
  const offsetY = data.size_um[1] / 2;

  data.layers.forEach((layer, index) => {
    if (!layer.polygons.length) {
      return;
    }
    const shapes = layer.polygons.map((polygon) => makeShape(polygon, offsetX, offsetY));
    const geometry = new THREE.ExtrudeGeometry(shapes, {
      depth: layer.z_top - layer.z_bottom,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, layer.z_bottom, 0);
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhysicalMaterial({
      color: layer.color,
      transparent: layer.opacity < 0.99,
      opacity: layer.opacity,
      metalness: 0.16,
      roughness: 0.55,
      transmission: layer.opacity < 0.4 ? 0.06 : 0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = index;
    root.add(mesh);

    items.push({
      id: layer.key,
      label: layer.name,
      subtitle: `GDS ${layer.layer}/${layer.datatype}`,
      metric: `${layer.polygon_count.toLocaleString()} polys`,
      color: layer.color,
      category: classifyLayerCategory(layer),
      object: mesh,
      explodeIndex: index,
      baseY: 0,
    });
  });

  return { root, items };
}

function buildOverviewScene(data) {
  const root = new THREE.Group();
  const items = [];
  const offsetX = (data.bounds.min[0] + data.bounds.max[0]) / 2;
  const offsetY = (data.bounds.min[1] + data.bounds.max[1]) / 2;

  data.references.forEach((reference, index) => {
    const width = reference.size_um[0];
    const depth = reference.size_um[1];
    const height = Math.max(6, Math.min(26, Math.log2(width * depth + 1) * 1.8));
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshPhysicalMaterial({
      color: reference.color,
      transparent: true,
      opacity: 0.86,
      metalness: 0.1,
      roughness: 0.45,
    });

    const mesh = new THREE.Mesh(geometry, material);
    const centerX = (reference.bounds.min[0] + reference.bounds.max[0]) / 2 - offsetX;
    const centerZ = (reference.bounds.min[1] + reference.bounds.max[1]) / 2 - offsetY;
    mesh.position.set(centerX, height / 2, centerZ);
    root.add(mesh);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: "#d6e6f5", transparent: true, opacity: 0.3 })
    );
    edge.position.copy(mesh.position);
    root.add(edge);

    items.push({
      id: `${reference.cell}-${index}`,
      label: reference.title,
      subtitle: reference.cell,
      metric: `${reference.size_um[0].toFixed(1)} x ${reference.size_um[1].toFixed(1)} um`,
      color: reference.color,
      category: "overview",
      object: mesh,
      companion: edge,
      explodeIndex: index,
      baseY: height / 2,
    });
  });

  return { root, items };
}

function normalizeMaterials(material) {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((entry) => {
    entry.side = THREE.DoubleSide;
    if (entry.opacity < 0.999) {
      entry.transparent = true;
      entry.depthWrite = false;
    }
  });
}

function buildGlbScene(data, gltf) {
  const root = gltf.scene;
  const items = [];
  const metaByKey = new Map(data.layers.map((layer) => [`${layer.layer}:${layer.datatype}`, layer]));
  const meshes = [];

  root.traverse((child) => {
    if (child.isMesh) {
      meshes.push(child);
    }
  });

  meshes.forEach((mesh, index) => {
    normalizeMaterials(mesh.material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = index;

    const match = mesh.name.match(/(\d+)\/(\d+)/);
    const meta = match ? metaByKey.get(`${match[1]}:${match[2]}`) : data.layers[index];
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

    items.push({
      id: meta ? meta.key : `mesh-${index}`,
      label: meta ? meta.name : mesh.name || `Layer ${index + 1}`,
      subtitle: meta ? `GDS ${meta.layer}/${meta.datatype}` : "GLB mesh",
      metric: meta ? `${meta.polygon_count.toLocaleString()} polys` : `${mesh.geometry.attributes.position.count.toLocaleString()} verts`,
      color: meta ? meta.color : `#${material.color.getHexString()}`,
      category: classifyLayerCategory(meta),
      object: mesh,
      explodeIndex: index,
      baseY: mesh.position.y,
    });
  });

  return { root, items };
}

function renderItemList() {
  dom.layerList.innerHTML = "";
  state.activeItems.forEach((item) => {
    const row = document.createElement("label");
    row.className = "layer-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.object.visible;
    checkbox.addEventListener("change", () => {
      setItemVisibility(item, checkbox.checked);
      refreshVisibilityUi();
    });
    item.checkbox = checkbox;

    const label = document.createElement("div");
    label.className = "layer-label";
    label.innerHTML = `<strong>${item.label}</strong><span class="layer-label-text">${item.subtitle}</span>`;

    const swatch = document.createElement("div");
    swatch.className = "layer-label";
    swatch.innerHTML = `<span class="swatch" style="background:${item.color}"></span><span class="swatch-code">${item.metric}</span>`;

    row.append(checkbox, label, swatch);
    dom.layerList.append(row);
  });

  updateQuickActionState();
}

function renderMeta(data, dataset) {
  const detailLine =
    data.kind === "detail"
      ? `<div class="meta-line"><span>Rendered Layers</span><strong>${data.layer_count}</strong></div>
         <div class="meta-line"><span>Rendered Polygons</span><strong>${data.polygon_count.toLocaleString()}</strong></div>`
      : `<div class="meta-line"><span>Referenced Blocks</span><strong>${data.references.length}</strong></div>
         <div class="meta-line"><span>View Type</span><strong>Placement Overview</strong></div>`;

  const sourceMode = state.activeRenderMode === "glb" ? "GLB scene" : state.activeRenderMode === "json-fallback" ? "JSON fallback" : "JSON prototype";
  dom.datasetMeta.innerHTML = `
    <strong>${data.title}</strong>
    <p>${data.summary}</p>
    <div class="meta-line"><span>Source Cell</span><strong>${data.source.cell}</strong></div>
    <div class="meta-line"><span>Footprint</span><strong>${data.size_um[0].toFixed(1)} x ${data.size_um[1].toFixed(1)} um</strong></div>
    <div class="meta-line"><span>Render Path</span><strong>${sourceMode}</strong></div>
    ${detailLine}
  `;
}

function updateStats() {
  if (!state.activeGroup) {
    dom.sceneStats.innerHTML = "";
    return;
  }

  const box = new THREE.Box3().setFromObject(state.activeGroup);
  const size = box.getSize(new THREE.Vector3());
  const visibleCount = state.activeItems.filter((item) => item.object.visible).length;
  const sourceMode = state.activeRenderMode === "glb" ? "GLB" : state.activeRenderMode === "json-fallback" ? "JSON fallback" : "JSON";

  const stats = [
    ["Visible Items", `${visibleCount}/${state.activeItems.length}`],
    ["Scene Width", `${size.x.toFixed(1)} um`],
    ["Scene Height", `${size.y.toFixed(1)} um`],
    ["Scene Depth", `${size.z.toFixed(1)} um`],
    ["Source", state.activeDataset ? state.activeDataset.source.cell : "-"],
    ["Render Path", sourceMode],
  ];

  dom.sceneStats.innerHTML = stats.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");
}

function applyExplode(amount) {
  state.explodeAmount = amount;
  state.activeItems.forEach((item) => {
    const isDetail = state.activeDataset?.kind === "detail";
    const extraLift = isDetail ? item.explodeIndex * amount * 0.22 : item.explodeIndex * amount * 0.48;
    item.object.position.y = item.baseY + extraLift;
    if (item.companion) {
      item.companion.position.y = item.baseY + extraLift;
    }
  });
  updateStats();
}

async function fetchMetadata(dataset) {
  setLoadProgress(`Loading ${dataset.label} metadata...`, 0.08);
  const response = await fetch(dataset.metaPath);
  if (!response.ok) {
    throw new Error(`Metadata request failed with ${response.status}`);
  }
  return response.json();
}

function loadGlb(dataset, token) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      dataset.glbPath,
      (gltf) => resolve(gltf),
      (event) => {
        if (token !== state.loadToken) {
          return;
        }
        if (event.total > 0) {
          setLoadProgress(
            `Loading ${dataset.label} GLB... ${Math.round((event.loaded / event.total) * 100)}%`,
            0.12 + (event.loaded / event.total) * 0.78
          );
        } else {
          setLoadProgress(`Loading ${dataset.label} GLB...`, null, { indeterminate: true });
        }
      },
      reject
    );
  });
}

async function buildDatasetScene(dataset, data, token) {
  if (dataset.mode === "json") {
    setLoadProgress(`Building ${dataset.label} scene...`, 0.92);
    return { ...((data.kind === "detail" ? buildDetailScene(data) : buildOverviewScene(data))), renderMode: "json" };
  }

  try {
    const gltf = await loadGlb(dataset, token);
    if (token !== state.loadToken) {
      return null;
    }
    setLoadProgress(`Building ${dataset.label} GLB scene...`, 0.96);
    return { ...buildGlbScene(data, gltf), renderMode: "glb" };
  } catch (error) {
    console.error(error);
    setLoadProgress(`GLB failed for ${dataset.label}, falling back to JSON geometry...`, null, { indeterminate: true });
    return { ...buildDetailScene(data), renderMode: "json-fallback" };
  }
}

async function loadDataset(slug) {
  const token = ++state.loadToken;
  const dataset = DATASET_BY_SLUG.get(slug);
  if (!dataset) {
    return;
  }

  try {
    const data = await fetchMetadata(dataset);
    if (token !== state.loadToken) {
      return;
    }

    const built = await buildDatasetScene(dataset, data, token);
    if (!built || token !== state.loadToken) {
      return;
    }

    if (state.activeGroup) {
      contentRoot.remove(state.activeGroup);
      disposeGroup(state.activeGroup);
    }

    state.activeDataset = data;
    state.activeGroup = built.root;
    state.activeItems = built.items;
    state.activeRenderMode = built.renderMode;
    contentRoot.add(built.root);

    dom.datasetSelect.value = slug;
    document.querySelectorAll(".chip").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.slug === slug);
    });

    renderMeta(data, dataset);
    renderItemList();
    applyExplode(state.explodeAmount);
    fitCameraToObject(state.activeGroup);
    setLoadProgress(
      `Loaded ${data.source.cell} from ${built.renderMode === "glb" ? dataset.glbPath : data.source.gds}`,
      1
    );
  } catch (error) {
    console.error(error);
    if (token !== state.loadToken) {
      return;
    }
    setLoadProgress(`Failed to load ${dataset.label}: ${error.message}`, 1, { error: true });
  }
}

function buildDatasetControls() {
  DATASETS.forEach((dataset) => {
    const option = document.createElement("option");
    option.value = dataset.slug;
    option.textContent = dataset.label;
    dom.datasetSelect.append(option);
  });

  QUICK_DATASETS.forEach((slug) => {
    const dataset = DATASET_BY_SLUG.get(slug);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.slug = slug;
    button.textContent = dataset.label.replace(" Detail", "").replace(" Overview", "");
    button.addEventListener("click", () => loadDataset(slug));
    dom.datasetButtons.append(button);
  });

  dom.datasetSelect.addEventListener("change", (event) => {
    loadDataset(event.target.value);
  });
}

dom.explodeRange.addEventListener("input", (event) => {
  applyExplode(Number(event.target.value));
});

dom.resetCamera.addEventListener("click", () => {
  fitCameraToObject(state.activeGroup || contentRoot);
});

dom.snapshotView.addEventListener("click", () => {
  captureSnapshot();
});

dom.toggleMetals.addEventListener("click", () => {
  const items = getItemsByCategories(["metal"]);
  if (!items.length) {
    return;
  }
  const shouldShow = items.some((item) => !item.object.visible);
  setCategoriesVisibility(["metal"], shouldShow);
});

dom.toggleVias.addEventListener("click", () => {
  const items = getItemsByCategories(["via"]);
  if (!items.length) {
    return;
  }
  const shouldShow = items.some((item) => !item.object.visible);
  setCategoriesVisibility(["via"], shouldShow);
});

dom.toggleBase.addEventListener("click", () => {
  const items = getItemsByCategories(["base", "poly"]);
  if (!items.length) {
    return;
  }
  const shouldShow = items.some((item) => !item.object.visible);
  setCategoriesVisibility(["base", "poly"], shouldShow);
});

dom.quickMixButton.addEventListener("click", () => {
  setQuickMixOpen(dom.quickMixMenu.hidden);
});

[
  [dom.mixMetals, ["metal"]],
  [dom.mixVias, ["via"]],
  [dom.mixBase, ["base"]],
  [dom.mixPoly, ["poly"]],
].forEach(([input, categories]) => {
  input.addEventListener("change", () => {
    setCategoriesVisibility(categories, input.checked);
  });
});

document.addEventListener("pointerdown", (event) => {
  if (!dom.quickActions.hidden && !dom.quickMixMenu.hidden && !dom.quickActions.contains(event.target)) {
    setQuickMixOpen(false);
  }
});

dom.flyMode.addEventListener("click", () => {
  setInteractionMode("fly");
});

dom.grabMode.addEventListener("click", () => {
  setInteractionMode("grab");
});

dom.orbitMode.addEventListener("click", () => {
  setInteractionMode("orbit");
});

dom.canvas.addEventListener("pointerdown", (event) => {
  if (interactionState.mode === "fly" && event.button === 0) {
    requestFlyPointerLock();
    return;
  }
  if (interactionState.mode !== "grab" || event.button !== 0) {
    return;
  }
  dragState.active = true;
  dragState.pointerId = event.pointerId;
  dragState.lastX = event.clientX;
  dragState.lastY = event.clientY;
  dom.canvas.style.cursor = "grabbing";
  dom.canvas.setPointerCapture(event.pointerId);
});

dom.canvas.addEventListener("pointerdown", (event) => {
  if (interactionState.mode === "orbit" && event.button === 0) {
    retargetOrbitPivot();
  }
});

dom.canvas.addEventListener("pointermove", (event) => {
  if (interactionState.mode === "fly" && flyState.pointerLocked) {
    const sensitivity = 0.0022;
    flyState.yaw -= event.movementX * sensitivity;
    flyState.pitch = THREE.MathUtils.clamp(
      flyState.pitch - event.movementY * sensitivity,
      -Math.PI / 2 + 0.02,
      Math.PI / 2 - 0.02
    );
    applyFlyLook();
    return;
  }
  if (interactionState.mode !== "grab" || !dragState.active || dragState.pointerId !== event.pointerId) {
    return;
  }
  const deltaX = event.clientX - dragState.lastX;
  const deltaY = event.clientY - dragState.lastY;
  dragState.lastX = event.clientX;
  dragState.lastY = event.clientY;
  moveViewFromDrag(deltaX, deltaY, event.shiftKey);
});

function stopGrab(event) {
  if (dragState.pointerId !== event.pointerId) {
    return;
  }
  dragState.active = false;
  dragState.pointerId = null;
  dom.canvas.style.cursor = interactionState.mode === "grab" ? "grab" : "default";
  if (dom.canvas.hasPointerCapture(event.pointerId)) {
    dom.canvas.releasePointerCapture(event.pointerId);
  }
}

dom.canvas.addEventListener("pointerup", stopGrab);
dom.canvas.addEventListener("pointercancel", stopGrab);

dom.canvas.addEventListener(
  "wheel",
  (event) => {
    if (interactionState.mode !== "fly") {
      return;
    }
    event.preventDefault();
    adjustFlySpeed(event.deltaY);
  },
  { passive: false }
);

document.addEventListener("pointerlockchange", () => {
  flyState.pointerLocked = document.pointerLockElement === dom.canvas;
  if (!flyState.pointerLocked) {
    flyState.activeKeys.clear();
  }
  updateFlyHud();
});

document.addEventListener("keydown", (event) => {
  if (!FLY_KEYS.has(event.code)) {
    return;
  }
  if (interactionState.mode !== "fly") {
    return;
  }
  if (!flyState.pointerLocked && !["ShiftLeft", "ShiftRight"].includes(event.code)) {
    return;
  }
  flyState.activeKeys.add(event.code);
  event.preventDefault();
});

document.addEventListener("keyup", (event) => {
  if (!FLY_KEYS.has(event.code)) {
    return;
  }
  flyState.activeKeys.delete(event.code);
});

window.addEventListener("blur", () => {
  flyState.activeKeys.clear();
});

function handleResize() {
  const { clientWidth, clientHeight } = dom.canvas.parentElement;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
}

window.addEventListener("resize", handleResize);

buildDatasetControls();
handleResize();
setInteractionMode("fly");
setLoadProgress("Preparing viewer...", null, { indeterminate: true });
loadDataset("cw-top");

function animate() {
  const deltaSeconds = Math.min(clock.getDelta(), 0.05);
  updateFlyMovement(deltaSeconds);
  if (interactionState.mode === "orbit") {
    controls.update();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
