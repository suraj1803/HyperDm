(() => {
  const PILL_ID = "hyperdm-yt-download-pill";
  let lastUrl = "";

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

  function createPill() {
    const btn = document.createElement("button");
    btn.id = PILL_ID;
    btn.type = "button";
    btn.title = "Download with HyperDM";
    btn.setAttribute("aria-label", "Download with HyperDM");

    let state = "idle";
    let resetTimer = null;

    const setIcon = (kind) => {
      btn.replaceChildren(createIcon(kind));
    };

    const applyVisualState = (hovered = false) => {
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
        btn.style.opacity = "1";
      } else {
        btn.style.background = "rgba(17, 19, 24, 0.78)";
        btn.style.color = "#d3e3fd";
        btn.style.borderColor = "rgba(168, 199, 250, 0.35)";
        btn.style.opacity = "0.78";
      }
    };

    setIcon("download");
    Object.assign(btn.style, {
      position: "absolute",
      top: "14px",
      right: "14px",
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
      boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
      backdropFilter: "blur(8px)",
      transition: "transform 140ms ease, background 140ms ease, opacity 160ms ease, border-color 140ms ease",
      opacity: "0.78",
    });

    btn.addEventListener("mouseenter", () => {
      applyVisualState(true);
      btn.style.transform = "scale(1.06)";
    });

    btn.addEventListener("mouseleave", () => {
      applyVisualState(false);
      btn.style.transform = "scale(1)";
    });

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }

      state = "loading";
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
        applyVisualState(btn.matches(":hover"));
        resetTimer = null;
      }, 2200);
    });

    return btn;
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

    const player =
      document.getElementById("movie_player") ||
      document.querySelector("ytd-reel-video-renderer[is-active] #player-container") ||
      document.querySelector("#player-container");

    if (!player) return;

    const existing = document.getElementById(PILL_ID);
    if (existing && existing.parentElement === player) {
      return;
    }
    if (existing) existing.remove();

    const style = window.getComputedStyle(player);
    if (style.position === "static") {
      player.style.position = "relative";
    }
    player.appendChild(createPill());
  }

  function onNavigate() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(() => void mountIfNeeded(), 600);
    }
  }

  window.addEventListener("yt-navigate-finish", onNavigate);
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      onNavigate();
    } else if (isVideoPage(window.location.href) && !document.getElementById(PILL_ID)) {
      void mountIfNeeded();
    }
  }, 1500);

  setTimeout(() => void mountIfNeeded(), 800);
})();
