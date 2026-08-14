
  function ensureNotificationAudioContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    if (
      !notificationAudioContext ||
      notificationAudioContext.state === "closed"
    ) {
      notificationAudioContext = new AudioContextCtor();
    }
    return notificationAudioContext;
  }

  function unlockNotificationAudio() {
    const ctx = ensureNotificationAudioContext();
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
  }

  function scheduleNotificationTone(ctx, frequency, start, duration) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + Math.max(0.05, duration)
    );
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playRunFinishedSound(outcome) {
    const ctx = ensureNotificationAudioContext();
    if (!ctx) {
      return;
    }
    const play = () => {
      const start = ctx.currentTime + 0.02;
      if (outcome === "error") {
        scheduleNotificationTone(ctx, 220, start, 0.16);
        scheduleNotificationTone(ctx, 165, start + 0.17, 0.24);
      } else {
        scheduleNotificationTone(ctx, 523.25, start, 0.12);
        scheduleNotificationTone(ctx, 659.25, start + 0.13, 0.2);
      }
    };
    if (ctx.state === "suspended") {
      void ctx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  }

  document.addEventListener("pointerdown", unlockNotificationAudio, {
    once: true,
    capture: true,
  });
  document.addEventListener("keydown", unlockNotificationAudio, {
    once: true,
    capture: true,
  });

