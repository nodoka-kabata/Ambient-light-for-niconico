function buildProjectorLayers(spread) {
  const distance = Math.max(0, spread - 1);
  return [
    { scale: 1 + distance / 3, opacity: 0.46 },
    { scale: 1 + distance * 2 / 3, opacity: 0.3 },
    { scale: 1 + distance, opacity: 0.14 }
  ].map(layer => ({
    scale: Math.round(layer.scale * 100) / 100,
    opacity: layer.opacity
  }));
}

function translucentColor(color, opacity = 0.68) {
  const channels = color.match(/[\d.]+/g);
  if (!channels || channels.length < 3) return null;
  return `rgba(${channels.slice(0, 3).map(Number).join(", ")}, ${opacity})`;
}

const themeAttributes = ["class", "data-theme", "data-color-mode"];
const isThemeAttribute = name => themeAttributes.includes(name);

function calculateRenderSize(bounds, resolution) {
  return {
    width: Math.max(2, Math.round(bounds.width * resolution / 100)),
    height: Math.max(2, Math.round(bounds.height * resolution / 100))
  };
}

const shouldDrawFrame = (now, lastDrawAt, limit) => !limit || now - lastDrawAt >= 1000 / limit;
const frameBlendAlpha = (enabled, smoothness) => enabled ? Math.round((1 - smoothness * 0.008) * 100) / 100 : 1;

