ifneq ($(wildcard .env),)
    include .env
    export $(shell sed 's/=.*//' .env)
endif

ifneq ($(wildcard .env.local),)
    include .env.local
    export $(shell sed 's/=.*//' .env.local)
endif

.PHONY: dev-up dev-down

DOMAIN=example.com
GENERATED_ENV=config/generated-data.env
COMPOSE_DEV=docker-compose.yml

dev-up:
	@echo "Checking development environment prerequisites..."

	./bin/certs-up.sh $(DOMAIN)
	mkdir -p config && touch $(GENERATED_ENV)

	@echo "Booting core services..."
	docker compose -f $(COMPOSE_DEV) up -d \
		identity-link-database-server \
		identity-link-dnsmasq \
		identity-link-proxy \
		identity-link-redis \
		identity-link-core \
		identity-link-db-users \
		identity-link-db-clients \
		identity-link-2fa \
		identity-link-console \
		identity-link-adminer \
		identity-link-smtp-server

	@echo "Waiting for core services and database to be fully healthy..."
	docker compose -f $(COMPOSE_DEV) exec -T identity-link-core true || sleep 5

	@echo "Generating OIDC client credentials..."
	./bin/generate-data.sh > $(GENERATED_ENV)

	@echo "Booting dependent services..."
	docker compose -f $(COMPOSE_DEV) up -d

	@echo "Activating local split-horizon DNS routing..."
	./bin/dns-up.sh $(DOMAIN)
	@echo "Development environment is operational at https://$(DOMAIN)"

dev-down:
	@echo "Stopping environment and cleaning up..."
	./bin/dns-down.sh
	docker compose -f $(COMPOSE_DEV) down --remove-orphans
	@echo "Environment successfully stopped."

