# Zene

**v0.5.6** — modular Discord application framework for Node.js  
TypeScript · pure ESM · Node ≥ 20 · discord.js v14

Credits: [VeduStorm](https://github.com/VeduStorm) · [Lunedusk](https://github.com/lunedusk)

---

## Why Zene

| | |
|---|---|
| **Plugins** | Isolated workspaces, dependency-ordered boot, signed manifests |
| **Permissions** | Ranked bits, role links, optional Discord permission mirror |
| **Storage** | SQLite · Postgres · Mongo · Redis · SurrealDB |
| **HTTP** | Tokens, audit, gates, dashboard admin APIs |
| **Cross-Host** | Optional multi-machine sharding (classic paths stay simple) |
| **UX** | Components V2 builders, atomic paginator, lang-backed errors |

---

## 60-second start

```bash
npm install
# create .env with at least:
#   DiscordToken=...
#   BotOwnerIds=your_discord_user_id
#   TokenMasterSecret=at_least_32_chars_if_using_token_plugin
npm run build
npm start
```

Full install and env: **[SETUP.md](SETUP.md)**  
Every variable: **[ENV Reference.md](ENV%20Reference.md)**

---

## Architecture (sketch)

```text
┌─────────────────────────────────────────────────────────┐
│  index.ts  →  BootPipeline  →  Client / Shard / Cross-Host │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐     ┌────────────────────────────────┐
│  PluginManager   │────▶│  Commands · Events · Handlers   │
│  Discovery       │     │  Routes · Middleware            │
│  IntegrityGate   │     └────────────────────────────────┘
│  Lifecycle       │
└──────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│  heart.*  — permissions · db · cache · lang · audit · …   │
└──────────────────────────────────────────────────────────┘
```

---

## Read next

| Doc | Audience |
|-----|----------|
| [SETUP.md](SETUP.md) | First boot, env, route probe |
| [ENV Reference.md](ENV%20Reference.md) | All environment keys |
| [PLUGINS.md](PLUGINS.md) | Writing plugins |
| [System Prompt - AI - Plugin.md](System%20Prompt%20-%20AI%20-%20Plugin.md) | Agent authoring contract |
| [Database.md](Database.md) | Engines and schemas |
| [CROSS_HOST.md](CROSS_HOST.md) | Multi-machine sharding |

---

## License

**PolyForm Noncommercial License 1.0.0** — free for personal and non-commercial use; commercial use requires a separate arrangement with the authors. See [LICENSE](LICENSE).
