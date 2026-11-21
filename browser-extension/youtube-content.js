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

  function createPill() {
    const btn = document.createElement("button");
    btn.id = PILL_ID;
    btn.type = "button";
    btn.innerHTML = `<span style="font-size:14px;line-height:1">⚡</span><span class="hyperdm-label">Download with HyperDM</span>`;
    Object.assign(btn.style, {
      position: "absolute",
      top: "14px",
      right: "14px",
      zIndex: "2147483647",
      display: "inline-flex",
      alignItems: "center",
      gap: "7px",
      padding: "8px 14px",
      borderRadius: "999px",
      border: "1px solid rgba(168, 199, 250, 0.35)",
      background: "rgba(17, 19, 24, 0.88)",
      color: "#d3e3fd",
      fontFamily: '"Google Sans", Roboto, Inter, system-ui, sans-serif',
      fontSize: "12px",
      fontWeight: "600",
      letterSpacing: "0.01em",
      cursor: "pointer",
      boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
      backdropFilter: "blur(8px)",
      transition: "transform 140ms ease, background 140ms ease, opacity 160ms ease",
      opacity: "0.92",
    });

    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#0842a0";
      btn.style.color = "#ffffff";
      btn.style.opacity = "1";
      btn.style.transform = "translateY(-1px)";
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(17, 19, 24, 0.88)";
      btn.style.color = "#d3e3fd";
      btn.style.opacity = "0.92";
      btn.style.transform = "translateY(0)";
    });

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const labelEl = btn.querySelector(".hyperdm-label");
      if (labelEl) labelEl.textContent = "Opening HyperDM…";
      try {
        const res = await chrome.runtime.sendMessage({
          type: "openYouTube",
          url: window.location.href,
        });
        if (res && res.ok) {
          if (labelEl) labelEl.textContent = "Sent to HyperDM ✓";
        } else {
          if (labelEl) labelEl.textContent = "HyperDM Offline";
        }
      } catch {
        if (labelEl) labelEl.textContent = "HyperDM Offline";
      }
      setTimeout(() => {
        if (labelEl) labelEl.textContent = "Download with HyperDM";
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