function detectBlackBars(pixels, width, height, threshold = 20, maxCrop = 0.25) {
  const dark = (x, y) => {
    const offset = (y * width + x) * 4;
    return (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3 <= threshold;
  };
  const darkRow = y => {
    let count = 0;
    for (let x = 0; x < width; x++) count += dark(x, y);
    return count / width >= 0.9;
  };
  const darkColumn = x => {
    let count = 0;
    for (let y = 0; y < height; y++) count += dark(x, y);
    return count / height >= 0.9;
  };
  const scan = (length, fromStart, predicate) => {
    const limit = Math.floor(length * maxCrop);
    let count = 0;
    while (count < limit && predicate(fromStart ? count : length - 1 - count)) count++;
    return count / length;
  };
  return {
    top: scan(height, true, darkRow),
    right: scan(width, false, darkColumn),
    bottom: scan(height, false, darkRow),
    left: scan(width, true, darkColumn)
  };
}

function directionMask({ top, right, bottom, left }) {
  if (top && right && bottom && left) return "none";
  const gradients = [
    top && "linear-gradient(to bottom, #000 0 50%, transparent 50%)",
    right && "linear-gradient(to left, #000 0 50%, transparent 50%)",
    bottom && "linear-gradient(to top, #000 0 50%, transparent 50%)",
    left && "linear-gradient(to right, #000 0 50%, transparent 50%)"
  ].filter(Boolean);
  return { image: gradients.length ? gradients.join(", ") : "linear-gradient(transparent, transparent)", composite: "add" };
}

function createWebGLRenderer(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    desynchronized: true,
    failIfMajorPerformanceCaveat: true,
    preserveDrawingBuffer: true
  });
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, `
    attribute vec2 position;
    attribute vec2 uv;
    uniform vec4 crop;
    varying vec2 textureUv;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
      textureUv = vec2(mix(crop.x, 1.0 - crop.z, uv.x), mix(crop.w, 1.0 - crop.y, uv.y));
    }
  `));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D frame;
    uniform float alpha;
    varying vec2 textureUv;
    void main() {
      vec4 color = texture2D(frame, textureUv);
      gl_FragColor = vec4(color.rgb, alpha);
    }
  `));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1,
    -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1
  ]), gl.STATIC_DRAW);
  for (const [name, offset] of [["position", 0], ["uv", 2]]) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset * 4);
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const cropLocation = gl.getUniformLocation(program, "crop");
  const alphaLocation = gl.getUniformLocation(program, "alpha");
  return {
    draw(source, crop, alpha) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform4f(cropLocation, crop.left, crop.top, crop.right, crop.bottom);
      gl.uniform1f(alphaLocation, alpha);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  };
}

if (typeof module !== "undefined") module.exports = { buildProjectorLayers, calculateRenderSize, detectBlackBars, directionMask, frameBlendAlpha, isThemeAttribute, shouldDrawFrame, translucentColor };

if (typeof chrome !== "undefined" && typeof document !== "undefined") (() => {
  const KEY = "ambientSettings";
  const defaults = { enabled: true, mode: "glow", webGL: true, detectBlackBars: true, directionTop: true, directionRight: true, directionBottom: true, directionLeft: true, resolution: 25, framerateLimit: 60, frameBlending: false, frameBlendingSmoothness: 80, blur: 34, spread: 1.18, fade: 250, brightness: 100, contrast: 100, saturation: 100, backgroundBrightness: 65, backgroundStrength: 35 };
  let settings = defaults;
  let video = null;
  let canvas = null;
  let projectors = [];
  let renderer = null;
  let mountedWebGL = null;
  let webGLFailed = false;
  let crop = { top: 0, right: 0, bottom: 0, left: 0 };
  let lastBarScan = -Infinity;
  const barCanvas = document.createElement("canvas");
  barCanvas.width = 64;
  barCanvas.height = 36;
  const barContext = barCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  let frameCallback = 0;
  let animationFrame = 0;
  let lastTime = -1;
  let lastDrawAt = -Infinity;
  let observedVideo = null;
  const resizeObserver = new ResizeObserver(resizeCanvas);
  let filteredVideo = null;
  let originalFilter = "";
  let originalFilterPriority = "";
  let pageBackgroundStyles = [];
  let transparentBackdrops = [];
  let softenedBackdrops = new WeakSet();
  let softenedColors = new WeakMap();
  let backgroundVideo = null;
  let backgroundViewport = "";
  let backgroundChain = [];

  const getTargets = () => ({
    video: document.querySelector('video[data-name="video-content"]'),
    inner: document.querySelector('[data-name="inner"]')
  });

  function stopFrames() {
    if (video && frameCallback && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(frameCallback);
    }
    cancelAnimationFrame(animationFrame);
    frameCallback = animationFrame = 0;
  }

  function removeLayer() {
    stopFrames();
    for (const projector of projectors) projector.canvas.remove();
    projectors = [];
    renderer = null;
    mountedWebGL = null;
    canvas = null;
    setFullBackground(false);
  }

  function updateCrop(now) {
    if (!settings.detectBlackBars) {
      crop = { top: 0, right: 0, bottom: 0, left: 0 };
      return;
    }
    if (now - lastBarScan < 750) return;
    lastBarScan = now;
    try {
      barContext.drawImage(video, 0, 0, barCanvas.width, barCanvas.height);
      crop = detectBlackBars(barContext.getImageData(0, 0, barCanvas.width, barCanvas.height).data, barCanvas.width, barCanvas.height);
    } catch {
      crop = { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  function draw(now = performance.now()) {
    if (!video || !projectors.length || video.readyState < 2) return;
    if (!shouldDrawFrame(now, lastDrawAt, settings.framerateLimit)) return;
    if (video.currentTime !== lastTime) {
      const firstFrame = lastTime < 0;
      lastTime = video.currentTime;
      lastDrawAt = now;
      updateCrop(now);
      try {
        if (renderer) {
          renderer.draw(video, crop, firstFrame ? 1 : frameBlendAlpha(settings.frameBlending, settings.frameBlendingSmoothness));
          for (const projector of projectors.slice(1)) {
            projector.context.globalAlpha = 1;
            projector.context.drawImage(canvas, 0, 0, projector.canvas.width, projector.canvas.height);
          }
        } else for (const projector of projectors) {
          projector.context.globalAlpha = firstFrame ? 1 : frameBlendAlpha(settings.frameBlending, settings.frameBlendingSmoothness);
          const sourceWidth = video.videoWidth;
          const sourceHeight = video.videoHeight;
          projector.context.drawImage(
            video,
            sourceWidth * crop.left,
            sourceHeight * crop.top,
            sourceWidth * (1 - crop.left - crop.right),
            sourceHeight * (1 - crop.top - crop.bottom),
            0, 0, projector.canvas.width, projector.canvas.height
          );
        }
      } catch {
        // The player may replace or unload its media while a frame is in flight.
      }
    }
  }

  function scheduleFrame() {
    if (!video || !canvas || !settings.enabled || video.paused || frameCallback || animationFrame) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      frameCallback = video.requestVideoFrameCallback(now => {
        frameCallback = 0;
        draw(now);
        scheduleFrame();
      });
    } else {
      animationFrame = requestAnimationFrame(now => {
        animationFrame = 0;
        draw(now);
        if (!video.paused) scheduleFrame();
      });
    }
  }

  function observeVideo(nextVideo) {
    if (observedVideo === nextVideo) return;
    if (observedVideo) {
      observedVideo.removeEventListener("play", scheduleFrame);
      observedVideo.removeEventListener("pause", onPause);
      observedVideo.removeEventListener("loadeddata", onLoaded);
      observedVideo.removeEventListener("emptied", onEmptied);
    }
    resizeObserver.disconnect();
    observedVideo = nextVideo;
    if (observedVideo) {
      resizeObserver.observe(observedVideo);
      observedVideo.addEventListener("play", scheduleFrame);
      observedVideo.addEventListener("pause", onPause);
      observedVideo.addEventListener("loadeddata", onLoaded);
      observedVideo.addEventListener("emptied", onEmptied);
    }
  }

  function onPause() {
    stopFrames();
    draw();
  }

  function onLoaded() {
    lastTime = -1;
    lastDrawAt = -Infinity;
    lastBarScan = -Infinity;
    styleCanvas();
    draw();
    if (!video.paused) scheduleFrame();
  }

  function onEmptied() {
    lastTime = -1;
    lastDrawAt = -Infinity;
    stopFrames();
    for (const projector of projectors) projector.canvas.style.opacity = "0";
  }

  function styleCanvas() {
    if (!canvas) return;
    const fullBackground = settings.mode === "full";
    const bounds = video.getBoundingClientRect();
    const ratio = (video.videoWidth || bounds.width) / (video.videoHeight || bounds.height) || 16 / 9;
    const width = Math.max(window.innerWidth, window.innerHeight * ratio) * 1.16;
    const height = width / ratio;
    const layers = buildProjectorLayers(settings.spread);
    const mask = directionMask({ top: settings.directionTop, right: settings.directionRight, bottom: settings.directionBottom, left: settings.directionLeft });
    for (let index = 0; index < projectors.length; index++) {
      const projector = projectors[index];
      const layer = layers[index];
      Object.assign(projector.canvas.style, {
        position: fullBackground ? "fixed" : "absolute",
        inset: fullBackground ? "auto" : "0",
        left: fullBackground ? "50%" : "auto",
        top: fullBackground ? "50%" : "auto",
        width: fullBackground ? `${width}px` : "100%",
        height: fullBackground ? `${height}px` : "100%",
        zIndex: fullBackground ? "-1" : "0",
        transform: `${fullBackground ? "translate(-50%, -50%) " : ""}scale(${layer.scale})`,
        opacity: `${layer.opacity * (fullBackground ? settings.backgroundStrength * 0.6 / 100 : 1)}`,
        filter: `blur(${settings.blur * (fullBackground ? 0.75 : 1)}px) ${fullBackground ? `brightness(${settings.backgroundBrightness}%) ` : ""}brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`,
        transition: `opacity ${settings.fade}ms ease`,
        webkitMaskImage: mask === "none" ? "none" : mask.image,
        maskImage: mask === "none" ? "none" : mask.image,
        webkitMaskComposite: mask === "none" ? "initial" : mask.composite,
        maskComposite: mask === "none" ? "initial" : mask.composite
      });
    }
  }

  function resizeCanvas() {
    if (!canvas || !video) return;
    const bounds = video.getBoundingClientRect();
    const { width, height } = calculateRenderSize(bounds, settings.resolution);
    if (canvas.width !== width || canvas.height !== height) {
      for (const projector of projectors) {
        projector.canvas.width = width;
        projector.canvas.height = height;
      }
      lastTime = -1;
      draw();
    }
    styleCanvas();
  }

  function restoreBackdrops() {
    for (const { element, color, colorPriority, image, imagePriority } of transparentBackdrops.reverse()) {
      if (!element.isConnected) continue;
      if (color) element.style.setProperty("background-color", color, colorPriority);
      else element.style.removeProperty("background-color");
      if (image) element.style.setProperty("background-image", image, imagePriority);
      else element.style.removeProperty("background-image");
    }
    transparentBackdrops = [];
    softenedBackdrops = new WeakSet();
    softenedColors = new WeakMap();
    backgroundVideo = null;
    backgroundViewport = "";
    backgroundChain = [];
  }

  function softenPageCards(sourceVideo) {
    const player = document.querySelector('[data-name="inner"]');
    for (const element of document.body.querySelectorAll("*")) {
      if (softenedBackdrops.has(element) || element === player || player?.contains(element)) continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.width < 240 || bounds.height < 40) continue;
      const style = getComputedStyle(element);
      const color = translucentColor(style.backgroundColor);
      const alpha = Number(style.backgroundColor.match(/[\d.]+/g)?.[3] ?? 1);
      if (!color || alpha < 0.95) continue;
      let sameColorAncestor = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (softenedColors.get(parent) === style.backgroundColor) {
          sameColorAncestor = true;
          break;
        }
      }
      transparentBackdrops.push({
        element,
        color: element.style.getPropertyValue("background-color"),
        colorPriority: element.style.getPropertyPriority("background-color"),
        image: element.style.getPropertyValue("background-image"),
        imagePriority: element.style.getPropertyPriority("background-image")
      });
      element.style.setProperty("background-color", sameColorAncestor ? "transparent" : color, "important");
      softenedBackdrops.add(element);
      softenedColors.set(element, style.backgroundColor);
    }
  }

  function saveInlineStyles(element, properties) {
    return {
      element,
      properties: properties.map(property => ({
        property,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property)
      }))
    };
  }

  function restoreInlineStyles(saved) {
    for (const { property, value, priority } of saved.properties) {
      if (value) saved.element.style.setProperty(property, value, priority);
      else saved.element.style.removeProperty(property);
    }
  }

  function clearPageBackdrops(sourceVideo) {
    const viewport = `${window.innerWidth}x${window.innerHeight}`;
    const chain = [];
    for (let element = sourceVideo.parentElement; element && element !== document.body; element = element.parentElement) chain.push(element);
    if (backgroundVideo === sourceVideo && backgroundViewport === viewport && chain.length === backgroundChain.length && chain.every((element, index) => element === backgroundChain[index])) {
      softenPageCards(sourceVideo);
      return;
    }
    restoreBackdrops();
    for (const element of chain) {
      const style = getComputedStyle(element);
      const color = style.backgroundColor;
      const hasColor = color !== "transparent" && !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color);
      const hasImage = style.backgroundImage !== "none";
      if (!hasColor && !hasImage) continue;
      transparentBackdrops.push({
        element,
        color: element.style.getPropertyValue("background-color"),
        colorPriority: element.style.getPropertyPriority("background-color"),
        image: element.style.getPropertyValue("background-image"),
        imagePriority: element.style.getPropertyPriority("background-image")
      });
      if (hasColor) element.style.setProperty("background-color", "transparent", "important");
      if (hasImage) element.style.setProperty("background-image", "none", "important");
    }
    softenPageCards(sourceVideo);
    backgroundVideo = sourceVideo;
    backgroundViewport = viewport;
    backgroundChain = chain;
  }

  function setFullBackground(enabled, sourceVideo = null) {
    if (enabled) {
      if (!pageBackgroundStyles.length) {
        pageBackgroundStyles = [
          saveInlineStyles(document.documentElement, ["background-color", "background-image"]),
          saveInlineStyles(document.body, ["background-color", "background-image", "isolation"])
        ];
        for (const root of [document.documentElement, document.body]) {
          root.style.setProperty("background-color", root === document.documentElement ? "#101010" : "transparent", "important");
          root.style.setProperty("background-image", "none", "important");
        }
        document.body.style.setProperty("isolation", "isolate", "important");
      }
      if (sourceVideo) clearPageBackdrops(sourceVideo);
    } else if (pageBackgroundStyles.length) {
      restoreBackdrops();
      for (const saved of pageBackgroundStyles.reverse()) restoreInlineStyles(saved);
      pageBackgroundStyles = [];
    }
  }

  function restoreVideoFilter() {
    if (!filteredVideo) return;
    if (originalFilter) filteredVideo.style.setProperty("filter", originalFilter, originalFilterPriority);
    else filteredVideo.style.removeProperty("filter");
    filteredVideo = null;
  }

  function applyVideoFilter(nextVideo) {
    const neutral = settings.brightness === 100 && settings.contrast === 100 && settings.saturation === 100;
    if (!settings.enabled || !nextVideo || neutral) {
      restoreVideoFilter();
      return;
    }
    if (filteredVideo !== nextVideo) {
      restoreVideoFilter();
      filteredVideo = nextVideo;
      originalFilter = nextVideo.style.getPropertyValue("filter");
      originalFilterPriority = nextVideo.style.getPropertyPriority("filter");
    }
    nextVideo.style.setProperty(
      "filter",
      `brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`,
      "important"
    );
  }

  function mount(targets) {
    const { video: nextVideo, inner } = targets;
    observeVideo(nextVideo);
    applyVideoFilter(nextVideo);
    if (!settings.enabled || !nextVideo || (settings.mode === "full" ? !document.body : !inner)) {
      removeLayer();
      video = nextVideo;
      return;
    }
    const host = settings.mode === "full" ? document.body : inner;
    if (video === nextVideo && canvas?.parentElement === host && mountedWebGL === settings.webGL) {
      setFullBackground(settings.mode === "full", nextVideo);
      resizeCanvas();
      return;
    }

    removeLayer();
    setFullBackground(settings.mode === "full", nextVideo);
    video = nextVideo;
    const bounds = video.getBoundingClientRect();
    for (const [index] of buildProjectorLayers(settings.spread).entries()) {
      const layerCanvas = document.createElement("canvas");
      layerCanvas.setAttribute("aria-hidden", "true");
      const size = calculateRenderSize(bounds, settings.resolution);
      layerCanvas.width = size.width;
      layerCanvas.height = size.height;
      Object.assign(layerCanvas.style, {
        transformOrigin: "center",
        opacity: "0",
        pointerEvents: "none"
      });
      let webGLRenderer = null;
      if (index === 0 && settings.webGL && !webGLFailed) {
        try {
          webGLRenderer = createWebGLRenderer(layerCanvas);
        } catch {
          webGLFailed = true;
        }
      }
      if (webGLRenderer) renderer = webGLRenderer;
      if (webGLRenderer) layerCanvas.addEventListener("webglcontextlost", event => {
        event.preventDefault();
        webGLFailed = true;
        removeLayer();
        requestAnimationFrame(refresh);
      }, { once: true });
      projectors.push({ canvas: layerCanvas, context: webGLRenderer ? null : layerCanvas.getContext("2d", { alpha: false }) });
      host.insertBefore(layerCanvas, host.firstChild);
    }
    mountedWebGL = settings.webGL;
    canvas = projectors[0].canvas;
    lastTime = -1;
    lastDrawAt = -Infinity;
    styleCanvas();
    for (const projector of projectors) projector.canvas.style.opacity = "0";
    const mountedCanvas = canvas;
    requestAnimationFrame(() => {
      if (canvas === mountedCanvas) {
        styleCanvas();
      }
    });
    draw();
    if (!video.paused) scheduleFrame();
  }

  function refresh() {
    mount(getTargets());
  }

  function isTextAreaMutation(record) {
    if (!video) return false;
    const target = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
    const player = document.querySelector('[data-name="inner"]');
    if (!target || player?.contains(target)) return false;
    const text = target.getBoundingClientRect();
    const bounds = video.getBoundingClientRect();
    return text.right > 0 && text.left < document.documentElement.clientWidth && text.bottom > bounds.bottom && text.top <= bounds.bottom + bounds.height;
  }

  window.addEventListener("resize", resizeCanvas);

  chrome.storage.sync.get(KEY, result => {
    settings = { ...defaults, ...(result[KEY] || {}) };
    refresh();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[KEY]) return;
    const retryWebGL = !settings.webGL && changes[KEY].newValue?.webGL;
    settings = { ...defaults, ...(changes[KEY].newValue || {}) };
    if (retryWebGL) webGLFailed = false;
    refresh();
  });

  const themeObserver = new MutationObserver(() => {
    if (settings.enabled && settings.mode === "full") {
      setFullBackground(false);
      refresh();
    }
  });
  for (const root of [document.documentElement, document.body]) {
    themeObserver.observe(root, { attributes: true, attributeFilter: themeAttributes });
  }

  const observer = new MutationObserver(records => {
    const needsRefresh = records.some(record => {
      if (record.type === "attributes") {
        return record.target.matches?.("video") || record.target.querySelector?.("video");
      }
      return [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node.matches?.('video[data-name="video-content"], [data-name="inner"]') ||
          node.querySelector?.('video[data-name="video-content"], [data-name="inner"]'))
      );
    });
    if (needsRefresh) refresh();
    else if (settings.enabled && settings.mode === "full" && records.some(isTextAreaMutation)) softenPageCards(video);
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
    attributeFilter: ["src", "data-name"]
  });
})();
