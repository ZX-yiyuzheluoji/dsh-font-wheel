/**
 * dsh-font-wheel — 客户端半（Client half）。
 *
 * 只做一件事：在页面任意位置 Ctrl + 滚轮 → 改工作区字号。
 *   上滚（deltaY < 0）= 放大，下滚 = 缩小，一格 1px。
 *
 * 为什么不能直接改 CSS 变量：
 *   `--dsh-content-font-size` 是 ui-layout 的 presenter 在每次 theme snapshot 里
 *   写回 body 的（见 @deepseek-ai/dsh-client-ui-layout 的 FONT_SIZE_VARIABLES），
 *   直接改会在下一次 snapshot 时被盖掉。所以走 ctx.theme.adjustFontSizes()——
 *   和桌面端 Ctrl+= / Ctrl+- 完全同一条路：同步改内存快照 → publish → 落盘。
 *   没有主题服务的外壳里才退回直接写变量（那种环境没有 presenter，不会被覆盖）。
 *
 * 客户端半是手写的 CJS bundle，按 DSH 的 module-loader 约定包装，
 * 无需 JSX / TS / 构建：`window.__ModuleLoader__.load({ id, factory })`。
 */
window.__ModuleLoader__.load({
  id: "dsh-font-wheel",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    /** 与 package.json 的 name 一致。 */
    const PACKAGE_ID = "dsh-font-wheel";
    /** 插件在场标记（body 属性，纯给调试 / 自检看）。 */
    const BODY_ATTR = "data-dsh-font-wheel";
    /** 宿主半的取证路由（<base>/font-wheel/report），只是旁路，失败不影响滚轮。 */
    const REPORT_PATH = "font-wheel/report";
    /** text 档字号的 CSS 变量（与 ui-theme 的 FONT_SIZE_SPECS.text.variable 一致）。 */
    const TEXT_VARIABLE = "--dsh-content-font-size";
    /** 拿不到主题服务时的兜底范围（同样对齐 FONT_SIZE_SPECS.text）。 */
    const FALLBACK_MIN = 10;
    const FALLBACK_MAX = 22;
    const FALLBACK_DEFAULT = 14;
    /**
     * 一步滚轮的节流间隔：触控板一次手势会连发几十个 wheel，
     * 一个都算一 px 会直接冲到边界，这里按 ~18 步/秒 收着走。
     */
    const STEP_INTERVAL_MS = 55;
    /** 提示浮层在最后一次滚动之后保留多久。 */
    const HUD_IDLE_MS = 1000;
    /** 提示浮层的位置偏移：落在光标上方一点，不挡着手。 */
    const HUD_OFFSET_Y = 28;
    const HUD_STYLE = {
      position: "fixed",
      "z-index": "2147483000",
      "pointer-events": "none",
      transform: "translate(-50%,-50%)",
      padding: "4px 10px",
      "border-radius": "999px",
      background: "rgba(17,17,19,.82)",
      color: "#fff",
      font: "600 12px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif",
      "letter-spacing": ".02em",
      "white-space": "nowrap",
      "box-shadow": "0 6px 18px rgba(0,0,0,.28)",
      opacity: "0",
      transition: "opacity .16s ease",
      "user-select": "none",
    };
    const LIMIT_HINT = { min: "已到下限", max: "已到上限" };

    function clampPx(px) {
      if (!Number.isFinite(px)) return FALLBACK_DEFAULT;
      return Math.max(FALLBACK_MIN, Math.min(FALLBACK_MAX, Math.round(px)));
    }

    /** 反射式取主题服务：没有 UI 服务的外壳（纯宿主 / 测试）里也要能 load。 */
    function themeService(ctx) {
      let service;
      try {
        service = ctx.get("theme");
      } catch (error) {
        service = undefined;
      }
      return service !== null && typeof service === "object" ? service : undefined;
    }

    /** 读当前 text 档字号：服务在就优先问它（快照是真值），否则退回读 DOM 变量。 */
    function readPx(service) {
      if (service !== undefined && typeof service.getTheme === "function") {
        try {
          const snapshot = service.getTheme();
          const px = Number.parseInt(snapshot?.fontSizes?.text, 10);
          if (Number.isInteger(px)) return px;
        } catch (error) {
          /* 快照读不出来就退回 DOM */
        }
      }
      const raw = typeof document !== "undefined" && document.body !== null
        ? document.body.style.getPropertyValue(TEXT_VARIABLE)
        : "";
      return clampPx(Number.parseInt(raw, 10));
    }

    /**
     * 走主题服务改一档字号，返回改完之后的 text 档 px。
     * 到边界时服务什么都不写（adjustFontSizes 自己会跳过），返回值和 before 相同。
     */
    function stepFontSize(ctx, delta) {
      const service = themeService(ctx);
      const before = readPx(service);
      if (service !== undefined && typeof service.adjustFontSizes === "function") {
        service.adjustFontSizes(delta);
        return readPx(service);
      }
      const next = clampPx(before + delta);
      if (typeof document !== "undefined" && document.body !== null) {
        document.body.style.setProperty(TEXT_VARIABLE, next + "px");
      }
      return next;
    }

    /** 光标附近的一个小药丸，显示当前字号；到边界时顺带说明一句。 */
    function createHud() {
      const hud = document.createElement("div");
      hud.setAttribute("data-role", "font-wheel-hud");
      for (const [name, value] of Object.entries(HUD_STYLE)) hud.style.setProperty(name, value);
      return hud;
    }

    /** 把浮层摆到光标上方，并且不许跑出视口。 */
    function placeHud(hud, event) {
      const width = Number.isFinite(window.innerWidth) ? window.innerWidth : 1024;
      const height = Number.isFinite(window.innerHeight) ? window.innerHeight : 768;
      const pointerX = Number.isFinite(event?.clientX) ? event.clientX : width / 2;
      const pointerY = Number.isFinite(event?.clientY) ? event.clientY : height / 2;
      const x = Math.max(36, Math.min(width - 36, pointerX));
      const y = Math.max(36, Math.min(height - 36, pointerY - HUD_OFFSET_Y));
      hud.style.setProperty("left", x + "px");
      hud.style.setProperty("top", y + "px");
    }

    /** 取证旁路：把这一格的结果报给宿主半（看不到界面时用 GET /font-wheel/report 确认）。 */
    function report(view, px) {
      try {
        const url = new URL(REPORT_PATH, document.baseURI).href;
        const handing = view.fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ px, at: new Date().toISOString() }),
        });
        if (handing !== null && typeof handing === "object" && typeof handing.catch === "function") {
          handing.catch(() => {});
        }
      } catch (error) {
        /* 取证是旁路，失败不影响滚轮 */
      }
    }

    function install(ctx) {
      const view = window;
      const doc = document;
      let hud = null;
      let hideTimer = 0;
      let lastStepAt = 0;

      /** limitSide：这一格撞到边界时是 "max" / "min"，正常改动了就是 undefined。 */
      function paint(px, limitSide, event) {
        if (hud === null) {
          hud = createHud();
          doc.body.appendChild(hud);
        }
        hud.textContent = String(px) + "px" + (limitSide === undefined ? "" : " \u00b7 " + LIMIT_HINT[limitSide]);
        placeHud(hud, event);
        hud.style.setProperty("opacity", "1");
        if (hideTimer !== 0) view.clearTimeout(hideTimer);
        hideTimer = view.setTimeout(() => {
          hideTimer = 0;
          if (hud !== null) hud.style.setProperty("opacity", "0");
        }, HUD_IDLE_MS);
      }

      function onWheel(event) {
        // 只管「按住 Ctrl」：Ctrl+Shift / Ctrl+Alt / Ctrl+Meta 都让给别人。
        if (event.ctrlKey !== true) return;
        if (event.altKey === true || event.metaKey === true || event.shiftKey === true) return;
        if (typeof event.deltaY !== "number" || event.deltaY === 0) return;

        // 先拦下默认动作：Chromium 的 Ctrl+滚轮页面缩放、别的面板自己的缩放手势
        // 都不该和「调字号」抢这一下。被节流掉的那几个也照样拦。
        if (typeof event.preventDefault === "function") event.preventDefault();

        const now = Date.now();
        if (now - lastStepAt < STEP_INTERVAL_MS) return;
        lastStepAt = now;

        const direction = event.deltaY < 0 ? 1 : -1;
        const before = readPx(themeService(ctx));
        const after = stepFontSize(ctx, direction);
        paint(after, after === before ? (direction > 0 ? "max" : "min") : undefined, event);
        report(view, after);
      }

      const options = { capture: true, passive: false };
      view.addEventListener("wheel", onWheel, options);
      if (doc.body !== null && typeof doc.body.setAttribute === "function") {
        doc.body.setAttribute(BODY_ATTR, "");
      }

      return () => {
        view.removeEventListener("wheel", onWheel, options);
        if (hideTimer !== 0) view.clearTimeout(hideTimer);
        if (hud !== null) {
          if (typeof hud.remove === "function") hud.remove();
          hud = null;
        }
        if (doc.body !== null && typeof doc.body.removeAttribute === "function") {
          doc.body.removeAttribute(BODY_ATTR);
        }
      };
    }

    function apply(ctx) {
      if (typeof window === "undefined" || typeof document === "undefined") return;
      ctx.effect(() => install(ctx), `${PACKAGE_ID}: ctrl+wheel font size`);
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  },
});