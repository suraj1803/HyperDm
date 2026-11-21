(() => {
  const PILL_ID = "hyperdm-yt-download-pill";
  const IDLE_HIDE_MS = 2400;
  let lastUrl = "";
  let cleanupHoverListeners = null;

  function isVideoPage(href) {
    try {
      const u = new URL(href);
      return (
        (u.pathname === "/watch" && u.searchParams.has("v")) ||
        u.pathname.startsWith("/shorts/")
      );
    } catch {
      return false;
    }
  }

  function removePill() {
    if (cleanupHoverListeners) {
      cleanupHoverListeners();
      cleanupHoverListeners = null;
    }
    const existing = document.getElementById(PILL_ID);
    if (existing) existing.remove();
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  function createIcon(kind) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.style.display = "block";
    svg.style.pointerEvents = "none";

    const addPath = (d) => {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
      return p;
    };

    if (kind === "loading") {
      const p = addPath("M12 3a9 9 0 1 0 9 9");
      const anim = document.createElementNS(SVG_NS, "animateTransform");
      anim.setAttribute("attributeName", "transform");
      anim.setAttribute("type", "rotate");
      anim.setAttribute("from", "0 12 12");
      anim.setAttribute("to", "360 12 12");
      anim.setAttribute("dur", "0.8s");
      anim.setAttribute("repeatCount", "indefinite");
      p.appendChild(anim);
    } else if (kind === "success") {
      addPath("M5 13l4 4L19 7");
    } else if (kind === "error") {
      addPath("M18 6 6 18");
      addPath("m6 6 12 12");
    } else {
      addPath("M12 3v12");
      addPath("m7 10 5 5 5-5");
      addPath("M5 20h14");
    }

    return svg;
  }

  function createPill(player) {
    const btn = document.createElement("button");
    btn.id = PILL_ID;
    btn.type = "button";
    btn.title = "Download with HyperDM";
    btn.setAttribute("aria-label", "Download with HyperDM");

    let state = "idle";
    let visible = false;
    let resetTimer = null;
    let idleTimer = null;

    const setIcon = (kind) => {
      btn.replaceChildren(createIcon(kind));
    };

    const applyVisualState = (hovered = false) => {
      const shouldShow = visible || state !== "idle";
      btn.style.pointerEvents = shouldShow ? "auto" : "none";

      if (state === "success") {
        btn.style.background = "rgba(22, 163, 74, 0.92)";
        btn.style.color = "#ffffff";
        btn.style.borderColor = "rgba(134, 239, 172, 0.55)";
        btn.style.opacity = "1";
      } else if (state === "error") {
        btn.style.background = "rgba(220, 38, 38, 0.92)";
        btn.style.color = "#ffffff";
        btn.style.borderColor = "rgba(252, 165, 165, 0.55)";
        btn.style.opacity = "1";
      } else if (state === "loading" || hovered) {
        btn.style.background = "#0842a0";
        btn.style.color = "#ffffff";
        btn.style.borderColor = "rgba(168, 199, 250, 0.55)";
        btn.style.opacity = shouldShow ? "1" : "0";
      } else {
        btn.style.background = "rgba(17, 19, 24, 0.78)";
        btn.style.color = "#d3e3fd";
        btn.style.borderColor = "rgba(168, 199, 250, 0.35)";
        btn.style.opacity = shouldShow ? "0.86" : "0";
      }

      if (!shouldShow) {
        btn.style.transform = "translateY(-4px) scale(0.94)";
      } else if (hovered) {
        btn.style.transform = "translateY(0) scale(1.06)";
      } else {
        btn.style.transform = "translateY(0) scale(1)";
      }
    };

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const hideOverlay = () => {
      clearIdleTimer();
      if (state !== "idle" || btn.matches(":hover")) return;
      visible = false;
      applyVisualState(false);
    };

    const scheduleIdleHide = () => {
      clearIdleTimer();
      idleTimer = setTimeout(hideOverlay, IDLE_HIDE_MS);
    };

    const showOverlay = () => {
      visible = true;
      applyVisualState(btn.matches(":hover"));
      if (!btn.matches(":hover") && state === "idle") {
        scheduleIdleHide();
      } else {
        clearIdleTimer();
      }
    };

    const isShorts = window.location.pathname.startsWith("/shorts/");

    setIcon("download");
    Object.assign(btn.style, {
      position: "absolute",
      top: isShorts ? "72px" : "58px",
      right: "14px",
      transform: "translateY(-4px) scale(0.94)",
      zIndex: "2147483647",
      width: "36px",
      height: "36px",
      padding: "0",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "50%",
      border: "1px solid rgba(168, 199, 250, 0.35)",
      background: "rgba(17, 19, 24, 0.78)",
      color: "#d3e3fd",
      cursor: "pointer",
      pointerEvents: "none",
      boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
      backdropFilter: "blur(8px)",
      transition: "transform 160ms ease, background 140ms ease, opacity 180ms ease, border-color 140ms ease",
      opacity: "0",
    });

    btn.addEventListener("mouseenter", () => {
      clearIdleTimer();
      visible = true;
      applyVisualState(true);
    });

    btn.addEventListener("mouseleave", () => {
      applyVisualState(false);
      if (state === "idle") {
        scheduleIdleHide();
      }
    });

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearIdleTimer();
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }

      state = "loading";
      visible = true;
      btn.title = "Opening HyperDM…";
      setIcon("loading");
      applyVisualState(true);

      try {
        const res = await chrome.runtime.sendMessage({
          type: "openYouTube",
          url: window.location.href,
        });
        if (res && res.ok) {
          state = "success";
          btn.title = "Sent to HyperDM";
          setIcon("success");
        } else {
          state = "error";
          btn.title = "HyperDM Offline";
          setIcon("error");
        }
      } catch {
        state = "error";
        btn.title = "HyperDM Offline";
        setIcon("error");
      }
      applyVisualState(false);

      resetTimer = setTimeout(() => {
        state = "idle";
        btn.title = "Download with HyperDM";
        setIcon("download");
        const isHovered = btn.matches(":hover");
        visible = isHovered || player.matches(":hover");
        applyVisualState(isHovered);
        if (visible && !isHovered) {
          scheduleIdleHide();
        }
        resetTimer = null;
      }, 2200);
    });

    const onPlayerMouseMove = () => showOverlay();
    const onPlayerMouseEnter = () => showOverlay();
    const onPlayerMouseLeave = () => hideOverlay();

    player.addEventListener("mousemove", onPlayerMouseMove, { passive: true });
    player.addEventListener("mouseenter", onPlayerMouseEnter, { passive: true });
    player.addEventListener("mouseleave", onPlayerMouseLeave, { passive: true });

    cleanupHoverListeners = () => {
      clearIdleTimer();
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      player.removeEventListener("mousemove", onPlayerMouseMove);
      player.removeEventListener("mouseenter", onPlayerMouseEnter);
      player.removeEventListener("mouseleave", onPlayerMouseLeave);
    };

    if (player.matches(":hover")) {
      showOverlay();
    }

    return btn;
  }

  function isVisibleElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 50 && rect.height > 50;
  }

  function findPlayerContainer(href) {
    let isShorts = false;
    try {
      isShorts = new URL(href).pathname.startsWith("/shorts/");
    } catch {
      return null;
    }

    if (isShorts) {
      const candidates = [
        document.querySelector("ytd-reel-video-renderer[is-active] #shorts-player"),
        document.querySelector("ytd-reel-video-renderer[is-active] #player-container"),
        document.querySelector("ytd-reel-video-renderer[is-active] #player"),
        document.querySelector("ytd-reel-video-renderer[is-active] .player-container"),
        document.querySelector("ytd-shorts #shorts-player"),
        document.querySelector("#shorts-player"),
        document.querySelector("ytd-reel-video-renderer[is-active]"),
      ];
      return candidates.find(isVisibleElement) || null;
    }

    const candidates = [
      document.querySelector("ytd-watch-flexy #movie_player"),
      document.getElementById("movie_player"),
      document.querySelector("ytd-watch-flexy #player-container"),
      document.querySelector("#player-container"),
    ];
    return candidates.find(isVisibleElement) || null;
  }

  async function mountIfNeeded() {
    const href = window.location.href;
    if (!isVideoPage(href)) {
      removePill();
      return;
    }

    // Only show when HyperDM desktop app is running and bridge is enabled
    let health = null;
    try {
      health = await chrome.runtime.sendMessage({ type: "checkHealth" });
    } catch {
      return;
    }
    if (!health || !health.online || !health.bridgeEnabled) {
      removePill();
      return;
    }

    const player = findPlayerContainer(href);
    if (!player) return;

    const existing = document.getElementById(PILL_ID);
    if (existing && existing.parentElement === player) {
      return;
    }
    if (existing) removePill();

    const style = window.getComputedStyle(player);
    if (style.position === "static") {
      player.style.position = "relative";
    }
    player.appendChild(createPill(player));
  }

  function onNavigate() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(() => void mountIfNeeded(), 400);
    }
  }

  window.addEventListener("yt-navigate-finish", onNavigate);
  setInterval(() => {
    const href = window.location.href;
    if (href !== lastUrl) {
      onNavigate();
      return;
    }
    if (!isVideoPage(href)) {
      removePill();
      return;
    }
    const existing = document.getElementById(PILL_ID);
    const targetPlayer = findPlayerContainer(href);
    if (targetPlayer && (!existing || existing.parentElement !== targetPlayer)) {
      void mountIfNeeded();
    }
  }, 1000);

  setTimeout(() => void mountIfNeeded(), 800);
})();
