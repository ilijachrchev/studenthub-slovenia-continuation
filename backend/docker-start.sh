#!/bin/sh
set -e

RUN_MIGRATIONS_ON_STARTUP="${RUN_MIGRATIONS_ON_STARTUP:-true}"
RUN_SEEDS_ON_STARTUP="${RUN_SEEDS_ON_STARTUP:-true}"

if [ "${NODE_ENV:-development}" = "production" ]; then
  echo "Validating production configuration..."
  node -e "require('./config/runtime').validateProductionBootstrapConfig()"
fi

if [ "$RUN_MIGRATIONS_ON_STARTUP" = "true" ]; then
  echo "Running database migrations..."
  npx knex migrate:latest
fi

if [ "$RUN_SEEDS_ON_STARTUP" = "true" ]; then
  echo "Running database seeds..."
  npx knex seed:run
fi

echo "Starting server..."
exec node server.js
