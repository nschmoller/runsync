pidfile := ".server.pid"

# Start the dev server in the background (loads .env)
start:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f {{pidfile}} ] && kill -0 "$(cat {{pidfile}})" 2>/dev/null; then
        echo "Server already running (pid $(cat {{pidfile}}))"
        exit 0
    fi
    node --env-file=.env src/server.js > server.log 2>&1 &
    echo $! > {{pidfile}}
    echo "Server started (pid $!), logs in server.log"

# Stop the dev server
stop:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f {{pidfile}} ] || ! kill -0 "$(cat {{pidfile}})" 2>/dev/null; then
        echo "Server not running"
        rm -f {{pidfile}}
        exit 0
    fi
    kill "$(cat {{pidfile}})"
    rm -f {{pidfile}}
    echo "Server stopped"
