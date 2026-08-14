    return Boolean(
      typeof globalThis !== "undefined" && globalThis.__harborHost
    );
  }

  /** JetBrains: hide VS Code–only settings (Tab autocomplete). */
  function applyJetBrainsSettingsVisibility() {
    if (!harborHostAvailable()) {
      return;
    }
    document.documentElement.setAttribute("data-harbor-host", "jetbrains");
    const tabBlock = document.getElementById("settingsTabAutocompleteBlock");
    if (tabBlock) {
      tabBlock.hidden = true;
    }
  }

  applyJetBrainsSettingsVisibility();

  /**
   * JCEF OSR: CSS cursor is applied by the Kotlin host; HTML title tooltips are
   * drawn in-page (native title never shows in OSR).
   */
  function installJetBrainsChromeUx() {
    if (!harborHostAvailable()) {
      return;
    }
    let lastCursor = "";
    let tipTimer = 0;
    let tipEl = document.getElementById("harborJcefTip");
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.id = "harborJcefTip";
      tipEl.setAttribute("role", "tooltip");
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }

    function resolveCursor(el) {
      let node = el;
      while (node && node.nodeType === 1) {
        const value = window.getComputedStyle(node).cursor;
        if (value && value !== "auto") {
          return value;
        }
        node = node.parentElement;
      }
      return "default";
    }

    function resolveTitle(el) {
      const titled = el && el.closest ? el.closest("[title]") : null;
      if (!titled) {
        return "";
      }
      return String(titled.getAttribute("title") || "").trim();
    }

    function hideTip() {
      if (tipTimer) {
        clearTimeout(tipTimer);
        tipTimer = 0;
      }
      tipEl.hidden = true;
      tipEl.textContent = "";
    }

    function placeTip(x, y) {
      const pad = 12;
      const rect = tipEl.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      let left = x + pad;
      let top = y + 18;
      if (left + rect.width > vw - 4) {
        left = Math.max(4, x - rect.width - pad);
      }
      if (top + rect.height > vh - 4) {
        top = Math.max(4, y - rect.height - 8);
      }
      tipEl.style.left = `${Math.round(left)}px`;
      tipEl.style.top = `${Math.round(top)}px`;
    }

    function showTip(text, x, y) {
      if (!text) {
        hideTip();
        return;
      }
      if (tipTimer) {
        clearTimeout(tipTimer);
      }
      tipTimer = window.setTimeout(() => {
        tipTimer = 0;
        tipEl.textContent = text;
        tipEl.hidden = false;
        placeTip(x, y);
        // Reposition after layout with real size.
        requestAnimationFrame(() => placeTip(x, y));
      }, 450);
    }

    function publishCursor(cursor) {
      if (cursor === lastCursor) {
        return;
      }
      lastCursor = cursor;
      try {
        host.postMessage({ type: "jcefChrome", cursor });
      } catch {
        /* ignore */
      }
    }

    let raf = 0;
    let pending = null;
    function onPointer(event) {
      const el =
        event.target && event.target.nodeType === 1
          ? event.target
          : document.elementFromPoint(event.clientX, event.clientY);
      if (!el) {
        return;
      }
      const cursor = resolveCursor(el);
      const title = resolveTitle(el);
      const x = event.clientX;
      const y = event.clientY;
      pending = { cursor, title, x, y };
      if (raf) {
        return;
      }
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = pending;
        pending = null;
        if (!next) {
          return;
        }
        publishCursor(next.cursor);
        if (next.title) {
          if (tipEl.hidden || tipEl.textContent !== next.title) {
            showTip(next.title, next.x, next.y);
          } else {
            placeTip(next.x, next.y);
          }
        } else {
          hideTip();
        }
      });
    }

    document.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("pointerdown", hideTip, { passive: true });
    document.addEventListener(
      "pointerleave",
      () => {
        hideTip();
        publishCursor("default");
      },
      { passive: true }
    );
  }

  installJetBrainsChromeUx();

  /** JCEF OSR often skips paints after DOM updates until a click — nudge it. */
  function forceHarborUiRepaint() {
    if (!harborHostAvailable()) {
      return;
    }
    const root = document.documentElement;
    root.classList.add("harbor-force-paint");
    void (attachPreviewEl && attachPreviewEl.offsetHeight);
    void (selectionPreviewEl && selectionPreviewEl.offsetHeight);
    void root.offsetHeight;
    requestAnimationFrame(() => {
      root.classList.remove("harbor-force-paint");
      void document.body.offsetHeight;
      try {
        host.postMessage({ type: "uiRepaint" });
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * Settings <select> → composer mode-picker chrome (trigger + in-page listbox).
   * Native select stays in the DOM (hidden) so existing value/change wiring works.
   * JetBrains OSR: pick on pointerdown — click is often never synthesized.
   */
  function installHarborSelectPolyfill() {
    let activePicker = null;
    let nativeMenuEl = null;
    let nativeSelect = null;
    let pointerHandled = false;
    let suppressDismiss = false;
    const pickerMenus = new WeakMap();

    function armDismissGuard() {
      suppressDismiss = true;
      const clear = () => {
        suppressDismiss = false;
        document.removeEventListener("pointerup", clear, true);
        document.removeEventListener("mouseup", clear, true);
      };
      document.addEventListener("pointerup", clear, true);
      document.addEventListener("mouseup", clear, true);
      setTimeout(clear, 400);
    }

    function demoteFieldLabel(select) {
      const field = select.closest("label.settings-field");
      if (!field || field.tagName !== "LABEL") {
        return;
      }
      const div = document.createElement("div");
      div.className = field.className;
      Array.from(field.attributes).forEach((attr) => {
        if (attr.name === "class" || attr.name === "for") {
          return;
        }
        div.setAttribute(attr.name, attr.value);
      });
      while (field.firstChild) {
        div.appendChild(field.firstChild);
      }
      field.replaceWith(div);
    }
    const valueDesc = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    );
    const indexDesc = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "selectedIndex"
    );

    function selectedOptionLabel(select) {
      const opt =
        (select && select.options && select.options[select.selectedIndex]) ||
        null;
      if (!opt) {
        return "";
      }
      return String(opt.label || opt.textContent || opt.value || "").trim();
    }

    function syncPicker(select) {
      const picker = select && select.closest(".settings-select-picker");
      if (!picker) {
        return;
      }
      const trigger = picker.querySelector(".model-trigger");
      const label = picker.querySelector(".model-label");
      if (label) {
        label.textContent = selectedOptionLabel(select) || "\u00a0";
      }
      if (trigger) {
        trigger.disabled = Boolean(select.disabled);
        trigger.title = selectedOptionLabel(select);
      }
      if (select.disabled && picker.classList.contains("is-open")) {
        closePicker(picker);
      }
    }

    function patchSelectAccessors(select) {
      if (!valueDesc || !valueDesc.get || !valueDesc.set) {
        return;
      }
      Object.defineProperty(select, "value", {
        configurable: true,
        enumerable: true,
        get() {
          return valueDesc.get.call(this);
        },
        set(next) {
          valueDesc.set.call(this, next);
          syncPicker(this);
        },
      });
      if (indexDesc && indexDesc.get && indexDesc.set) {
        Object.defineProperty(select, "selectedIndex", {
          configurable: true,
          enumerable: true,
          get() {
            return indexDesc.get.call(this);
          },
          set(next) {
            indexDesc.set.call(this, next);
            syncPicker(this);
          },
        });
      }
    }

    function applySelectValue(select, value) {
      if (!select) {
        return;
      }
      const previous = select.value;
      const wanted = value == null ? "" : String(value);
      select.value = wanted;
      if (select.value !== previous || wanted !== previous) {
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    function menuForPicker(picker) {
      if (!picker) {
        return null;
      }
      return (
        pickerMenus.get(picker) ||
        picker.querySelector(".settings-select-menu")
      );
    }

    function closePicker(picker) {
      if (!picker) {
        return;
      }
      const trigger = picker.querySelector(".model-trigger");
      const menu = menuForPicker(picker);
      picker.classList.remove("is-open");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
      if (menu) {
        menu.hidden = true;
        if (typeof resetModelMenuPlacement === "function") {
          resetModelMenuPlacement(picker, menu);
        }
      }
      if (activePicker === picker) {
        activePicker = null;
      }
    }

    function closeActivePicker() {
      if (activePicker) {
        closePicker(activePicker);
      }
      closeNativeHarborSelectMenu();
    }

    function fillPickerMenu(select, menu) {
      menu.innerHTML = "";
      const options = Array.from(select.options || []);
      for (const opt of options) {
        if (opt.hidden || (opt.disabled && opt.hidden)) {
          continue;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        const isActive = opt.selected || opt.value === select.value;
        btn.className = "model-option" + (isActive ? " is-active" : "");
        btn.setAttribute("role", "option");
        btn.setAttribute("data-harbor-value", opt.value);
        btn.dataset.value = opt.value;
        if (opt.disabled) {
          btn.disabled = true;
        }
        if (isActive) {
          btn.setAttribute("aria-selected", "true");
        }
        const label = document.createElement("span");
        label.className = "model-option-label";
        label.textContent = opt.label || opt.textContent || opt.value || "";
        btn.appendChild(label);
        if (isActive) {
          const check = document.createElement("span");
          check.className = "model-check";
          check.innerHTML = CHECK_ICON;
          btn.appendChild(check);
        }
        menu.appendChild(btn);
      }
    }

    function placeSettingsMenu(picker, menu, trigger) {
      if (typeof placeModelMenu !== "function" || !picker || !menu || !trigger) {
        return;
      }
      placeModelMenu(picker, menu, document.documentElement);
    }

    function openPicker(picker) {
      const select = picker.querySelector("select");
      const trigger = picker.querySelector(".model-trigger");
      const menu = menuForPicker(picker);
      if (!select || !trigger || !menu || select.disabled) {
        return;
      }
      if (activePicker && activePicker !== picker) {
        closePicker(activePicker);
      }
      fillPickerMenu(select, menu);
      picker.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      menu.hidden = false;
      activePicker = picker;
      armDismissGuard();
      placeSettingsMenu(picker, menu, trigger);
      forceHarborUiRepaint();
    }

    function togglePicker(picker) {
      if (!picker) {
        return;
      }
      if (picker.classList.contains("is-open")) {
        closePicker(picker);
      } else {
        openPicker(picker);
      }
    }

    function wrapSelect(select) {
      if (!select || select.closest(".settings-select-picker")) {
        return;
      }
      demoteFieldLabel(select);
      const picker = document.createElement("div");
      picker.className = "model-picker settings-select-picker";
      picker.dataset.selectId = select.id || `select-${Math.random().toString(36).slice(2, 9)}`;

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "model-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const field = select.closest(".settings-field");
      const fieldLabel = field && field.querySelector(".settings-label");
      if (fieldLabel && fieldLabel.textContent) {
        trigger.setAttribute("aria-label", fieldLabel.textContent.trim());
      }

      const label = document.createElement("span");
      label.className = "model-label";

      const chevron = document.createElement("span");
      chevron.className = "material-symbols-outlined model-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "expand_more";

      trigger.appendChild(label);
      trigger.appendChild(chevron);

      const menu = document.createElement("div");
      menu.className = "model-menu settings-select-menu";
      menu.setAttribute("role", "listbox");
      menu.dataset.selectId = picker.dataset.selectId;
      menu.hidden = true;

      select.classList.add("settings-select-native");
      select.setAttribute("tabindex", "-1");
      select.setAttribute("aria-hidden", "true");

      const parent = select.parentNode;
      parent.insertBefore(picker, select);
      picker.appendChild(trigger);
      picker.appendChild(select);
      picker.appendChild(menu);
      pickerMenus.set(picker, menu);

      patchSelectAccessors(select);
      syncPicker(select);

      const observer = new MutationObserver(() => {
        syncPicker(select);
        if (picker.classList.contains("is-open")) {
          const liveMenu = menuForPicker(picker);
          if (liveMenu) {
            fillPickerMenu(select, liveMenu);
            placeSettingsMenu(picker, liveMenu, trigger);
          }
        }
      });
      observer.observe(select, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "hidden"],
        characterData: true,
      });
      select.addEventListener("change", () => syncPicker(select));

      let triggerPointerHandled = false;
      trigger.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        triggerPointerHandled = true;
        event.preventDefault();
        event.stopPropagation();
        togglePicker(picker);
        setTimeout(() => {
          triggerPointerHandled = false;
        }, 0);
      });
      trigger.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (triggerPointerHandled || event.button !== 0) {
          return;
        }
        togglePicker(picker);
      });
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      trigger.addEventListener("keydown", (event) => {
        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "ArrowDown"
        ) {
          event.preventDefault();
          openPicker(picker);
        } else if (event.key === "Escape" && picker.classList.contains("is-open")) {
          event.preventDefault();
          closePicker(picker);
        }
      });

      const onMenuOption = (event) => {
        const option = event.target && event.target.closest
          ? event.target.closest(".model-option")
          : null;
        if (!option || !menu.contains(option) || option.disabled) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const value =
          option.getAttribute("data-harbor-value") != null
            ? option.getAttribute("data-harbor-value")
            : option.dataset.value !== undefined
              ? option.dataset.value
              : "";
        applySelectValue(select, value);
        closePicker(picker);
        forceHarborUiRepaint();
      };
      menu.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        onMenuOption(event);
      });
      menu.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      menu.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    document.querySelectorAll("select.settings-input").forEach(wrapSelect);

    function closeNativeHarborSelectMenu() {
      if (nativeMenuEl) {
        nativeMenuEl.remove();
        nativeMenuEl = null;
      }
      if (nativeSelect) {
        nativeSelect.classList.remove("harbor-select-open");
      }
      nativeSelect = null;
    }

    function openNativeHarborSelectMenu(select) {
      closeNativeHarborSelectMenu();
      if (!select || select.disabled) {
        return;
      }
      nativeSelect = select;
      select.classList.add("harbor-select-open");
      nativeMenuEl = document.createElement("div");
      nativeMenuEl.className = "harbor-select-menu";
      nativeMenuEl.setAttribute("role", "listbox");
      const options = Array.from(select.options || []);
      for (const opt of options) {
        if (opt.disabled && opt.hidden) {
          continue;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "harbor-select-option";
        btn.setAttribute("role", "option");
        btn.setAttribute("data-harbor-value", opt.value);
        btn.dataset.value = opt.value;
        if (opt.selected || opt.value === select.value) {
          btn.classList.add("is-selected");
          btn.setAttribute("aria-selected", "true");
        }
        btn.textContent = opt.label || opt.textContent || opt.value || "";
        nativeMenuEl.appendChild(btn);
      }
      document.body.appendChild(nativeMenuEl);
      const rect = select.getBoundingClientRect();
      const maxH = Math.min(280, Math.max(120, window.innerHeight - 24));
      nativeMenuEl.style.maxHeight = `${maxH}px`;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
      const width = Math.max(rect.width, 180);
      nativeMenuEl.style.minWidth = `${Math.min(width, window.innerWidth - 16)}px`;
      nativeMenuEl.style.left = `${Math.max(
        8,
        Math.min(rect.left, window.innerWidth - width - 8)
      )}px`;
      if (openUp) {
        nativeMenuEl.classList.add("opens-up");
        nativeMenuEl.style.bottom = `${Math.max(
          8,
          window.innerHeight - rect.top + 4
        )}px`;
        nativeMenuEl.style.top = "auto";
      } else {
        nativeMenuEl.style.top = `${Math.min(
          rect.bottom + 4,
          window.innerHeight - 40
        )}px`;
        nativeMenuEl.style.bottom = "auto";
      }
      forceHarborUiRepaint();
    }

    const onPointer = (event) => {
      const target = event.target;
      if (!target || !target.closest) {
        return;
      }

      const pickerOption = target.closest(
        ".settings-select-menu .model-option"
      );
      if (pickerOption) {
        return;
      }
      if (target.closest(".settings-select-menu")) {
        event.stopPropagation();
        return;
      }
      if (target.closest(".settings-select-picker .model-trigger")) {
        return;
      }
      if (target.closest(".settings-field > .settings-label")) {
        return;
      }

      const nativeOption = target.closest(".harbor-select-option");
      if (nativeOption && nativeMenuEl && nativeMenuEl.contains(nativeOption)) {
        event.preventDefault();
        event.stopPropagation();
        const select = nativeSelect;
        const value =
          nativeOption.getAttribute("data-harbor-value") != null
            ? nativeOption.getAttribute("data-harbor-value")
            : nativeOption.dataset.value !== undefined
              ? nativeOption.dataset.value
              : "";
        applySelectValue(select, value);
        closeNativeHarborSelectMenu();
        forceHarborUiRepaint();
        return;
      }

      if (nativeMenuEl && nativeMenuEl.contains(target)) {
        event.stopPropagation();
        return;
      }

      const pathSelect = target.closest("select");
      if (
        pathSelect &&
        harborHostAvailable() &&
        !pathSelect.closest(".settings-select-picker")
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (nativeSelect === pathSelect && nativeMenuEl) {
          closeNativeHarborSelectMenu();
        } else {
          closeActivePicker();
          openNativeHarborSelectMenu(pathSelect);
        }
        return;
      }

      if (
        !suppressDismiss &&
        activePicker &&
        !target.closest(".settings-select-picker")
      ) {
        closePicker(activePicker);
      }
      if (nativeMenuEl) {
        closeNativeHarborSelectMenu();
      }
    };

    document.addEventListener(
      "pointerdown",
      (event) => {
        pointerHandled = true;
        onPointer(event);
        setTimeout(() => {
          pointerHandled = false;
        }, 0);
      },
      true
    );
    document.addEventListener(
      "mousedown",
      (event) => {
        if (pointerHandled) {
          return;
        }
        onPointer(event);
      },
      true
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          closeActivePicker();
          return;
        }
        const el = document.activeElement;
        if (
          harborHostAvailable() &&
          el &&
          el.tagName === "SELECT" &&
          !el.closest(".settings-select-picker") &&
          (event.key === "Enter" ||
            event.key === " " ||
            event.key === "ArrowDown")
        ) {
          event.preventDefault();
          openNativeHarborSelectMenu(el);
        }
      },
      true
    );
    window.addEventListener("resize", closeActivePicker);
    document.addEventListener(
      "scroll",
      (event) => {
        if (suppressDismiss || (!activePicker && !nativeMenuEl)) {
          return;
        }
        const scrolled = event.target;
        if (nativeMenuEl && (scrolled === nativeMenuEl || nativeMenuEl.contains(scrolled))) {
          return;
        }
        if (activePicker) {
          const menu = menuForPicker(activePicker);
          if (menu && (scrolled === menu || menu.contains(scrolled))) {
            return;
          }
        }
        closeActivePicker();
      },
      true
    );
  }

  installHarborSelectPolyfill();

  /**
   * OSR often drops the synthesized `click` after pointerup on icon/primary
   * controls (edit-resend, send, regenerate). Retry via el.click() if needed.
   * Mode/model edit pickers and edit-save open/act on pointerdown — click is
   * unreliable in OSR and a delayed synthetic click would toggle/double-fire.
   */
  function installHarborClickPolyfill() {
    if (!harborHostAvailable()) {
      return;
    }
    const SELECTOR =
      "#sendBtn, .msg-edit-save, .msg-regenerate, .msg-copy, .msg-branch, .msg-edit-mode-trigger, .msg-edit-model-trigger, .msg-edit-plus-btn, .msg-edit-reason-trigger, .composer-plan-build";
    const POINTER_ACTION_SELECTOR =
      ".msg-edit-mode-trigger, .msg-edit-model-trigger, .msg-edit-plus-btn, .msg-edit-reason-trigger, .msg-edit-save, .msg-regenerate, .msg-copy, .msg-branch, .composer-plan-build, #sendBtn";
    let downEl = null;
    let clickSeen = false;

    function runPointerAction(el) {
      if (!el || el.disabled) {
        return false;
      }
      if (el.classList.contains("msg-edit-mode-trigger")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditPickerOpenedAt = Date.now();
        toggleEditModeMenu();
        return true;
      }
      if (el.classList.contains("msg-edit-model-trigger")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditPickerOpenedAt = Date.now();
        toggleEditModelMenu();
        return true;
      }
      if (el.classList.contains("msg-edit-plus-btn")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditPickerOpenedAt = Date.now();
        toggleEditPlusMenu();
        return true;
      }
      if (el.classList.contains("msg-edit-reason-trigger")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditPickerOpenedAt = Date.now();
        toggleEditReasonMenu();
        return true;
      }
      if (el.classList.contains("msg-edit-save")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        harborEditSaveAt = Date.now();
        submitEditedUserMessage();
        return true;
      }
      if (el.classList.contains("msg-copy")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        copyAssistantFromButton(el);
        return true;
      }
      if (el.classList.contains("msg-regenerate")) {
        if (!messagesEl || !messagesEl.contains(el) || !canRegenerate) {
          return false;
        }
        harborEditSaveAt = Date.now();
        pinChatToBottom();
        setBusy(true);
        host.postMessage({
          type: "regenerate",
          agentMode,
          reasoningEffort: selectedReasoningEffort || undefined,
        });
        return true;
      }
      if (el.classList.contains("msg-branch")) {
        if (!messagesEl || !messagesEl.contains(el)) {
          return false;
        }
        const index = Number(el.dataset.index);
        if (!Number.isInteger(index) || index < 0) {
          return false;
        }
        harborEditSaveAt = Date.now();
        host.postMessage({ type: "branchFromMessage", messageIndex: index });
        return true;
      }
      if (el.classList.contains("composer-plan-build") || el.id === "sendBtn") {
        harborEditSaveAt = Date.now();
        try {
          el.click();
        } catch {
          /* ignore */
        }
        return true;
      }
      return false;
    }

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) {
          return;
        }
        const actionEl =
          event.target && event.target.closest
            ? event.target.closest(POINTER_ACTION_SELECTOR)
            : null;
        if (actionEl && runPointerAction(actionEl)) {
          event.preventDefault();
          event.stopPropagation();
          downEl = null;
          clickSeen = true;
          forceHarborUiRepaint();
          setTimeout(forceHarborUiRepaint, 32);
          setTimeout(forceHarborUiRepaint, 120);
          return;
        }
        const el =
          event.target && event.target.closest
            ? event.target.closest(SELECTOR)
            : null;
        downEl = el && !el.disabled ? el : null;
        clickSeen = false;
      },
      true
    );

    document.addEventListener(
      "click",
      () => {
        if (downEl) {
          clickSeen = true;
        }
      },
      true
    );

    document.addEventListener(
      "pointerup",
      (event) => {
        if (event.button !== 0 || !downEl) {
          downEl = null;
          return;
        }
        const start = downEl;
        downEl = null;
        const el =
          event.target && event.target.closest
            ? event.target.closest(SELECTOR)
            : null;
        if (!el || (el !== start && !start.contains(el) && !el.contains(start))) {
          return;
        }
        if (el.matches(POINTER_ACTION_SELECTOR)) {
          return;
        }
        window.setTimeout(() => {
          if (clickSeen) {
            return;
          }
          try {
            el.click();
          } catch {
            /* ignore */
          }
          forceHarborUiRepaint();
        }, 40);
      },
      true
    );
  }

