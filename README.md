# 🍊 Orange – Music Player

**A fun experiment in recreating the Apple Music experience using AI-assisted development.**

🌐 **Live Demo:** https://musicorange.netlify.app  
📦 **Repository:** https://github.com/Nagababu-nivas/shiny-garbanzo

---

## 🎵 About the Project

Orange is a browser-based music player inspired by Apple's Music application.

I created this project for fun in my free time to experiment with **REA (Reasoning, Engineering and Architecture)** and explore how far AI-assisted development could go in recreating an existing application.

The goal was to replicate the overall Apple Music experience, including its interface, music discovery, playback controls, lyrics, and other features.

For this experiment, I used:

- **OpenCode** – AI coding agent.
- **DeepSeek V4.1 Flash (Free)** – AI model used for development.
- **REA** – Approach used to explore application analysis, reasoning, and implementation.

This was an experimental project, not an attempt to build a commercial music streaming platform.

## ✨ Features

- Apple Music-inspired user interface.
- Music search and discovery.
- Audius music integration.
- Local music file playback.
- Music queue management.
- Shuffle and repeat controls.
- Playback progress and volume controls.
- Equalizer.
- Synchronized lyrics using LRCLIB.
- Radio Paradise integration.
- Local music preferences and browser storage.
- Responsive interface.

## ⚠️ Playback Limitations

One of the current limitations is that online catalog playback may be restricted to approximately **30-second audio previews**, depending on the music source.

This is particularly relevant to catalog previews provided through the iTunes Search API.

Full-length playback is supported for compatible local audio files. Audius streaming is also integrated, but its full-length playback needs further testing and troubleshooting.

The project is still experimental, and playback limitations are part of the ongoing development.

## 🛠️ Technologies & Tools

| Category | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Music Discovery | iTunes Search API |
| Music Streaming | Audius API |
| Lyrics | LRCLIB API |
| Radio | Radio Paradise |
| Storage | LocalStorage, IndexedDB |
| AI Coding Agent | OpenCode |
| AI Model | DeepSeek V4.1 Flash (Free) |
| Deployment | Netlify |
| Version Control | Git, GitHub |

## 🚀 Run Locally

Clone the repository:

```bash
git clone https://github.com/Nagababu-nivas/shiny-garbanzo.git
```

Navigate to the project directory:

```bash
cd shiny-garbanzo/orange
```

Run the application:

```bash
python serve.py
```

Open the application in your browser:

```text
http://127.0.0.1:5173/
```

Alternatively, on Windows, you can launch it using:

```text
Orange.cmd
```

## 🌐 Live Deployment

Orange is hosted on Netlify.

Visit: https://musicorange.netlify.app

## 📌 Project Status

**Experimental / Personal Project**

This project was built primarily to explore AI-assisted software development and test the capabilities of an AI coding agent with a free AI model.

There is still room for improvement, particularly in:

- Full-length online music playback.
- Audius streaming reliability.
- Real-time synchronized lyrics.
- UI and playback refinements.
- Cross-device compatibility.

## ⚖️ Disclaimer

Orange is an independent experimental project inspired by the Apple Music interface.

It is not affiliated with, endorsed by, or associated with Apple Inc.

Music discovery and playback depend on third-party services and their respective availability, licensing, and access restrictions.

This project does not host or distribute copyrighted music files.

---

**Built for fun, curiosity, and experimentation with AI-assisted development. 🍊**
