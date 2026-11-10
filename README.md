# Live Call Transcription 🎙️

A real-time dual-channel desktop speech-to-text application built with **Electron**, **React 19**, **Vite**, and **Deepgram Nova-3**.

---

## 🚀 Features

- **Dual-Channel Live Capture**:
  - **Microphone**: Captures your local microphone input.
  - **System Audio**: Captures remote meeting / call participants using Windows loopback capture.
- **Smart Utterance Aggregation**:
  - Groups spoken words into a continuous turn box until a **10-second silence pause** is detected (customizable in the toolbar).
- **Live RMS Audio Visualizer**:
  - Real-time reactive audio meters for both your voice and incoming call audio.
- **Real-Time Streaming**:
  - Partial transcripts stream live with an animated cursor.
- **Minimal, Professional Dark UI**:
  - Linear/Raycast-inspired dark theme with Inter and JetBrains Mono typography.
  - Custom frameless-style title bar without clunky default menus.
- **Search & Filter**:
  - Instant filter by speaker (`All`, `You`, `Call Audio`).
  - Search across all transcript messages (`Ctrl+K` shortcut).
- **Export & Clipboard**:
  - One-click copy for the entire transcript or individual turns.
  - Export full meeting logs to clean Markdown (`.md`) format.

---

## 🛠️ Tech Stack

- **Desktop Framework**: Electron 39
- **Frontend**: React 19, Vite 7
- **AI Engine**: Deepgram WebSocket Streaming API (`nova-3` model)
- **Audio Processing**: Web Audio API (ScriptProcessor downsampled to 16kHz linear PCM)
- **Styling**: Modern CSS variables, glassmorphic accents, responsive grid

---

## 📦 Getting Started

### Prerequisites

- Node.js 18+ (tested on Node v24)
- Windows 10/11 (for system audio loopback capture)
- A Deepgram API key ([Sign up for Deepgram](https://deepgram.com))

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/devu5-6/Live-transcription.git
   cd Live-transcription
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your API key:
   Create a `.env` file in the project root:
   ```env
   DEEPGRAM_API_KEY=your_deepgram_api_key_here
   ```

4. Start the application in development mode:
   ```bash
   npm run dev
   ```

---

## 📝 License

MIT
