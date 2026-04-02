# kort-pi-config

Public repo: https://github.com/oliynykmax/kort-pi-config

## One-line prompt for an LLM

Copy and send this to your LLM:

```text
Update my pi extensions in https://github.com/oliynykmax/kort-pi-config by running /home/kort/kort-pi-config/scripts/sync-extensions.sh, verify no secrets are included, then commit and push.
```

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
