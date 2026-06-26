.PHONY: build clean

COMMANDS := $(notdir $(wildcard cmd/*))

build:
	@for cmd in $(COMMANDS); do \
		echo "Building build/$$cmd ..."; \
		CGO_ENABLED=0 go build -o ../bin/$$cmd ./cmd/$$cmd; \
	done

clean:
	@for cmd in $(COMMANDS); do \
		rm -rf ../bin/$$cmd; \
	done
