const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildProjectorLayers,
  calculateRenderSize,
  detectBlackBars,
  directionMask,
  frameBlendAlpha,
  isThemeAttribute,
  shouldDrawFrame,
  translucentColor
} = require("./content.js");

test("projector layers expand outward and fade like the reference effect", () => {
  assert.deepEqual(buildProjectorLayers(1.18), [
    { scale: 1.06, opacity: 0.46 },
    { scale: 1.12, opacity: 0.3 },
    { scale: 1.18, opacity: 0.14 }
  ]);
});

test("card backgrounds stay readable while showing the ambient layer", () => {
  assert.equal(translucentColor("rgb(33, 33, 33)"), "rgba(33, 33, 33, 0.68)");
});

test("page theme attributes trigger a background refresh", () => {
  assert.equal(isThemeAttribute("class"), true);
  assert.equal(isThemeAttribute("data-theme"), true);
  assert.equal(isThemeAttribute("data-color-mode"), true);
  assert.equal(isThemeAttribute("src"), false);
});

test("render resolution scales from the displayed video size", () => {
  assert.deepEqual(calculateRenderSize({ width: 1280, height: 720 }, 25), { width: 320, height: 180 });
  assert.deepEqual(calculateRenderSize({ width: 1, height: 1 }, 6.25), { width: 2, height: 2 });
});

test("frame limiter keeps video callbacks within the selected rate", () => {
  assert.equal(shouldDrawFrame(1000, 970, 30), false);
  assert.equal(shouldDrawFrame(1004, 970, 30), true);
  assert.equal(shouldDrawFrame(1000, 999, 0), true);
});

test("frame blending maps smoothness to a useful source alpha", () => {
  assert.equal(frameBlendAlpha(false, 80), 1);
  assert.equal(frameBlendAlpha(true, 0), 1);
  assert.equal(frameBlendAlpha(true, 80), 0.36);
  assert.equal(frameBlendAlpha(true, 100), 0.2);
});

test("black bars are detected from consecutive dark edge rows", () => {
  const width = 8;
  const height = 6;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 1; y < 5; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    pixels.set([120, 80, 40, 255], offset);
  }
  assert.deepEqual(detectBlackBars(pixels, width, height, 20, 0.25), {
    top: 1 / 6,
    right: 0,
    bottom: 1 / 6,
    left: 0
  });
});

test("direction mask combines only enabled glow directions", () => {
  assert.equal(directionMask({ top: true, right: true, bottom: true, left: true }), "none");
  assert.deepEqual(directionMask({ top: true, right: false, bottom: false, left: true }), {
    image: "linear-gradient(to bottom, #000 0 50%, transparent 50%), linear-gradient(to right, #000 0 50%, transparent 50%)",
    composite: "add"
  });
});
