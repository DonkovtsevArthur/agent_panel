  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        if (msg.chatId) {
          activeChatId = msg.chatId;
        }
        fillModels(msg.models, msg.selectedModel, true);
        if (msg.fontSize != null) {
          applyUiFontSize(msg.fontSize);
        }
        if (msg.modes) {
          applyModes(msg.modes);
        }
        applySelectedMode(msg.selectedMode, { notify: false });
        applySelectedReasoningEffort(msg.selectedReasoningEffort, {
          notify: false,
        });
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        editingReasoningEffort = "";
        editingAttachments = [];
        pickAttachmentsForEdit = false;
        clearPendingAttachments();
        clearPendingMentions();
        setCanRegenerate(msg.canRegenerate);
        applyAgentStatusState(
          msg.status?.text || "",
          Boolean(msg.status?.hidden),
          msg.status?.phase,
          msg.status?.modelLabel || ""
        );
        renderMessages(msg.uiMessages || [], "restore", msg.scrollTop);
        if (msg.agentId) {
          activeAgentId = msg.agentId;
        }
        if (chatAgentNameEl && msg.agentName && renamingAgentId !== activeAgentId) {
          chatAgentNameEl.textContent = msg.agentName;
        }
        if (chatTitleEl && msg.chatTitle) {
          chatTitleEl.textContent = msg.chatTitle;
        }
        if (msg.contextMax !== undefined || msg.contextUsed !== undefined) {
          setContextUsage(msg.contextUsed || 0, msg.contextMax || contextMax);
        }
        renderChatBranches(msg.branches);
        showScreen(msg.screen || "agents");
        setBusy(Boolean(msg.busy));
        renderMessageQueue();
        break;
      case "attachmentsAdded":
        if (pickAttachmentsForEdit) {
          // Picker was opened from the edit-composer "+" — attachments go to
          // the message being edited, not the main composer draft.
          pickAttachmentsForEdit = false;
          mergeEditingAttachments(msg.attachments || []);
        } else {
          mergePendingAttachments(msg.attachments || []);
        }
        break;
      case "fileSearchResults":
        handleMentionResults(msg);
        break;
      case "chatSearchResults":
        if (
          !chatSearchOpen ||
          (chatSearchPendingRequestId &&
            msg.requestId &&
            msg.requestId !== chatSearchPendingRequestId)
        ) {
          break;
        }
        renderChatSearchResults(
          msg.hits || [],
          chatSearchInput ? chatSearchInput.value : ""
        );
        break;
      case "agentsList":
        agentsData = Array.isArray(msg.agents) ? msg.agents : [];
        {
          const active = agentsData.find((a) => a.active);
          if (active) {
            activeAgentId = active.id;
          }
        }
        renderAgentsList();
        if (msg.screen === "agents" || msg.screen === "chat") {
          showScreen(msg.screen);
        }
        break;
      case "archiveList":
        archiveAgentsData = Array.isArray(msg.agents) ? msg.agents : [];
        renderArchiveList();
        showScreen("archive");
        break;
      case "showAgents":
        showScreen("agents");
        setBusy(Boolean(msg.busy));
        break;
      case "showArchive":
        showScreen("archive");
        setBusy(Boolean(msg.busy));
        break;
      case "showSettings":
        showScreen("settings");
        showSettingsCategory(msg.openMcp ? "mcp" : "models");
        setBusy(Boolean(msg.busy));
        break;
      case "openChatSearch":
        openChatSearch({ fromAgents: false });
        break;
      case "settings":
        fillSettings(msg.settings);
        if (UI_SURFACE === "settings" && settingsScreen && settingsScreen.hidden) {
          showScreen("settings");
        }
        break;
      case "uiFontSize":
        applyUiFontSize(msg.fontSize);
        break;
      case "providerModelsListed":
        onProviderModelsListed(msg);
        break;
      case "figmaStatus":
        renderFigmaStatus(msg.status || {});
        break;
      case "providerConnStatus":
        renderProviderConnStatus(msg.status || {});
        break;
      case "mcpServers":
        mcpServersCache = Array.isArray(msg.servers) ? msg.servers : [];
        renderMcpServersList();
        break;
      case "skillsList":
        skillsCache = {
          enabled: msg.enabled !== false,
          directories: Array.isArray(msg.directories) ? msg.directories : [],
          skills: Array.isArray(msg.skills) ? msg.skills : [],
        };
        renderSkillsSettings();
        break;
      case "figmaNeedsConnect":
        showCopyToast(t("figmaNeedsConnectToast"));
        break;
      case "showChat":
        if (msg.chatId) {
          activeChatId = msg.chatId;
        }
        if (msg.models) {
          fillModels(msg.models, msg.selectedModel, true);
        }
        if (msg.fontSize != null) {
          applyUiFontSize(msg.fontSize);
        }
        applySelectedMode(msg.selectedMode, { notify: false });
        applySelectedReasoningEffort(msg.selectedReasoningEffort, {
          notify: false,
        });
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        setCanRegenerate(msg.canRegenerate);
        applyAgentStatusState(
          msg.status?.text || "",
          Boolean(msg.status?.hidden),
          msg.status?.phase,
          msg.status?.modelLabel || ""
        );
        if (msg.providerConnStatus) {
          renderProviderConnStatus(msg.providerConnStatus);
        }
        if (msg.uiMessages) {
          renderMessages(msg.uiMessages, "restore", msg.scrollTop);
        }
        if (msg.agentId) {
          activeAgentId = msg.agentId;
        }
        syncActiveAgentHighlight();
        renderChatBranches(msg.branches);
        if (
          chatAgentNameEl &&
          msg.agentName &&
          renamingAgentId !== activeAgentId
        ) {
          chatAgentNameEl.textContent = msg.agentName;
        }
        if (chatTitleEl && msg.chatTitle) {
          chatTitleEl.textContent = msg.chatTitle;
        }
        if (msg.contextMax !== undefined || msg.contextUsed !== undefined) {
          setContextUsage(msg.contextUsed || 0, msg.contextMax || contextMax);
        }
        showScreen("chat");
        setBusy(Boolean(msg.busy));
        renderMessageQueue();
        {
          const highlight =
            typeof msg.highlightMessageIndex === "number"
              ? msg.highlightMessageIndex
              : pendingHighlightIndex;
          pendingHighlightIndex = null;
          if (pendingOpenSearch) {
            const opts = pendingOpenSearch;
            pendingOpenSearch = null;
            openChatSearch(opts);
          } else if (typeof highlight === "number") {
            requestAnimationFrame(() => {
              highlightMessageByIndex(highlight);
            });
          }
        }
        break;
      case "insertComposerText":
        insertComposerText(msg.text || "");
        setBusy(false);
        break;
      case "insertComposerMentions":
        insertComposerMentions(msg.paths);
        setBusy(false);
        forceHarborUiRepaint();
        break;
      case "insertComposerSelection":
        addPendingSelection(msg.selection);
        setBusy(false);
        forceHarborUiRepaint();
        break;
      case "agentRenamed":
        if (msg.agentId && msg.name) {
          const item = agentsData.find((a) => a.id === msg.agentId);
          if (item) {
            item.name = msg.name;
          }
          if (msg.agentId === activeAgentId && chatAgentNameEl) {
            if (renamingAgentId !== msg.agentId) {
              chatAgentNameEl.textContent = msg.name;
            }
          }
          if (msg.agentId === activeAgentId && chatTitleEl && msg.name) {
            chatTitleEl.textContent = msg.name;
          }
          if (msg.agentId === activeAgentId && Array.isArray(msg.branches)) {
            renderChatBranches(msg.branches);
          }
          if (renamingAgentId !== msg.agentId) {
            renderAgentsList();
          }
        }
        break;
      case "contextUsage":
        setContextUsage(msg.used || 0, msg.max || contextMax);
        break;
      case "modelsUpdated":
        fillModels(msg.models, msg.selectedModel);
        if (msg.selectedReasoningEffort !== undefined) {
          applySelectedReasoningEffort(msg.selectedReasoningEffort, {
            notify: false,
          });
        } else {
          updateReasonPickerVisibility();
        }
        break;
      case "modesUpdated":
        applyModes(msg.modes);
        break;
      case "regenerateState":
        if (msg.selectedModel) {
          fillModels(models, msg.selectedModel, true);
        }
        setCanRegenerate(msg.canRegenerate);
        ensureRegenerateButton();
        break;
      case "messagesReplaced":
        if (msg.selectedModel) {
          fillModels(models, msg.selectedModel, true);
        }
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        editingReasoningEffort = "";
        editingAttachments = [];
        pickAttachmentsForEdit = false;
        setCanRegenerate(msg.canRegenerate);
        renderMessages(msg.uiMessages || []);
        break;
      case "copied":
        showCopyToast(t("copied"));
        break;
      case "runFinished":
        playRunFinishedSound(msg.outcome === "error" ? "error" : "success");
        break;
      case "runFailed":
        if (msg.chatId && !activeChatId) {
          activeChatId = msg.chatId;
        }
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        finishRunWithError(msg.text || "", msg.detail || "");
        break;
      case "append":
        if (msg.chatId && !activeChatId) {
          activeChatId = msg.chatId;
        }
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        if (msg.role === "error") {
          finishRunWithError(msg.text || "", msg.detail || "");
          break;
        }
        uiMessagesCache.push({
          role: msg.role,
          text: msg.text,
          attachments: msg.attachments,
          ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
          ...(msg.step ? { step: msg.step } : {}),
          ...(msg.detail ? { detail: msg.detail } : {}),
        });
        appendMessage(
          msg.role,
          msg.text,
          uiMessagesCache.length - 1,
          -1,
          msg.attachments,
          true,
          msg.reasoning,
          msg.step,
          msg.detail
        );
        if (msg.role === "assistant") {
          if (
            !presentProposedPlan(msg.text || "", {
              openEditor: true,
              reveal: "editor",
            })
          ) {
            syncComposerPlanFromCache({ openEditor: false });
          }
        }
        break;
      case "livePlanForBuild": {
        const text = stripPlanImplementWrapper(msg.text || "");
        if (!text) {
          break;
        }
        sendImplementPlanWithText(text);
        break;
      }
      case "step":
        upsertAgentStep(msg);
        break;
      case "status":
        if (!msg.chatId || msg.chatId === activeChatId) {
          setAgentStatus(
            msg.text || "",
            Boolean(msg.hidden),
            msg.phase,
            msg.modelLabel || ""
          );
        }
        break;
      case "review":
        uiMessagesCache.push({
          role: "review",
          text: JSON.stringify({ files: msg.files || [], showScm: msg.showScm }),
        });
        appendReview(msg.files || [], msg.showScm);
        break;
      case "scmButtons":
        applyScmButtons(msg.reviews || []);
        break;
      case "assistantDelta":
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        // Remount can leave streamingEl pointing at a detached node.
        if (streamingEl && !streamingEl.isConnected) {
          streamingEl = null;
        }
        if (!streamingEl) {
          streamingEl = appendMessage("assistant", "");
          streamingEl.dataset.raw = "";
        }
        streamingEl.dataset.raw = (streamingEl.dataset.raw || "") + msg.text;
        if (!streamingRenderScheduled) {
          streamingRenderScheduled = true;
          requestAnimationFrame(() => {
            streamingRenderScheduled = false;
            if (streamingEl && streamingEl.isConnected) {
              setMessageContent(
                streamingEl,
                "assistant",
                streamingEl.dataset.raw || ""
              );
              scrollToBottom();
            }
          });
        }
        break;
      case "assistantStreamClear":
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        if (streamingEl) {
          const wrap = streamingEl.closest(".msg-wrap-assistant");
          (wrap || streamingEl).remove();
          streamingEl = null;
        }
        streamingRenderScheduled = false;
        break;
      case "assistantDone": {
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        if (streamingEl && !streamingEl.isConnected) {
          streamingEl = null;
        }
        const incomingText = String(msg.text || "");
        // Host may re-send the finale after idle (catch-up). Skip duplicates.
        const alreadyCached = uiMessagesCache.some(
          (m, i) =>
            i >= Math.max(0, uiMessagesCache.length - 6) &&
            m?.role === "assistant" &&
            String(m.text || "") === incomingText &&
            Boolean(incomingText)
        );
        let assistantDoneText = "";
        if (alreadyCached) {
          assistantDoneText = incomingText;
          if (streamingEl) {
            if (streamingEl.isConnected) {
              setMessageContent(
                streamingEl,
                "assistant",
                incomingText || streamingEl.dataset.raw || ""
              );
            }
            streamingEl = null;
          }
          sealToolGroups();
          cleanSealedThinkingPlaceholders();
        } else if (!streamingEl && incomingText) {
          assistantDoneText = incomingText;
          uiMessagesCache.push({
            role: "assistant",
            text: incomingText,
            ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
          });
          // Reasoning already rendered via live steps — do not upsert again
          // (that raced after seal and duplicated Thinking).
          // Append text FIRST so sealToolGroups can detect assistant text in
          // the .chat-turn and drop placeholder-only Thinking cards.
          appendMessage(
            "assistant",
            incomingText,
            uiMessagesCache.length - 1,
            canRegenerate ? uiMessagesCache.length - 1 : -1,
            undefined,
            true,
            undefined
          );
          sealToolGroups();
          cleanSealedThinkingPlaceholders();
        } else if (streamingEl) {
          const raw = incomingText || streamingEl.dataset.raw || "";
          assistantDoneText = raw;
          setMessageContent(streamingEl, "assistant", raw);
          uiMessagesCache.push({
            role: "assistant",
            text: raw,
            ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
          });
          streamingEl.dataset.index = String(uiMessagesCache.length - 1);
          sealToolGroups();
          cleanSealedThinkingPlaceholders();
        }
        streamingEl = null;
        streamingRenderScheduled = false;
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        setBusy(false);
        ensureRegenerateButton();
        // Re-sync Build from history: hide if Build already ran; show only for
        // a fresh unanswered plan (do not resurrect after implement).
        if (
          assistantDoneText &&
          !presentProposedPlan(assistantDoneText, {
            openEditor: true,
            reveal: "editor",
          })
        ) {
          syncComposerPlanFromCache({ openEditor: false });
        } else if (!assistantDoneText) {
          syncComposerPlanFromCache({ openEditor: false });
        }
        break;
      }
      case "reasoning":
        // Live Thinking comes from step events. Late/duplicate reasoning
        // messages must not open a second card after seal.
        if (msg.text) {
          upsertReasoning(msg.text);
          dedupeTurnTimelines();
          scrollToBottom();
        }
        break;
      case "idle":
        // Only ignore when both sides know a chat id and they disagree.
        // If activeChatId was never hydrated (empty), still clear busy —
        // otherwise a 500 leaves the Stop button stuck forever.
        if (msg.chatId && !activeChatId) {
          activeChatId = msg.chatId;
        }
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        // If assistantDone never arrived, commit whatever streamed so far
        // instead of orphaning a visible bubble without a cache entry.
        if (streamingEl && streamingEl.isConnected) {
          const raw = String(streamingEl.dataset.raw || "").trim();
          if (raw) {
            const last = uiMessagesCache[uiMessagesCache.length - 1];
            if (!(last?.role === "assistant" && String(last.text || "") === raw)) {
              uiMessagesCache.push({ role: "assistant", text: raw });
              streamingEl.dataset.index = String(uiMessagesCache.length - 1);
            }
          }
        }
        streamingEl = null;
        streamingRenderScheduled = false;
        sealToolGroups();
        markFailedToolGroups();
        // If retries show API 5xx but the host never delivered runFailed/append,
        // synthesize the error bubble so the user is not stuck on «Работаю…».
        if (
          busy &&
          !uiMessagesCache.some(
            (m, i) =>
              i >= uiMessagesCache.length - 3 && m && m.role === "error"
          )
        ) {
          const failedGroup = [...messagesEl.querySelectorAll(".tool-group")].find(
            (g) => g.dataset.failed === "1" || timelineLooksLikeTransportFailure(g)
          );
          if (failedGroup) {
            finishRunWithError(t("runFailedTransport"));
            break;
          }
        }
        setAgentStatus("", true);
        setIdleAndDrain();
        break;
      case "stopped":
        if (msg.chatId && !activeChatId) {
          activeChatId = msg.chatId;
        }
        if (msg.chatId && activeChatId && msg.chatId !== activeChatId) {
          break;
        }
        clearStoppedRunArtifacts();
        sealToolGroups();
        setAgentStatus("", true);
        setIdleAndDrain();
        break;
      case "cleared":
        messagesEl.innerHTML = "";
        uiMessagesCache = [];
        editingUserIndex = null;
        editingUserText = "";
        editingModelId = "";
        editingModeId = "";
        streamingEl = null;
        setComposerPlanBuild("", false);
        lastOpenedPlanKey = "";
        setAgentStatus("", true);
        setContextUsage(0, contextMax);
        clearMessageQueue(activeChatId || msg.chatId);
        setBusy(false);
        break;
    }
  });

  host.postMessage({ type: "ready", surface: UI_SURFACE });
  setContextUsage(0, contextMax);
  restoreDraftPrompt();

  // если init потерялся — перезапросим модели
  setTimeout(() => {
    if (UI_SURFACE === "panel" && !models.length) {
      host.postMessage({ type: "ready", surface: UI_SURFACE });
    }
  }, 400);
