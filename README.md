# Pim

A web interface for your native Pi coding sessions. Follow agents, send messages, and manage conversations across projects from your browser.

Pi runs the agent and keeps its normal session files. Pim connects to that same runtime, so you can move between the terminal and browser without starting a second agent.

## Features

- Browse live and saved sessions, grouped by project.
- Follow streaming responses, tool activity, and code diffs.
- Send prompts, steer running agents, and attach images.
- Switch models and thinking levels.
- Explore conversation branches and continue from earlier messages.
- Create, resume, and stop Pim-managed sessions.
- Track running agents, input requests, and unread completions across browsers.

An iOS-first mobile app is also in development, currently with read-only session previews.

## How it works

Pim has three parts:

- **Server:** runs on your machine and connects your Pi sessions to your clients.
- **Pi extension:** runs inside each native Pi session, sends updates to the server, and receives commands from it.
- **Clients:** the web frontend and iOS app connect to the same server. You can follow the same sessions from multiple devices. The iOS app is currently read-only.

```text
Pi + extension ─┐                  ┌─ Web browser
Pi + extension ─┼─ Pim server ─────┼─ Web browser
Pi + extension ─┘                  └─ iOS app
```

The agent always runs in Pi, not in the server or clients. Closing a client or the server does not stop your agents.

## Self-hosted

Designed for a trusted LAN or Tailscale network. There is no application authentication. Anyone who can reach the server can control connected agents, so do not expose it publicly.
