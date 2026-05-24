# Convenience wrappers around build.py. The script remains the source of
# truth — every target here just shells out to it.
#
# Examples:
#   make                 # = make build
#   make build           # build all extensions + regenerate marketplace.json
#   make build-<id>      # build only that extension (e.g. make build-mangaupdates)
#   make dev             # generate <id>.dev.json for every extension
#   make dev-<id>        # generate <id>.dev.json for one extension
#   make new TYPE=plugin ID=my-thing
#   make clean           # remove generated <id>.js / <id>.json / <id>.dev.json
#
# Pattern rules use `$*` (the wildcard match) — `make build-mangaupdates`
# expands to `python3 build.py mangaupdates`.

PY := python3

.PHONY: help build new dev clean

help:
	@echo "Targets:"
	@echo "  build              Build all extensions + regen marketplace.json"
	@echo "  build-<id>         Build a single extension by id"
	@echo "  build-no-mkt       Build all but skip marketplace.json regen"
	@echo "  dev                Generate <id>.dev.json for every extension"
	@echo "  dev-<id>           Generate <id>.dev.json for one extension"
	@echo "  new TYPE=<t> ID=<i> Scaffold a new extension under src/<t>/<i>/"
	@echo "  clean              Remove built .js / .json / .dev.json artifacts"

build:
	$(PY) build.py

build-no-mkt:
	$(PY) build.py --no-marketplace

build-%:
	$(PY) build.py $*

dev:
	$(PY) build.py dev

dev-%:
	$(PY) build.py dev $*

new:
	@if [ -z "$(TYPE)" ] || [ -z "$(ID)" ]; then \
		echo "Usage: make new TYPE=<custom-source|manga-provider|anime-torrent-provider|onlinestream-provider|plugin> ID=<id>"; \
		exit 2; \
	fi
	$(PY) build.py new $(TYPE) $(ID)

# Removes built artifacts (the .js payload and the manifest with embedded
# payloadURI), plus any local .dev.json files. Source (code.ts, manifest
# template, README, icon.*) is preserved.
clean:
	@find src -type f \( \
		-name '*.js' \
		-o -name '*.dev.json' \
		\) -print -delete
	@for tpl in $$(find src -name 'manifest.template.json'); do \
		dir=$$(dirname $$tpl); \
		id=$$($(PY) -c "import json,sys; print(json.load(open('$$tpl'))['id'])"); \
		test -f "$$dir/$$id.json" && rm -v "$$dir/$$id.json" || true; \
	done
