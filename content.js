(() => {
  const KEY = "ambientSettings";
  const defaults = { enabled: true, mode: "glow", blur: 34, spread: 1.18, fade: 250, brightness: 100, contrast: 100, saturation: 100 };
  let settings = defaults;
  let video = null;
  let canvas = null;
  let context = null;
  let frameCallback = 0;
  let animationFrame = 0;
  let lastTime = -1;
  let observedVideo = null;
  let filteredVideo = null;
  let originalFilter = "";
  let originalFilterPriority = "";
  let backgroundStyle = null;
  let hadBackgroundClass = false;
  let transparentBackdrops = [];
  let backgroundVideo = null;
  let backgroundViewport = "";
  const backgroundClass = "niconico-ambient-full-background";

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
    observedVideo = nextVideo;
    if (observedVideo) {
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
    draw();
    if (!video.paused) scheduleFrame();
  }

  function onEmptied() {
    lastTime = -1;
    stopFrames();
  }

  function styleCanvas() {
    if (!canvas) return;
    const fullBackground = settings.mode === "full";
    Object.assign(canvas.style, {
      position: fullBackground ? "fixed" : "absolute",
      inset: fullBackground ? "-8vh -8vw" : "0",
      width: fullBackground ? "116vw" : "100%",
      height: fullBackground ? "116vh" : "100%",
      zIndex: fullBackground ? "-1" : "0",
      transform: `scale(${settings.spread})`,
      filter: `blur(${settings.blur * (fullBackground ? 2 : 1)}px) brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`
    });
    canvas.style.transition = `opacity ${settings.fade}ms ease`;
  }

  function restoreBackdrops() {
    for (const { element, color, priority } of transparentBackdrops.reverse()) {
      if (!element.isConnected) continue;
      if (color) element.style.setProperty("background-color", color, priority);
      else element.style.removeProperty("background-color");
    }
    transparentBackdrops = [];
    backgroundVideo = null;
    backgroundViewport = "";
  }

  function clearPageBackdrops(sourceVideo) {
    const viewport = `${window.innerWidth}x${window.innerHeight}`;
    if (backgroundVideo === sourceVideo && backgroundViewport === viewport && transparentBackdrops.every(item => item.element.isConnected)) return;
    restoreBackdrops();
    const viewportArea = window.innerWidth * window.innerHeight;
    // ponytail: clear only large opaque ancestor surfaces; add site-specific selectors if DOM changes require more.
    for (let element = sourceVideo.parentElement; element && element !== document.body; element = element.parentElement) {
      const rect = element.getBoundingClientRect();
      if (rect.width < window.innerWidth * 0.6 || rect.height < window.innerHeight * 0.45 || rect.width * rect.height < viewportArea * 0.3) continue;
      const color = getComputedStyle(element).backgroundColor;
      if (color === "transparent" || /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color)) continue;
      transparentBackdrops.push({
        element,
        color: element.style.getPropertyValue("background-color"),
        priority: element.style.getPropertyPriority("background-color")
      });
      element.style.setProperty("background-color", "transparent", "important");
    }
    backgroundVideo = sourceVideo;
    backgroundViewport = viewport;
  }

  function setFullBackground(enabled, sourceVideo = null) {
    if (enabled) {
      if (!backgroundStyle) {
        hadBackgroundClass = document.documentElement.classList.contains(backgroundClass);
        document.documentElement.classList.add(backgroundClass);
        backgroundStyle = document.createElement("style");
        backgroundStyle.textContent = `html.${backgroundClass}, html.${backgroundClass} body { background: transparent !important; }`;
        document.head.append(backgroundStyle);
      }
      if (sourceVideo) clearPageBackdrops(sourceVideo);
    } else if (backgroundStyle) {
      restoreBackdrops();
      backgroundStyle.remove();
      backgroundStyle = null;
      if (!hadBackgroundClass) document.documentElement.classList.remove(backgroundClass);
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
    if (!settings.enabled || !nextVideo || (settings.mode !== "full" && !inner)) {
      removeLayer();
      video = nextVideo;
      return;
    }
    const host = settings.mode === "full" ? document.documentElement : inner;
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
    styleCanvas();
    requestAnimationFrame(() => {
      if (canvas?.isConnected) canvas.style.opacity = settings.mode === "full" ? "0.55" : "0.9";
    });
    draw();
    if (!video.paused) scheduleFrame();
  }

  function refresh() {
    mount(getTargets());
  }

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
    if (records.some(record => {
      if (record.type === "attributes") {
        return record.target.matches?.("video") || record.target.querySelector?.("video");
      }
      return [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node.matches?.('video[data-name="video-content"], [data-name="inner"]') ||
          node.querySelector?.('video[data-name="video-content"], [data-name="inner"]'))
      );
    })) refresh();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "data-name"]
  });
})();
