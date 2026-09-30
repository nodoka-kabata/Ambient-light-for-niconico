(() => {
  const KEY = "ambientSettings";
  const defaults = { enabled: true, mode: "glow", blur: 34, spread: 1.18, fade: 250, brightness: 100, contrast: 100, saturation: 100, backgroundBrightness: 65, backgroundStrength: 35 };
  let settings = defaults;
  let video = null;
  let canvas = null;
  let context = null;
  let frameCallback = 0;
  let animationFrame = 0;
  let lastTime = -1;
  let observedVideo = null;
  const resizeObserver = new ResizeObserver(resizeCanvas);
  let filteredVideo = null;
  let originalFilter = "";
  let originalFilterPriority = "";
  let pageBackgroundStyles = [];
  let transparentBackdrops = [];
  let textShadowStyles = [];
  let shadowedText = new WeakSet();
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
    canvas?.remove();
    canvas = context = null;
    setFullBackground(false);
  }

  function draw() {
    if (!video || !context || !canvas || video.readyState < 2) return;
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch {
        // The player may replace or unload its media while a frame is in flight.
      }
    }
  }

  function scheduleFrame() {
    if (!video || !canvas || !settings.enabled || video.paused || frameCallback || animationFrame) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      frameCallback = video.requestVideoFrameCallback(() => {
        frameCallback = 0;
        draw();
        scheduleFrame();
      });
    } else {
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        draw();
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
    styleCanvas();
    draw();
    if (!video.paused) scheduleFrame();
  }

  function onEmptied() {
    lastTime = -1;
    stopFrames();
    if (canvas) canvas.style.opacity = "0";
  }

  function styleCanvas() {
    if (!canvas) return;
    const fullBackground = settings.mode === "full";
    const bounds = video.getBoundingClientRect();
    const ratio = (video.videoWidth || bounds.width) / (video.videoHeight || bounds.height) || 16 / 9;
    const width = Math.max(window.innerWidth, window.innerHeight * ratio) * 1.16;
    const height = width / ratio;
    Object.assign(canvas.style, {
      position: fullBackground ? "fixed" : "absolute",
      inset: fullBackground ? "auto" : "0",
      left: fullBackground ? "50%" : "auto",
      top: fullBackground ? "50%" : "auto",
      width: fullBackground ? `${width}px` : "100%",
      height: fullBackground ? `${height}px` : "100%",
      zIndex: fullBackground ? "-1" : "0",
      transform: `${fullBackground ? "translate(-50%, -50%) " : ""}scale(${settings.spread})`,
      opacity: fullBackground ? `${settings.backgroundStrength * 0.6 / 100}` : "0.9",
      filter: `blur(${settings.blur * (fullBackground ? 0.75 : 1)}px) ${fullBackground ? `brightness(${settings.backgroundBrightness}%) ` : ""}brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`
    });
    canvas.style.transition = `opacity ${settings.fade}ms ease`;
  }

  function resizeCanvas() {
    if (!canvas || !video) return;
    const bounds = video.getBoundingClientRect();
    const width = Math.max(2, Math.round(bounds.width / 12));
    const height = Math.max(2, Math.round(bounds.height / 12));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      lastTime = -1;
      draw();
    }
    styleCanvas();
  }

  function restoreBackdrops() {
    for (const { element, value, priority } of textShadowStyles.reverse()) {
      if (value) element.style.setProperty("text-shadow", value, priority);
      else element.style.removeProperty("text-shadow");
    }
    textShadowStyles = [];
    shadowedText = new WeakSet();
    for (const { element, color, colorPriority, image, imagePriority } of transparentBackdrops.reverse()) {
      if (!element.isConnected) continue;
      if (color) element.style.setProperty("background-color", color, colorPriority);
      else element.style.removeProperty("background-color");
      if (image) element.style.setProperty("background-image", image, imagePriority);
      else element.style.removeProperty("background-image");
    }
    transparentBackdrops = [];
    backgroundVideo = null;
    backgroundViewport = "";
    backgroundChain = [];
  }

  function applyContrastingTextShadows(sourceVideo) {
    const player = document.querySelector('[data-name="inner"]');
    const candidates = new Set();
    const videoBounds = sourceVideo.getBoundingClientRect();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      const element = text.parentElement;
      if (!text.textContent.trim() || !element) continue;
      if (element === player || player?.contains(element) || element === sourceVideo) continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.right <= 0 || bounds.left >= document.documentElement.clientWidth) continue;
      if (bounds.bottom <= videoBounds.bottom || bounds.top > videoBounds.bottom + videoBounds.height) continue;
      candidates.add(element);
    }
    for (const element of candidates) {
      if (shadowedText.has(element)) continue;
      const match = getComputedStyle(element).color.match(/[\d.]+/g);
      if (!match || match.length < 3) continue;
      const [r, g, b] = match.slice(0, 3).map(Number);
      const opposite = `rgba(${255 - r}, ${255 - g}, ${255 - b}, 0.95)`;
      textShadowStyles.push({
        element,
        value: element.style.getPropertyValue("text-shadow"),
        priority: element.style.getPropertyPriority("text-shadow")
      });
      element.style.setProperty("text-shadow", `0 1px 2px ${opposite}, 0 0 1px ${opposite}`, "important");
      shadowedText.add(element);
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
      applyContrastingTextShadows(sourceVideo);
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
    applyContrastingTextShadows(sourceVideo);
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
    if (video === nextVideo && canvas?.parentElement === host) {
      setFullBackground(settings.mode === "full", nextVideo);
      styleCanvas();
      return;
    }

    removeLayer();
    setFullBackground(settings.mode === "full", nextVideo);
    video = nextVideo;
    canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      objectFit: "fill",
      transform: `scale(${settings.spread})`,
      transformOrigin: "center",
      filter: `blur(${settings.blur}px)`,
      opacity: "0",
      pointerEvents: "none",
      zIndex: "0",
      transition: `opacity ${settings.fade}ms ease`
    });
    const bounds = video.getBoundingClientRect();
    canvas.width = Math.max(2, Math.round(bounds.width / 12));
    canvas.height = Math.max(2, Math.round(bounds.height / 12));
    context = canvas.getContext("2d", { alpha: false });
    host.insertBefore(canvas, host.firstChild);
    lastTime = -1;
    styleCanvas();
    canvas.style.opacity = "0";
    const mountedCanvas = canvas;
    requestAnimationFrame(() => {
      if (canvas === mountedCanvas) {
        canvas.style.opacity = settings.mode === "full" ? `${settings.backgroundStrength * 0.6 / 100}` : "0.9";
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
    settings = { ...defaults, ...(changes[KEY].newValue || {}) };
    refresh();
  });

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
    else if (settings.enabled && settings.mode === "full" && records.some(isTextAreaMutation)) applyContrastingTextShadows(video);
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
    attributeFilter: ["src", "data-name"]
  });
})();
