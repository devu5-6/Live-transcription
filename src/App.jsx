import { useEffect, useRef, useState, useMemo } from "react";

const TARGET_RATE = 16000;
const DEFAULT_PAUSE_MS = 10000; // 10 seconds default pause threshold

function downsampleToInt16(float32, inputRate) {
  if (inputRate === TARGET_RATE) {
    const pcm = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return pcm;
  }

  const ratio = inputRate / TARGET_RATE;
  const outputLength = Math.floor(float32.length / ratio);
  const pcm = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), float32.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += float32[j];
    const average = end > start ? sum / (end - start) : 0;
    const sample = Math.max(-1, Math.min(1, average));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return pcm;
}

function formatTimer(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(remMins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function joinTranscript(existing, addition) {
  if (!existing) return addition || "";
  if (!addition) return existing || "";
  const trimmedExisting = existing.trim();
  const trimmedAddition = addition.trim();
  if (!trimmedExisting) return trimmedAddition;
  if (!trimmedAddition) return trimmedExisting;

  if (/^[.,?!;:]/.test(trimmedAddition)) {
    return `${trimmedExisting}${trimmedAddition}`;
  }
  return `${trimmedExisting} ${trimmedAddition}`;
}

export default function App() {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [lines, setLines] = useState([]);
  const [partials, setPartials] = useState({});
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [audioLevels, setAudioLevels] = useState({ microphone: 0, system: 0 });
  const [pauseThresholdMs, setPauseThresholdMs] = useState(DEFAULT_PAUSE_MS);

  // UI Controls
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all"); // 'all' | 'microphone' | 'system'
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedLineId, setCopiedLineId] = useState(null);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);

  const searchInputRef = useRef(null);

  // Global keyboard shortcuts (Ctrl+K or Cmd+K to focus search)
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  const scrollContainerRef = useRef(null);
  const lastLevelUpdateRef = useRef({ microphone: 0, system: 0 });
  const timerIntervalRef = useRef(null);

  // Keep latest mutable references for the IPC callback closure
  const pauseThresholdRef = useRef(pauseThresholdMs);
  pauseThresholdRef.current = pauseThresholdMs;

  const sessionSecondsRef = useRef(sessionSeconds);
  sessionSecondsRef.current = sessionSeconds;

  // Session duration stopwatch
  useEffect(() => {
    if (listening) {
      setSessionSeconds(0);
      timerIntervalRef.current = setInterval(() => {
        setSessionSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [listening]);

  // IPC Event Listeners with 10-second pause aggregation
  useEffect(() => {
    if (!window.transcriptionAPI) return;

    const removeResultListener = window.transcriptionAPI.onResult(({ source, text, isFinal }) => {
      const trimmedText = text?.trim();
      if (!trimmedText) return;

      const now = Date.now();

      if (isFinal) {
        setLines((currentLines) => {
          if (currentLines.length === 0) {
            return [
              {
                id: crypto.randomUUID(),
                source,
                text: trimmedText,
                time: new Date(),
                lastUpdated: now,
                offsetSeconds: sessionSecondsRef.current
              }
            ];
          }

          const lastIndex = currentLines.length - 1;
          const currentLast = currentLines[lastIndex];
          const elapsed = now - (currentLast.lastUpdated || 0);

          // If same speaker and elapsed pause is LESS than threshold (10 seconds), combine into single box
          if (currentLast.source === source && elapsed < pauseThresholdRef.current) {
            const updated = {
              ...currentLast,
              text: joinTranscript(currentLast.text, trimmedText),
              lastUpdated: now
            };
            const nextLines = [...currentLines];
            nextLines[lastIndex] = updated;
            return nextLines;
          } else {
            // Speaker changed OR pause was >= 10 seconds: start a new box
            return [
              ...currentLines,
              {
                id: crypto.randomUUID(),
                source,
                text: trimmedText,
                time: new Date(),
                lastUpdated: now,
                offsetSeconds: sessionSecondsRef.current
              }
            ];
          }
        });

        setPartials((current) => ({ ...current, [source]: "" }));
      } else {
        setPartials((current) => ({ ...current, [source]: trimmedText }));
      }
    });

    const removeStatusListener = window.transcriptionAPI.onStatus(({ message, type }) => {
      setStatus(message);
      if (type === "error") setError(message);
    });

    return () => {
      removeResultListener?.();
      removeStatusListener?.();
    };
  }, []);

  // Auto-scroll to bottom when content changes if user hasn't scrolled up
  useEffect(() => {
    if (isScrolledToBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [lines, partials, isScrolledToBottom]);

  function handleScroll(e) {
    const el = e.target;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsScrolledToBottom(distanceToBottom < 60);
  }

  function scrollToBottom() {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
      setIsScrolledToBottom(true);
    }
  }

  async function attachAudioProcessor(stream, source) {
    const audioContext = new AudioContext();
    await audioContext.resume();

    const input = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const pcm = downsampleToInt16(inputData, audioContext.sampleRate);
      window.transcriptionAPI?.sendAudio(source, pcm.buffer);

      // Throttled RMS volume calculation for live audio level meter
      const now = performance.now();
      if (now - lastLevelUpdateRef.current[source] > 90) {
        lastLevelUpdateRef.current[source] = now;
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const normalized = Math.min(1, Math.max(0, (rms - 0.005) * 8));
        setAudioLevels((prev) => ({ ...prev, [source]: normalized }));
      }
    };

    input.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);

    resources.current.push({ stream, audioContext, input, processor, silentGain });
  }

  async function startListening() {
    setError("");
    setStatus("Connecting...");

    try {
      if (!window.transcriptionAPI) {
        throw new Error("Electron transcription API not found. Please run inside the Electron app.");
      }

      await window.transcriptionAPI.start();

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      await attachAudioProcessor(micStream, "microphone");

      const systemStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      systemStream.getVideoTracks().forEach((track) => track.stop());

      if (!systemStream.getAudioTracks().length) {
        systemStream.getTracks().forEach((track) => track.stop());
        throw new Error("System audio was not available. Check that loopback is supported.");
      }

      await attachAudioProcessor(systemStream, "system");
      setListening(true);
      setStatus("Active");
      setIsScrolledToBottom(true);
    } catch (err) {
      await cleanupAudio();
      await window.transcriptionAPI?.stop().catch(() => {});
      setError(err?.message || "Could not start audio capture.");
      setStatus("Error");
    }
  }

  async function cleanupAudio() {
    for (const item of resources.current) {
      try {
        item.processor.disconnect();
        item.input.disconnect();
        item.silentGain.disconnect();
        item.stream.getTracks().forEach((track) => track.stop());
        await item.audioContext.close();
      } catch {
        // Safe cleanup
      }
    }
    resources.current = [];
    setAudioLevels({ microphone: 0, system: 0 });
  }

  async function stopListening() {
    setListening(false);
    await cleanupAudio();
    await window.transcriptionAPI?.stop();
    setStatus("Stopped");
  }

  function clearTranscript() {
    setLines([]);
    setPartials({});
    setSessionSeconds(0);
  }

  function copyAllToClipboard() {
    if (!lines.length) return;
    const text = lines
      .map(
        (l) =>
          `[${formatTime(l.time)}] ${l.source === "microphone" ? "You" : "Call Audio"}: ${l.text}`
      )
      .join("\n\n");
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }

  function copyLine(line) {
    navigator.clipboard.writeText(line.text);
    setCopiedLineId(line.id);
    setTimeout(() => setCopiedLineId(null), 1500);
  }

  function exportTranscript() {
    if (!lines.length) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    const content = [
      `# Call Transcription — ${new Date().toLocaleString()}`,
      `Duration: ${formatTimer(sessionSeconds)}`,
      `Total turns: ${lines.length}`,
      `Pause threshold: ${pauseThresholdMs / 1000}s`,
      "",
      "---",
      "",
      ...lines.map(
        (l) =>
          `**${l.source === "microphone" ? "You" : "Caller / System Audio"}** (${formatTime(l.time)}):\n${l.text}\n`
      )
    ].join("\n");

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `transcript-${dateStr}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Determine which partials attach directly to the last active box
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;

  function isPartialAttachedToLastLine(source) {
    if (!lastLine) return false;
    if (lastLine.source !== source) return false;
    const elapsed = Date.now() - (lastLine.lastUpdated || 0);
    return elapsed < pauseThresholdMs;
  }

  // Filtered & Searched Lines
  const filteredLines = useMemo(() => {
    return lines.filter((line) => {
      if (activeFilter !== "all" && line.source !== activeFilter) return false;
      if (searchQuery.trim()) {
        return line.text.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [lines, activeFilter, searchQuery]);

  // Partials that do NOT attach to the last line (i.e. start a new box)
  const visibleUnattachedPartials = Object.entries(partials).filter(
    ([source, text]) => {
      if (!text) return false;
      if (activeFilter !== "all" && activeFilter !== source) return false;
      if (isPartialAttachedToLastLine(source)) return false;
      return true;
    }
  );

  const totalWords = useMemo(() => {
    return lines.reduce((acc, l) => acc + l.text.trim().split(/\s+/).filter(Boolean).length, 0);
  }, [lines]);

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon-wrapper">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <div>
            <div className="brand-title">
              Live Transcription
              <span className="badge-model">Nova-3</span>
            </div>
            <div className="brand-subtitle">Real-time dual channel capture: microphone & system audio</div>
          </div>
        </div>

        <div className="header-status-area">
          {listening && (
            <div className="session-timer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatTimer(sessionSeconds)}
            </div>
          )}

          <div className={`status-pill ${listening ? "active" : ""}`}>
            <span className="status-indicator-dot" />
            {listening ? "RECORDING" : "IDLE"}
          </div>
        </div>
      </header>

      {/* Control Bar */}
      <section className="control-bar">
        <div className="audio-sources-group">
          {/* Mic source */}
          <div className={`source-item mic ${listening ? "active" : ""}`}>
            <div className="source-icon-badge">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </div>
            <div className="source-details">
              <div className="source-name">
                Microphone
                <div className="audio-meter-bars" title="Input level">
                  <div className="audio-bar" style={{ height: `${Math.max(3, audioLevels.microphone * 14)}px` }} />
                  <div className="audio-bar" style={{ height: `${Math.max(3, audioLevels.microphone * 12 + 1)}px` }} />
                  <div className="audio-bar" style={{ height: `${Math.max(3, audioLevels.microphone * 15)}px` }} />
                </div>
              </div>
              <span className="source-desc">Your voice</span>
            </div>
          </div>

          {/* System audio source */}
          <div className={`source-item system ${listening ? "active" : ""}`}>
            <div className="source-icon-badge">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            </div>
            <div className="source-details">
              <div className="source-name">
                System Audio
                <div className="audio-meter-bars" title="Output level">
                  <div className="audio-bar" style={{ height: `${Math.max(3, audioLevels.system * 14)}px` }} />
                  <div className="audio-bar" style={{ height: `${Math.max(3, audioLevels.system * 12 + 1)}px` }} />
                  <div className="audio-bar" style={{ height: `${Math.max(3, audioLevels.system * 15)}px` }} />
                </div>
              </div>
              <span className="source-desc">Caller / Other voices</span>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="controls-actions">
          {!listening ? (
            <button className="btn-primary" onClick={startListening}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Start Recording
            </button>
          ) : (
            <button className="btn-danger" onClick={stopListening}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              Stop
            </button>
          )}

          <button className="btn-secondary" onClick={clearTranscript} title="Clear text">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Clear
          </button>
        </div>
      </section>

      {/* Error Banner */}
      {error && (
        <div className="alert-banner">
          <div className="alert-banner-content">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
          <button className="alert-close" onClick={() => setError("")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Main Transcript Card */}
      <section className="transcript-card">
        {/* Toolbar */}
        <div className="transcript-toolbar">
          {/* Filter Pills */}
          <div className="filter-tabs">
            <button
              className={`tab-btn ${activeFilter === "all" ? "active" : ""}`}
              onClick={() => setActiveFilter("all")}
            >
              All Speakers ({lines.length})
            </button>
            <button
              className={`tab-btn ${activeFilter === "microphone" ? "active" : ""}`}
              onClick={() => setActiveFilter("microphone")}
            >
              You ({lines.filter((l) => l.source === "microphone").length})
            </button>
            <button
              className={`tab-btn ${activeFilter === "system" ? "active" : ""}`}
              onClick={() => setActiveFilter("system")}
            >
              Call Audio ({lines.filter((l) => l.source === "system").length})
            </button>
          </div>

          {/* Pause threshold setting */}
          <div className="pause-setting" title="Maximum silence before splitting into a new box">
            <label>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Pause split:</span>
            </label>
            <select
              className="pause-select"
              value={pauseThresholdMs}
              onChange={(e) => setPauseThresholdMs(Number(e.target.value))}
            >
              <option value={5000}>5s</option>
              <option value={10000}>10s (default)</option>
              <option value={15000}>15s</option>
              <option value={20000}>20s</option>
            </select>
          </div>

          {/* Search box */}
          <div className="search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search transcript (Ctrl+K)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} style={{ color: "var(--text-muted)" }}>
                ✕
              </button>
            )}
          </div>

          {/* Export / Copy Actions */}
          <div className="transcript-actions">
            <button
              className="btn-icon-only"
              onClick={copyAllToClipboard}
              disabled={lines.length === 0}
              title={copiedAll ? "Copied!" : "Copy Full Transcript"}
            >
              {copiedAll ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>

            <button
              className="btn-icon-only"
              onClick={exportTranscript}
              disabled={lines.length === 0}
              title="Export as Markdown (.md)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable Conversation Stream */}
        <div className="transcript-body" ref={scrollContainerRef} onScroll={handleScroll}>
          {filteredLines.length === 0 && visibleUnattachedPartials.length === 0 ? (
            <div className="empty-view">
              <div className="empty-graphic">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3>
                {searchQuery
                  ? "No matching transcript lines found"
                  : listening
                  ? "Listening for speech..."
                  : "Ready for live transcription"}
              </h3>
              <p>
                {searchQuery
                  ? "Try searching for a different word or phrase."
                  : listening
                  ? "Speak or play call audio. Phrases are grouped together into one box unless you pause for 10 seconds."
                  : "Click 'Start Recording' to begin capturing voice and system call audio in real time."}
              </p>
            </div>
          ) : (
            <>
              {filteredLines.map((line) => {
                const isMic = line.source === "microphone";
                const isCurrentLast = lastLine && line.id === lastLine.id;
                const hasAttachedPartial =
                  isCurrentLast &&
                  isPartialAttachedToLastLine(line.source) &&
                  Boolean(partials[line.source]);

                return (
                  <article className="utterance-row" key={line.id}>
                    <div className={`speaker-avatar ${isMic ? "mic" : "system"}`}>
                      {isMic ? "ME" : "IN"}
                    </div>
                    <div className="utterance-content">
                      <div className="utterance-meta">
                        <span className="speaker-label">{isMic ? "You" : "Call Audio"}</span>
                        <span className="timestamp">{formatTime(line.time)}</span>
                      </div>
                      <p className="utterance-text">
                        {line.text}
                        {hasAttachedPartial && (
                          <span className="live-partial-stream">
                            {" "}{partials[line.source]}
                            <span className="live-cursor" />
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="utterance-actions">
                      <button className="btn-copy-line" onClick={() => copyLine(line)}>
                        {copiedLineId === line.id ? (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Copied
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </article>
                );
              })}

              {/* Streaming Unattached Partials (new speaker or after >10s pause) */}
              {visibleUnattachedPartials.map(([source, text]) => {
                const isMic = source === "microphone";
                return (
                  <article className={`utterance-row partial ${isMic ? "mic" : "system"}`} key={source}>
                    <div className={`speaker-avatar ${isMic ? "mic" : "system"}`}>
                      {isMic ? "ME" : "IN"}
                    </div>
                    <div className="utterance-content">
                      <div className="utterance-meta">
                        <span className="speaker-label">{isMic ? "You" : "Call Audio"}</span>
                        <span className="timestamp">transcribing...</span>
                      </div>
                      <p className="utterance-text">
                        {text}
                        <span className="live-cursor" />
                      </p>
                    </div>
                  </article>
                );
              })}
            </>
          )}
        </div>

        {/* Floating Scroll to Bottom Button */}
        {!isScrolledToBottom && lines.length > 2 && (
          <button className="btn-scroll-bottom" onClick={scrollToBottom}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
            Jump to latest
          </button>
        )}
      </section>

      {/* Footer Info & Stats */}
      <footer className="app-footer">
        <div className="footer-stats">
          <div className="footer-stat-item">
            Status: <span className="stat-value">{status}</span>
          </div>
          <div className="footer-stat-item">
            Turns: <span className="stat-value">{lines.length}</span>
          </div>
          <div className="footer-stat-item">
            Words: <span className="stat-value">{totalWords}</span>
          </div>
        </div>
        <div className="footer-notice">
          Live stream via Deepgram WebSocket API. Speech is grouped into continuous turns with a 10s pause split.
        </div>
      </footer>
    </div>
  );
}
