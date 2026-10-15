
  /* ===================================================================
   * Лента: навигация и подписи.
   * - кнопка «↓» над полем ввода (с меткой «Новое», если ниже дописалось);
   * - закреплённый вопрос текущего хода при прокрутке его ответа;
   * - мини-карта ходов у правого края + Alt+↑/↓;
   * - разделители по времени между ходами;
   * - сворачивание длинных сообщений пользователя;
   * - действия под ответом видны у последнего ответа, у остальных — по наведению.
   * Всё строится из DOM ленты и uiMessagesCache, без отдельного состояния,
   * которое могло бы разойтись с лентой после перерисовки.
   * =================================================================== */

  const FEED_LONG_USER_LINES = 10;
  /** Turn map: distance between stacked ticks (px), before shrinking. */
  const FEED_TICK_STEP = 8;
  /** Below this list height (px) the turn map is not drawn (layout not ready). */
  const FEED_MAP_MIN_HEIGHT = 80;
  let feedMapRetryTimer = 0;
  const FEED_LONG_USER_CHARS = 900;
  const FEED_TIME_GAP_MS = 60 * 60 * 1000;
  const FEED_JUMP_DISTANCE_PX = 240;

  let feedOverlayEl = null;
  let feedStickyEl = null;
  let feedMapEl = null;
  let feedTipEl = null;
  let feedJumpEl = null;
  let feedUpdateRaf = 0;
  let feedSeenHeight = 0;
  let feedHasNew = false;
  let feedJumpShown = false;

  function feedLocale() {
    return UI_LANG === "ru" ? "ru-RU" : "en-US";
  }

  function feedDayStart(ts) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function feedClock(ts) {
    try {
      return new Date(ts).toLocaleTimeString(feedLocale(), {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  /** "today" | "yesterday" | "other" по локальной дате. */
  function feedDayKind(ts) {
    const today = feedDayStart(Date.now());
    const day = feedDayStart(ts);
    if (day >= today) {
      return "today";
    }
    if (day >= today - 86_400_000) {
      return "yesterday";
    }
    return "other";
  }

  function feedShortDate(ts) {
    try {
      return new Date(ts).toLocaleDateString(feedLocale(), {
        day: "numeric",
        month: "short",
      });
    } catch {
      return "";
    }
  }

  /** Разделитель: «Сегодня, 14:05» / «Вчера, 18:40» / «12 окт., 09:10». */
  function feedSeparatorLabel(ts) {
    const kind = feedDayKind(ts);
    const day =
      kind === "today"
        ? t("agentsGroupToday")
        : kind === "yesterday"
          ? t("agentsGroupYesterday")
          : feedShortDate(ts);
    return `${day}, ${feedClock(ts)}`;
  }

  function feedPrevTs(index) {
    for (let i = index - 1; i >= 0; i -= 1) {
      const ts = Number(uiMessagesCache[i]?.ts) || 0;
      if (ts > 0) {
        return ts;
      }
    }
    return 0;
  }

  /**
   * Перед ходом — тонкий разделитель, если с прошлого сообщения прошёл
   * час или сменился день. Живое сообщение без ts от хоста получает
   * локальное «сейчас» (хост проставит своё при сохранении).
   */
  function maybeInsertTimeSeparator(turnEl, index, live) {
    if (!turnEl || typeof index !== "number") {
      return;
    }
    const item = uiMessagesCache[index];
    if (!item) {
      return;
    }
    let ts = Number(item.ts) || 0;
    if (!ts && live) {
      ts = Date.now();
      item.ts = ts;
    }
    if (!ts) {
      return;
    }
    const prev = feedPrevTs(index);
    // Первый ход чата с известным временем — заголовок с датой сверху,
    // чтобы было видно, когда разговор начался.
    let prevTurn = turnEl.previousElementSibling;
    while (prevTurn && !prevTurn.classList.contains("chat-turn")) {
      prevTurn = prevTurn.previousElementSibling;
    }
    const isFirstTurn = !prevTurn;
    if (!prev && !isFirstTurn) {
      return;
    }
    if (
      prev &&
      ts - prev < FEED_TIME_GAP_MS &&
      feedDayStart(ts) === feedDayStart(prev)
    ) {
      return;
    }
    const prevEl = turnEl.previousElementSibling;
    if (prevEl && prevEl.classList.contains("feed-time-sep")) {
      return;
    }
    const sep = document.createElement("div");
    sep.className = "feed-time-sep";
    sep.setAttribute("role", "separator");
    const label = document.createElement("span");
    label.textContent = feedSeparatorLabel(ts);
    sep.appendChild(label);
    turnEl.before(sep);
  }

  /** Длинное сообщение пользователя (вставленный лог) — свернуть до ~7 строк. */
  /**
   * One-line label of a user turn for the sticky question / turn map.
   * Build handoff → «Build plan · <goal>» instead of the raw
   * «[[harbor:implement_plan]] Implement the following plan…» payload.
   */
  function feedUserSummary(msg) {
    const raw = String(msg?.dataset.raw || msg?.textContent || "");
    if (looksLikePlanImplementDisplay(raw)) {
      const goal = summarizePlanMarkdown(stripPlanImplementWrapper(raw)).goal;
      const label = t("proposedPlanImplementBubble");
      return goal ? `${label} · ${goal}` : label;
    }
    return raw
      .replace(/\[\[harbor:[a-z_]+\]\]\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function maybeCollapseLongUserMessage(el, text) {
    if (!el) {
      return;
    }
    const raw = String(text || "");
    // Build handoff: the bubble shows a «Build plan» chip — the toggle opens
    // the plan under it (any length), not a taller clamp of a one-line chip.
    const isPlan = el.classList.contains("is-plan-implement");
    if (isPlan && !el.querySelector(".plan-implement-plan")) {
      return;
    }
    const lines = isPlan
      ? stripPlanImplementWrapper(raw).split("\n").length
      : raw.split("\n").length;
    if (
      !isPlan &&
      lines <= FEED_LONG_USER_LINES &&
      raw.length <= FEED_LONG_USER_CHARS
    ) {
      return;
    }
    if (el.querySelector(":scope > .msg-expand")) {
      return;
    }
    el.classList.add("is-long", "is-long-collapsed");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "msg-expand";
    btn.dataset.lines = String(lines);
    btn.setAttribute("aria-expanded", "false");
    if (isPlan) {
      btn.dataset.plan = "1";
    }
    btn.textContent = isPlan ? t("feedShowPlan", lines) : t("feedShowAll", lines);
    el.appendChild(btn);
  }

  function toggleLongUserMessage(btn) {
    const el = btn?.closest(".msg.user");
    if (!el) {
      return;
    }
    const collapsed = el.classList.toggle("is-long-collapsed");
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const showKey = btn.dataset.plan === "1" ? "feedShowPlan" : "feedShowAll";
    btn.textContent = collapsed
      ? t(showKey, Number(btn.dataset.lines) || 0)
      : t("feedCollapse");
    if (collapsed) {
      // Свернули длинное — вернуть начало сообщения в кадр.
      const r = el.getBoundingClientRect();
      const m = messagesEl.getBoundingClientRect();
      if (r.top < m.top) {
        messagesEl.scrollTop += r.top - m.top - 8;
      }
    }
    scheduleFeedUpdate();
  }

  /** Подпись «модель · время · длительность» в строке действий ответа. */
  /** Подпись под ответом (модель · время · длительность) отключена — убираем остатки. */
  function paintAssistantMeta(index) {
    if (typeof index !== "number" || !messagesEl) {
      return;
    }
    const el = messagesEl.querySelector(
      `.msg.assistant[data-index="${index}"]`
    );
    const wrap = el ? el.closest(".msg-wrap-assistant") : null;
    wrap?.querySelector(":scope > .msg-actions > .msg-meta")?.remove();
  }

  function paintLatestAssistantMeta() {
    for (let i = uiMessagesCache.length - 1; i >= 0; i -= 1) {
      if (uiMessagesCache[i]?.role === "assistant") {
        paintAssistantMeta(i);
        return;
      }
    }
  }

  function feedUserWraps() {
    if (!messagesEl) {
      return [];
    }
    return [...messagesEl.querySelectorAll(".chat-turn > .msg-wrap-user")];
  }

  /** Индекс хода, чей вопрос последним ушёл под верх ленты (или -1). */
  function feedCurrentTurnIndex(wraps, top) {
    let current = -1;
    for (let i = 0; i < wraps.length; i += 1) {
      // +12: после перехода к ходу его пузырь стоит на 8px ниже верха.
      if (wraps[i].getBoundingClientRect().top <= top + 12) {
        current = i;
      } else {
        break;
      }
    }
    return current;
  }

  function scrollFeedToTurn(wrap) {
    if (!wrap || !messagesEl) {
      return;
    }
    const top = messagesEl.getBoundingClientRect().top;
    const offset = wrap.getBoundingClientRect().top - top - 8;
    messagesEl.scrollTop += offset;
    stickToBottom = isNearBottom();
    scheduleFeedUpdate();
  }

  function ensureFeedChrome() {
    if (!messagesEl) {
      return false;
    }
    if (!feedOverlayEl || !feedOverlayEl.isConnected) {
      feedOverlayEl = document.createElement("div");
      feedOverlayEl.className = "feed-overlay";

      feedStickyEl = document.createElement("button");
      feedStickyEl.type = "button";
      feedStickyEl.className = "feed-sticky-question";
      feedStickyEl.hidden = true;
      feedStickyEl.innerHTML =
        `<span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>` +
        `<span class="feed-sticky-text"></span>` +
        `<span class="feed-sticky-count"></span>`;
      feedStickyEl.addEventListener("click", () => {
        const wraps = feedUserWraps();
        const idx = Number(feedStickyEl.dataset.turn);
        if (Number.isInteger(idx) && wraps[idx]) {
          scrollFeedToTurn(wraps[idx]);
        }
      });
      feedOverlayEl.appendChild(feedStickyEl);

      feedMapEl = document.createElement("div");
      feedMapEl.className = "feed-turn-map";
      feedMapEl.hidden = true;
      feedMapEl.addEventListener("click", (event) => {
        const tick = event.target.closest("[data-turn]");
        if (!tick) {
          return;
        }
        const wraps = feedUserWraps();
        const wrap = wraps[Number(tick.getAttribute("data-turn"))];
        if (wrap) {
          scrollFeedToTurn(wrap);
        }
      });
      feedOverlayEl.appendChild(feedMapEl);

      // Hover popup for ticks — our own element instead of a native `title`
      // tooltip, so it looks the same in VS Code (Electron) and WebStorm (JCEF).
      feedTipEl = document.createElement("div");
      feedTipEl.className = "feed-turn-tip";
      feedTipEl.hidden = true;
      feedTipEl.setAttribute("role", "tooltip");
      feedTipEl.innerHTML =
        `<span class="feed-turn-tip-num"></span><span class="feed-turn-tip-text"></span>`;
      feedOverlayEl.appendChild(feedTipEl);
      const showTip = (event) => {
        const tick = event.target.closest?.(".feed-turn-tick");
        if (!tick || !feedMapEl.contains(tick)) {
          return;
        }
        // Stale geometry (map laid out while the panel was resizing) would
        // keep the stack off-center — re-measure once the pointer is here.
        const expected = Math.max(
          0,
          (Math.round(messagesEl.getBoundingClientRect().height) ||
            messagesEl.clientHeight) - 16
        );
        if (Math.abs(parseFloat(feedMapEl.style.height || "0") - expected) > 2) {
          scheduleFeedUpdate();
          return;
        }
        feedTipEl.querySelector(".feed-turn-tip-num").textContent =
          `${Number(tick.getAttribute("data-turn")) + 1}`;
        feedTipEl.querySelector(".feed-turn-tip-text").textContent =
          tick.dataset.tip || "";
        feedTipEl.style.top = `${feedMapEl.offsetTop + tick.offsetTop + tick.offsetHeight / 2}px`;
        feedTipEl.hidden = false;
      };
      const hideTip = () => {
        feedTipEl.hidden = true;
      };
      feedMapEl.addEventListener("mouseover", showTip);
      feedMapEl.addEventListener("focusin", showTip);
      feedMapEl.addEventListener("mouseout", (event) => {
        const next = event.relatedTarget;
        if (!next || !next.closest?.(".feed-turn-tick")) {
          hideTip();
        }
      });
      feedMapEl.addEventListener("focusout", hideTip);
      feedMapEl.addEventListener("click", hideTip);

      messagesEl.before(feedOverlayEl);
    }
    if ((!feedJumpEl || !feedJumpEl.isConnected) && composerWrapEl) {
      feedJumpEl = document.createElement("button");
      feedJumpEl.type = "button";
      feedJumpEl.className = "feed-jump";
      feedJumpEl.hidden = true;
      feedJumpEl.innerHTML =
        `<span class="material-symbols-outlined" aria-hidden="true">arrow_downward</span>` +
        `<span class="feed-jump-label"></span>` +
        `<span class="feed-jump-dot" aria-hidden="true"></span>`;
      feedJumpEl.addEventListener("click", () => {
        feedHasNew = false;
        pinChatToBottom();
        scheduleFeedUpdate();
      });
      composerWrapEl.appendChild(feedJumpEl);
    }
    return true;
  }

  function updateFeed() {
    feedUpdateRaf = 0;
    if (!ensureFeedChrome() || !chatScreen || chatScreen.hidden) {
      return;
    }
    const mRect = messagesEl.getBoundingClientRect();
    const top = mRect.top;
    const distance =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;

    // «↓» — когда прокрутили заметно выше конца ленты.
    const showJump = distance > FEED_JUMP_DISTANCE_PX;
    if (showJump && !feedJumpShown) {
      feedSeenHeight = messagesEl.scrollHeight;
      feedHasNew = false;
    } else if (showJump && messagesEl.scrollHeight > feedSeenHeight + 8) {
      feedHasNew = true;
    }
    if (!showJump) {
      feedHasNew = false;
    }
    feedJumpShown = showJump;
    if (feedJumpEl) {
      feedJumpEl.hidden = !showJump;
      feedJumpEl.classList.toggle("has-new", feedHasNew);
      const label = feedHasNew ? t("feedJumpNew") : t("feedJumpLatest");
      feedJumpEl.querySelector(".feed-jump-label").textContent = feedHasNew
        ? label
        : "";
      feedJumpEl.title = t("feedJumpLatest");
      feedJumpEl.setAttribute("aria-label", t("feedJumpLatest"));
    }

    const wraps = feedUserWraps();
    const current = feedCurrentTurnIndex(wraps, top);

    // Закреплённый вопрос: его пузырь уже ушёл вверх, а ответ ещё на экране.
    let showSticky = false;
    if (current >= 0) {
      const wrap = wraps[current];
      const turn = wrap.parentElement;
      const wrapBottom = wrap.getBoundingClientRect().bottom;
      const turnBottom = turn ? turn.getBoundingClientRect().bottom : 0;
      if (wrapBottom < top + 2 && turnBottom > top + 56) {
        const msg = wrap.querySelector(".msg.user");
        const raw = feedUserSummary(msg);
        if (raw) {
          showSticky = true;
          feedStickyEl.dataset.turn = String(current);
          feedStickyEl.querySelector(".feed-sticky-text").textContent = raw;
          feedStickyEl.querySelector(".feed-sticky-count").textContent =
            wraps.length > 1 ? `${current + 1} / ${wraps.length}` : "";
          feedStickyEl.title = t("feedStickyTitle");
        }
      }
    }
    if (feedStickyEl) {
      feedStickyEl.hidden = !showSticky;
    }

    // Мини-карта ходов — только в длинных чатах с прокруткой.
    const scrollable = messagesEl.scrollHeight > messagesEl.clientHeight * 1.3;
    // Real on-screen height of the chat list. A hidden / still-laying-out
    // webview (VS Code keeps background tabs at ~0px) reports a tiny value —
    // then all ticks collapse into one dot at the top. Skip and retry.
    const mapHeight = Math.round(mRect.height) || messagesEl.clientHeight;
    const tooLow = mapHeight < FEED_MAP_MIN_HEIGHT;
    if (tooLow && wraps.length >= 3 && scrollable) {
      clearTimeout(feedMapRetryTimer);
      feedMapRetryTimer = setTimeout(scheduleFeedUpdate, 300);
    }
    const showMap = wraps.length >= 3 && scrollable && !tooLow;
    if (feedMapEl) {
      feedMapEl.hidden = !showMap;
      if (showMap) {
        const h = mapHeight;
        feedMapEl.style.height = `${Math.max(0, h - 16)}px`;
        feedMapEl.setAttribute("aria-label", t("feedTurnMap"));
        // Ticks as a compact stack, vertically centered: one tick per turn
        // at an even step (not spread by scroll offset). Long chats shrink
        // the step so the stack stays within ~70% of the track.
        const track = Math.max(1, h - 16);
        const step = Math.max(
          4,
          Math.min(FEED_TICK_STEP, (track * 0.7) / Math.max(1, wraps.length))
        );
        const stackHeight = step * (wraps.length - 1) + 3;
        const stackTop = Math.max(0, (track - stackHeight) / 2);
        let html = "";
        const tickTops = [];
        wraps.forEach((wrap, i) => {
          const y = Math.min(track - 3, stackTop + i * step);
          tickTops.push(Math.round(y));
          const raw = feedUserSummary(wrap.querySelector(".msg.user")).slice(
            0,
            80
          );
          html +=
            `<button type="button" class="feed-turn-tick${i === Math.max(0, current) ? " is-current" : ""}" data-turn="${i}" data-tip="${escapeHtml(raw)}" aria-label="${escapeHtml(`${i + 1}. ${raw}`)}"></button>`;
        });
        feedMapEl.innerHTML = html;
        // Position via CSSOM, not a `style="…"` attribute in the HTML string:
        // the VS Code webview CSP (style-src without 'unsafe-inline') drops
        // inline style attributes, which stacked every tick at the top.
        feedMapEl.querySelectorAll(".feed-turn-tick").forEach((tick, i) => {
          tick.style.top = `${tickTops[i] || 0}px`;
        });
      }
    }

    // Действия под ответом: у последнего всегда, у остальных — по наведению.
    const assistants = messagesEl.querySelectorAll(".msg-wrap-assistant");
    assistants.forEach((el, i) => {
      el.classList.toggle("is-latest", i === assistants.length - 1);
    });
  }

  function scheduleFeedUpdate() {
    if (feedUpdateRaf) {
      return;
    }
    feedUpdateRaf = requestAnimationFrame(updateFeed);
  }

  /** Alt+↑ / Alt+↓ — к предыдущему / следующему запросу в ленте. */
  function onFeedTurnKey(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    if (!chatScreen || chatScreen.hidden || !messagesEl) {
      return;
    }
    const target = event.target;
    if (
      (target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement) &&
      target.value
    ) {
      return;
    }
    const wraps = feedUserWraps();
    if (!wraps.length) {
      return;
    }
    event.preventDefault();
    const top = messagesEl.getBoundingClientRect().top;
    const current = feedCurrentTurnIndex(wraps, top);
    if (event.key === "ArrowUp") {
      const midTurn =
        current >= 0 && wraps[current].getBoundingClientRect().top < top - 4;
      const next = midTurn ? current : current - 1;
      scrollFeedToTurn(wraps[Math.max(0, next)]);
      return;
    }
    const next = current + 1;
    if (next >= wraps.length) {
      pinChatToBottom();
      scheduleFeedUpdate();
      return;
    }
    scrollFeedToTurn(wraps[next]);
  }

  if (messagesEl) {
    messagesEl.addEventListener("scroll", scheduleFeedUpdate, {
      passive: true,
    });
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(scheduleFeedUpdate).observe(messagesEl, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(scheduleFeedUpdate).observe(messagesEl);
    }
    messagesEl.addEventListener(
      "click",
      (event) => {
        const expand = event.target.closest?.(".msg-expand");
        if (expand && messagesEl.contains(expand)) {
          event.preventDefault();
          event.stopPropagation();
          toggleLongUserMessage(expand);
        }
      },
      true
    );
  }
  document.addEventListener("keydown", onFeedTurnKey);
  // The panel can be resized / maximized / revealed without the chat list
  // itself mutating — re-center the turn map on those too.
  window.addEventListener("resize", scheduleFeedUpdate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleFeedUpdate();
    }
  });
