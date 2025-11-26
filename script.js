// Propulsion Test Stand Safety Interlock Simulator
// -----------------------------------------------
// High-level safety logic only (NOT real control software).

document.addEventListener("DOMContentLoaded", () => {
  // DOM references
  const systemStateEl = document.getElementById("systemState");
  const runIdEl = document.getElementById("runId");
  const sequenceStepEl = document.getElementById("sequenceStep");
  const sequenceProgressEl = document.getElementById("sequenceProgress");
  const logEl = document.getElementById("log");

  const btnReset = document.getElementById("btnReset");
  const btnArm = document.getElementById("btnArm");
  const btnStart = document.getElementById("btnStart");
  const btnAbort = document.getElementById("btnAbort");
  const btnEstop = document.getElementById("btnEstop");
  const btnInjectRandomFault = document.getElementById("btnInjectRandomFault");

  const permInputs = {
    personnelClear: document.getElementById("permPersonnelClear"),
    ventOpen: document.getElementById("permVentOpen"),
    daqReady: document.getElementById("permDAQReady"),
    gasStable: document.getElementById("permGasStable"),
    emergencyHealthy: document.getElementById("permEmergencyHealthy")
  };

  const permIndicators = {
    personnelClear: document.getElementById("permPersonnelClearIndicator"),
    ventOpen: document.getElementById("permVentOpenIndicator"),
    daqReady: document.getElementById("permDAQReadyIndicator"),
    gasStable: document.getElementById("permGasStableIndicator"),
    emergencyHealthy: document.getElementById("permEmergencyHealthyIndicator")
  };

  const interlockIndicators = {
    overpressure: document.getElementById("ilOverpressureIndicator"),
    highTemp: document.getElementById("ilHighTempIndicator"),
    flame: document.getElementById("ilFlameIndicator"),
    telemetry: document.getElementById("ilTelemetryIndicator"),
    estop: document.getElementById("ilEstopIndicator")
  };

  const sensorTankPressure = document.getElementById("sensorTankPressure");
  const sensorTankPressureValue = document.getElementById("sensorTankPressureValue");

  const sensorChamberPressure = document.getElementById("sensorChamberPressure");
  const sensorChamberPressureValue = document.getElementById("sensorChamberPressureValue");

  const sensorTemperature = document.getElementById("sensorTemperature");
  const sensorTemperatureValue = document.getElementById("sensorTemperatureValue");

  const sensorFlameDetected = document.getElementById("sensorFlameDetected");
  const sensorTelemetryLost = document.getElementById("sensorTelemetryLost");

  const summaryPermissivesEl = document.getElementById("summaryPermissives");
  const summaryInterlocksEl = document.getElementById("summaryInterlocks");
  const summarySequenceEl = document.getElementById("summarySequence");

  // Simulator state
  const state = {
    mode: "IDLE", // IDLE, ARMED, CHILLDOWN, PRESSURIZE, IGNITION, BURN, SHUTDOWN, ABORT
    sequenceRunning: false,
    currentStepIndex: -1,
    sequenceTimer: null,
    interlocks: {
      overpressure: false,
      highTemp: false,
      flame: false,
      telemetry: false,
      estop: false
    },
    runId: null
  };

  const SEQUENCE_STEPS = [
    { name: "CHILLDOWN", durationMs: 4000 },
    { name: "PRESSURIZE", durationMs: 4000 },
    { name: "IGNITION", durationMs: 3500 },
    { name: "BURN", durationMs: 5500 },
    { name: "SHUTDOWN", durationMs: 3500 }
  ];

  const LIMITS = {
    tankOverpressurePsi: 750,
    chamberOverpressurePsi: 900,
    tempLimitC: 850
  };

  // Utility: logging
  function log(tag, level, message) {
    const entry = document.createElement("div");
    entry.className = "log-entry";

    const ts = new Date();
    const timeStr = ts.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.textContent = `[${timeStr}]`;

    const tagSpan = document.createElement("span");
    tagSpan.className = "log-tag";

    switch (level) {
      case "state":
        tagSpan.classList.add("log-tag-state");
        tagSpan.textContent = "[STATE]";
        break;
      case "abort":
        tagSpan.classList.add("log-tag-abort");
        tagSpan.textContent = "[ABORT]";
        break;
      case "fault":
        tagSpan.classList.add("log-tag-fault");
        tagSpan.textContent = "[FAULT]";
        break;
      default:
        tagSpan.classList.add("log-tag-info");
        tagSpan.textContent = `[${tag.toUpperCase()}]`;
    }

    const msgSpan = document.createElement("span");
    msgSpan.textContent = message;

    entry.appendChild(timeSpan);
    entry.appendChild(tagSpan);
    entry.appendChild(msgSpan);

    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function randomRunId() {
    const now = new Date();
    const dt = now.toISOString().slice(2, 10).replace(/-/g, "");
    const rand = Math.floor(Math.random() * 900 + 100); // 3 digits
    return `RUN-${dt}-${rand}`;
  }

  // UI helpers
  function setSystemStateBadge(mode) {
    systemStateEl.textContent = mode;
    systemStateEl.classList.remove(
      "badge-idle",
      "badge-armed",
      "badge-running",
      "badge-abort"
    );

    if (mode === "IDLE") {
      systemStateEl.classList.add("badge-idle");
    } else if (mode === "ARMED") {
      systemStateEl.classList.add("badge-armed");
    } else if (mode === "ABORT") {
      systemStateEl.classList.add("badge-abort");
    } else {
      systemStateEl.classList.add("badge-running");
    }
  }

  function setIndicator(indicatorEl, status) {
    indicatorEl.classList.remove("indicator-ok", "indicator-bad", "indicator-warn");
    if (status === "ok") {
      indicatorEl.classList.add("indicator-ok");
    } else if (status === "bad") {
      indicatorEl.classList.add("indicator-bad");
    } else if (status === "warn") {
      indicatorEl.classList.add("indicator-warn");
    }
  }

  function updateSummaryBadges(allPermissivesOK, anyInterlockActive) {
    summaryPermissivesEl.textContent = allPermissivesOK ? "YES" : "NO";
    summaryPermissivesEl.className =
      "summary-badge " + (allPermissivesOK ? "badge-ok" : "badge-bad");

    summaryInterlocksEl.textContent = anyInterlockActive ? "YES" : "NO";
    summaryInterlocksEl.className =
      "summary-badge " + (anyInterlockActive ? "badge-bad" : "badge-ok");

    summarySequenceEl.textContent = state.sequenceRunning ? "YES" : "NO";
    summarySequenceEl.className =
      "summary-badge " +
      (state.sequenceRunning ? "badge-running" : "badge-secondary");
  }

  // Logic: permissives and interlocks
  function evaluatePermissives() {
    const allOK =
      permInputs.personnelClear.checked &&
      permInputs.ventOpen.checked &&
      permInputs.daqReady.checked &&
      permInputs.gasStable.checked &&
      permInputs.emergencyHealthy.checked;

    // Indicator updates
    Object.entries(permInputs).forEach(([key, input]) => {
      setIndicator(permIndicators[key], input.checked ? "ok" : "bad");
    });

    return allOK;
  }

  function evaluateInterlocks() {
    const tank = Number(sensorTankPressure.value);
    const chamber = Number(sensorChamberPressure.value);
    const temp = Number(sensorTemperature.value);

    state.interlocks.overpressure =
      tank > LIMITS.tankOverpressurePsi || chamber > LIMITS.chamberOverpressurePsi;
    state.interlocks.highTemp = temp > LIMITS.tempLimitC;
    state.interlocks.flame = sensorFlameDetected.checked;
    state.interlocks.telemetry = sensorTelemetryLost.checked;
    // estop is set via handler

    setIndicator(
      interlockIndicators.overpressure,
      state.interlocks.overpressure ? "bad" : "ok"
    );
    setIndicator(
      interlockIndicators.highTemp,
      state.interlocks.highTemp ? "bad" : "ok"
    );
    setIndicator(
      interlockIndicators.flame,
      state.interlocks.flame ? "bad" : "ok"
    );
    setIndicator(
      interlockIndicators.telemetry,
      state.interlocks.telemetry ? "bad" : "ok"
    );
    setIndicator(
      interlockIndicators.estop,
      state.interlocks.estop ? "bad" : "ok"
    );

    const anyInterlock =
      state.interlocks.overpressure ||
      state.interlocks.highTemp ||
      state.interlocks.flame ||
      state.interlocks.telemetry ||
      state.interlocks.estop;

    return anyInterlock;
  }

  // Abort logic
  function performAbort(reason) {
    if (state.mode === "ABORT") return; // Already aborted

    state.mode = "ABORT";
    state.sequenceRunning = false;
    clearSequenceTimer();

    setSystemStateBadge("ABORT");
    sequenceStepEl.textContent = "ABORTED";
    sequenceProgressEl.style.width = "0%";

    btnArm.disabled = true;
    btnStart.disabled = true;
    btnAbort.disabled = true;

    log("ABORT", "abort", `System ABORTED: ${reason}`);
    updateSummaryBadges(evaluatePermissives(), evaluateInterlocks());
  }

  function clearSequenceTimer() {
    if (state.sequenceTimer) {
      clearTimeout(state.sequenceTimer);
      state.sequenceTimer = null;
    }
  }

  // Sequence logic
  function startSequence() {
    if (!state.runId) {
      state.runId = randomRunId();
      runIdEl.textContent = state.runId;
    }

    state.sequenceRunning = true;
    state.currentStepIndex = -1;
    log("SEQ", "info", "Beginning automated test sequence.");
    nextSequenceStep();
  }

  function nextSequenceStep() {
    state.currentStepIndex++;

    if (state.currentStepIndex >= SEQUENCE_STEPS.length) {
      // Sequence complete
      log("SEQ", "state", "Sequence completed successfully. System returning to IDLE.");
      state.sequenceRunning = false;
      state.mode = "IDLE";
      setSystemStateBadge("IDLE");
      sequenceStepEl.textContent = "COMPLETE";
      sequenceProgressEl.style.width = "100%";
      btnAbort.disabled = true;
      btnStart.disabled = true;
      btnArm.disabled = false;
      updateSummaryBadges(evaluatePermissives(), evaluateInterlocks());
      return;
    }

    const step = SEQUENCE_STEPS[state.currentStepIndex];
    state.mode = step.name;
    setSystemStateBadge(step.name);
    sequenceStepEl.textContent = step.name;

    const progressPercent =
      ((state.currentStepIndex + 1) / SEQUENCE_STEPS.length) * 100;
    sequenceProgressEl.style.width = `${progressPercent}%`;

    log(
      "SEQ",
      "state",
      `Entering ${step.name} phase (${step.durationMs / 1000}s).`
    );

    // Slightly adjust sensors for realism (without overriding user completely)
    if (step.name === "CHILLDOWN") {
      sensorChamberPressure.value = clampNumber(
        Number(sensorChamberPressure.value) + 50,
        0,
        1000
      );
      sensorTemperature.value = clampNumber(
        Number(sensorTemperature.value) - 20,
        0,
        1000
      );
    } else if (step.name === "PRESSURIZE") {
      sensorTankPressure.value = clampNumber(
        Number(sensorTankPressure.value) + 250,
        0,
        800
      );
    } else if (step.name === "IGNITION") {
      sensorChamberPressure.value = clampNumber(
        Number(sensorChamberPressure.value) + 250,
        0,
        1000
      );
      sensorFlameDetected.checked = false; // "expected" flame, so no interlock
    } else if (step.name === "BURN") {
      sensorChamberPressure.value = clampNumber(
        Number(sensorChamberPressure.value) + 150,
        0,
        1000
      );
      sensorTemperature.value = clampNumber(
        Number(sensorTemperature.value) + 200,
        0,
        1000
      );
    } else if (step.name === "SHUTDOWN") {
      sensorTankPressure.value = clampNumber(
        Number(sensorTankPressure.value) - 200,
        0,
        800
      );
      sensorChamberPressure.value = clampNumber(
        Number(sensorChamberPressure.value) - 300,
        0,
        1000
      );
    }

    // Update sensor displays
    syncSensorDisplayValues();
    // Re-evaluate interlocks after adjusting
    const anyInterlock = evaluateInterlocks();
    updateSummaryBadges(evaluatePermissives(), anyInterlock);

    if (anyInterlock) {
      performAbort(
        `Interlock active during ${step.name} phase — automatic shutdown.`
      );
      return;
    }

    // Schedule next step
    state.sequenceTimer = setTimeout(() => {
      // Check interlocks right before transitioning
      const anyInterlockNow = evaluateInterlocks();
      updateSummaryBadges(evaluatePermissives(), anyInterlockNow);

      if (anyInterlockNow) {
        performAbort(
          `Interlock active at end of ${step.name} phase — automatic shutdown.`
        );
      } else if (state.mode !== "ABORT") {
        nextSequenceStep();
      }
    }, step.durationMs);
  }

  function clampNumber(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function syncSensorDisplayValues() {
    sensorTankPressureValue.textContent = sensorTankPressure.value;
    sensorChamberPressureValue.textContent = sensorChamberPressure.value;
    sensorTemperatureValue.textContent = sensorTemperature.value;
  }

  // Random fault injection
  function injectRandomFault() {
    const faults = [
      "overpressure_tank",
      "overpressure_chamber",
      "high_temp",
      "flame",
      "telemetry",
      "vent_closed",
      "personnel_in_cell"
    ];

    const pick = faults[Math.floor(Math.random() * faults.length)];
    switch (pick) {
      case "overpressure_tank":
        sensorTankPressure.value = LIMITS.tankOverpressurePsi + 50;
        log("FAULT", "fault", "Injected fault: tank overpressure.");
        break;
      case "overpressure_chamber":
        sensorChamberPressure.value = LIMITS.chamberOverpressurePsi + 40;
        log("FAULT", "fault", "Injected fault: chamber overpressure.");
        break;
      case "high_temp":
        sensorTemperature.value = LIMITS.tempLimitC + 50;
        log("FAULT", "fault", "Injected fault: critical hardware over-temperature.");
        break;
      case "flame":
        sensorFlameDetected.checked = true;
        log("FAULT", "fault", "Injected fault: unexpected flame detected.");
        break;
      case "telemetry":
        sensorTelemetryLost.checked = true;
        log("FAULT", "fault", "Injected fault: telemetry link lost.");
        break;
      case "vent_closed":
        permInputs.ventOpen.checked = false;
        log("FAULT", "fault", "Injected fault: vent valve unexpectedly closed.");
        break;
      case "personnel_in_cell":
        permInputs.personnelClear.checked = false;
        log("FAULT", "fault", "Injected fault: personnel detected in test cell.");
        break;
    }

    syncSensorDisplayValues();
    const anyInterlock = evaluateInterlocks();
    const allPermissives = evaluatePermissives();
    updateSummaryBadges(allPermissives, anyInterlock);

    if (state.sequenceRunning && anyInterlock) {
      performAbort("Random fault triggered interlock.");
    }
  }

  // Event handlers
  Object.values(permInputs).forEach((input) => {
    input.addEventListener("change", () => {
      const allPermissives = evaluatePermissives();
      const anyInterlock = evaluateInterlocks();
      updateSummaryBadges(allPermissives, anyInterlock);

      if (state.mode === "IDLE" && allPermissives) {
        btnArm.disabled = false;
      } else if (!allPermissives && state.mode === "IDLE") {
        btnArm.disabled = true;
      }

      if (!allPermissives && state.mode === "ARMED") {
        performAbort("Permissive dropped while ARMED (configuration unsafe).");
      }
    });
  });

  [
    sensorTankPressure,
    sensorChamberPressure,
    sensorTemperature,
    sensorFlameDetected,
    sensorTelemetryLost
  ].forEach((input) => {
    input.addEventListener("input", () => {
      syncSensorDisplayValues();
      const anyInterlock = evaluateInterlocks();
      const allPermissives = evaluatePermissives();
      updateSummaryBadges(allPermissives, anyInterlock);

      if (anyInterlock && (state.mode !== "IDLE" || state.sequenceRunning)) {
        performAbort("Interlock triggered by sensor or status change.");
      }
    });

    // For checkboxes, also listen to "change" to catch click toggle
    input.addEventListener("change", () => {
      syncSensorDisplayValues();
      const anyInterlock = evaluateInterlocks();
      const allPermissives = evaluatePermissives();
      updateSummaryBadges(allPermissives, anyInterlock);

      if (anyInterlock && (state.mode !== "IDLE" || state.sequenceRunning)) {
        performAbort("Interlock triggered by sensor or status change.");
      }
    });
  });

  btnArm.addEventListener("click", () => {
    const allPermissives = evaluatePermissives();
    const anyInterlock = evaluateInterlocks();

    if (!allPermissives) {
      log("ARM", "info", "Cannot ARM — one or more permissives are not satisfied.");
      return;
    }
    if (anyInterlock) {
      log("ARM", "info", "Cannot ARM — interlock(s) active.");
      return;
    }

    state.mode = "ARMED";
    setSystemStateBadge("ARMED");
    btnArm.disabled = true;
    btnStart.disabled = false;
    btnAbort.disabled = false;

    if (!state.runId) {
      state.runId = randomRunId();
      runIdEl.textContent = state.runId;
    }

    log("ARM", "state", "System ARMED. Ready to start sequence.");
    updateSummaryBadges(allPermissives, anyInterlock);
  });

  btnStart.addEventListener("click", () => {
    const allPermissives = evaluatePermissives();
    const anyInterlock = evaluateInterlocks();

    if (!allPermissives) {
      log(
        "SEQ",
        "info",
        "Cannot start sequence — one or more permissives are not satisfied."
      );
      return;
    }
    if (anyInterlock) {
      log("SEQ", "info", "Cannot start sequence — interlock(s) active.");
      return;
    }
    if (state.mode !== "ARMED") {
      log("SEQ", "info", "Cannot start sequence — system is not ARMED.");
      return;
    }

    btnStart.disabled = true;
    btnArm.disabled = true;
    btnAbort.disabled = false;

    state.mode = "CHILLDOWN";
    setSystemStateBadge("CHILLDOWN");

    state.sequenceRunning = true;
    summarySequenceEl.textContent = "YES";
    log("SEQ", "state", "Sequence initiated.");
    startSequence();
  });

  btnAbort.addEventListener("click", () => {
    performAbort("Manual ABORT command issued.");
  });

  btnEstop.addEventListener("click", () => {
    state.interlocks.estop = true;
    setIndicator(interlockIndicators.estop, "bad");
    performAbort("Emergency STOP activated.");
  });

  btnReset.addEventListener("click", () => {
    clearSequenceTimer();

    // Reset state
    state.mode = "IDLE";
    state.sequenceRunning = false;
    state.currentStepIndex = -1;
    state.interlocks.overpressure = false;
    state.interlocks.highTemp = false;
    state.interlocks.flame = false;
    state.interlocks.telemetry = false;
    state.interlocks.estop = false;

    // Reset UI
    setSystemStateBadge("IDLE");
    sequenceStepEl.textContent = "—";
    sequenceProgressEl.style.width = "0%";

    Object.values(permInputs).forEach((input) => {
      input.checked = false;
    });

    sensorTankPressure.value = 50;
    sensorChamberPressure.value = 0;
    sensorTemperature.value = 25;
    sensorFlameDetected.checked = false;
    sensorTelemetryLost.checked = false;
    syncSensorDisplayValues();

    Object.values(interlockIndicators).forEach((ind) =>
      setIndicator(ind, "ok")
    );

    btnArm.disabled = true;
    btnStart.disabled = true;
    btnAbort.disabled = true;

    const allPermissives = evaluatePermissives();
    const anyInterlock = evaluateInterlocks();
    updateSummaryBadges(allPermissives, anyInterlock);

    log("SYS", "state", "System reset to IDLE. All interlocks cleared.");
  });

  btnInjectRandomFault.addEventListener("click", () => {
    injectRandomFault();
  });

  // Initial setup
  syncSensorDisplayValues();
  const allPermissivesInitial = evaluatePermissives();
  const anyInterlockInitial = evaluateInterlocks();
  updateSummaryBadges(allPermissivesInitial, anyInterlockInitial);
  log(
    "SYS",
    "state",
    "Simulator initialized. Configure permissives, then ARM and start the sequence."
  );
});
