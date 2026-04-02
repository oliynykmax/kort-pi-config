# kort-pi-config

## One-line prompt for an LLM (for installing this config)

Copy and send this to your LLM:

```text
Install pi extensions from https://github.com/oliynykmax/kort-pi-config: clone the repo, copy extensions/ into ~/.pi/agent/extensions/, and restart pi.
```

## One-line prompt for an LLM (for repo owner updates)

Use this only for maintaining this repo:

```text
Sync my local pi extensions to https://github.com/oliynykmax/kort-pi-config by running /home/kort/kort-pi-config/scripts/sync-extensions.sh, check for secrets, then commit and push.
```

## Extensions in this config

- init-agents
- plan-mode
- self-update
- session-name
- todo
- trigger-compact

## Manual install

1. Clone:

```bash
git clone https://github.com/oliynykmax/kort-pi-config.git
```

2. Copy extensions to pi:

```bash
mkdir -p ~/.pi/agent/extensions
rsync -a kort-pi-config/extensions/ ~/.pi/agent/extensions/
```

3. Restart pi.

## Publish local extension changes

After editing local extensions in `~/.pi/agent/extensions`, run:

```bash
/home/kort/kort-pi-config/scripts/sync-extensions.sh
```
