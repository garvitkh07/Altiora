import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const LOCAL_DB_CONTAINER = "supabase_db_altiora-mvp";
const DEFAULT_RUNS = 20;
const PROCESS_TIMEOUT_MS = 30_000;
const SERVER_START_TIMEOUT_MS = 60_000;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlIdentifier(value) {
  assert(/^[a-z_][a-z0-9_]*$/.test(value), `Unsafe generated SQL identifier: ${value}`);
  return `public.${value}`;
}

function psqlArgs() {
  return [
    "exec",
    "-i",
    LOCAL_DB_CONTAINER,
    "psql",
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-At",
  ];
}

function localDatabaseIsRunning() {
  const result = spawnSync(
    "docker",
    ["ps", "--filter", `name=^/${LOCAL_DB_CONTAINER}$`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  );

  if (result.error) {
    fail(`Could not inspect Docker: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Docker did not list the local database container: ${result.stderr || result.stdout}`);
  }

  assert(
    result.stdout.trim() === LOCAL_DB_CONTAINER,
    `Local Supabase database container ${LOCAL_DB_CONTAINER} is not running. Start the local Supabase stack first.`,
  );
}

function parseEnvironmentOutput(output) {
  const values = {};

  for (const line of output.split(/\r?\n/)) {
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const name = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }

  return values;
}

function getLocalSupabaseEnvironment() {
  const statusCommand = process.platform === "win32"
    ? process.env.ComSpec || "cmd.exe"
    : "npx";
  const statusArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx supabase status -o env"]
    : ["supabase", "status", "-o", "env"];
  const result = spawnSync(
    statusCommand,
    statusArgs,
    { encoding: "utf8", windowsHide: true },
  );

  if (result.error) {
    fail(`Could not inspect local Supabase status: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail("Local Supabase status could not be read. Refusing to start the HTTP test without local-target verification.");
  }

  const values = parseEnvironmentOutput(result.stdout);
  const apiUrlValue = values.API_URL;
  const anonKey = values.ANON_KEY;

  assert(apiUrlValue && anonKey, "Local Supabase status did not provide API_URL and ANON_KEY");

  let apiUrl;
  try {
    apiUrl = new URL(apiUrlValue);
  } catch {
    fail("Local Supabase API_URL is not a valid URL");
  }

  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  assert(apiUrl.protocol === "http:", "Refusing to run the HTTP test against a non-local or HTTPS Supabase API URL");
  assert(loopbackHosts.has(apiUrl.hostname), "Refusing to run the HTTP test against a non-loopback Supabase API URL");

  return {
    apiUrl: apiUrl.toString().replace(/\/$/, ""),
    anonKey,
  };
}

function runPsql(sql, timeoutMs = PROCESS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", psqlArgs(), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`psql timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(
          new Error(
            `psql exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}: ${stderr || stdout}`,
          ),
        );
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin.end(sql);
  });
}

function lastJsonLine(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const line = [...lines].reverse().find((candidate) => candidate.startsWith("{") && candidate.endsWith("}"));

  assert(line, `The local database query did not return a JSON result: ${stdout}`);

  try {
    return JSON.parse(line);
  } catch (error) {
    fail(`The local database query returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseRuns(argv) {
  const index = argv.indexOf("--runs");
  if (index === -1) {
    return DEFAULT_RUNS;
  }

  const value = Number(argv[index + 1]);
  assert(Number.isInteger(value) && value > 0 && value <= 100, "--runs must be an integer between 1 and 100");
  return value;
}

function makeFixture() {
  const suffix = randomUUID().replaceAll("-", "");
  const shortSuffix = suffix.slice(0, 16);
  return {
    runId: suffix,
    restaurantId: randomUUID(),
    categoryId: randomUUID(),
    menuItemId: randomUUID(),
    tableId: randomUUID(),
    restaurantSlug: `api-concurrency-${shortSuffix}`,
    tableToken: `api-concurrency-token-${shortSuffix}`,
  };
}

function setupSql(fixture) {
  return `
begin;

insert into public.restaurants (id, name, slug, currency)
values (${sqlString(fixture.restaurantId)}, 'HTTP Concurrency Test Restaurant', ${sqlString(fixture.restaurantSlug)}, 'INR');

insert into public.categories (id, restaurant_id, name)
values (${sqlString(fixture.categoryId)}, ${sqlString(fixture.restaurantId)}, 'HTTP Concurrency Test Category');

insert into public.menu_items (id, restaurant_id, category_id, name, price, is_veg, is_available)
values (${sqlString(fixture.menuItemId)}, ${sqlString(fixture.restaurantId)}, ${sqlString(fixture.categoryId)}, 'HTTP Concurrency Test Item', 12.50, true, true);

insert into public.restaurant_tables (id, restaurant_id, label, qr_token)
values (${sqlString(fixture.tableId)}, ${sqlString(fixture.restaurantId)}, 'HTTP Concurrency Test Table', ${sqlString(fixture.tableToken)});

commit;
`;
}

function stateSql(fixture, key) {
  return `
select json_build_object(
  'orders', coalesce((
    select json_agg(json_build_object(
      'id', o.id,
      'total_amount', o.total_amount,
      'status', o.status,
      'idempotency_key', o.idempotency_key,
      'request_fingerprint', o.request_fingerprint
    ) order by o.created_at)
    from public.orders as o
    where o.restaurant_id = ${sqlString(fixture.restaurantId)}
      and o.idempotency_key = ${sqlString(key)}
  ), '[]'::json),
  'items', coalesce((
    select json_agg(json_build_object(
      'order_id', oi.order_id,
      'menu_item_id', oi.menu_item_id,
      'quantity', oi.quantity,
      'unit_price_snapshot', oi.unit_price_snapshot,
      'line_total', oi.line_total,
      'special_instructions', oi.special_instructions
    ) order by oi.created_at)
    from public.order_items as oi
    join public.orders as o on o.id = oi.order_id
    where o.restaurant_id = ${sqlString(fixture.restaurantId)}
      and o.idempotency_key = ${sqlString(key)}
  ), '[]'::json)
)::text;
`;
}

function cleanupSql(fixture) {
  return `
begin;
delete from public.orders
where restaurant_id = ${sqlString(fixture.restaurantId)};
delete from public.restaurants
where id = ${sqlString(fixture.restaurantId)};
commit;
`;
}

async function findFreePort() {
  const { createServer } = await import("node:net");

  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object", "Could not allocate a local HTTP port");
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function startLocalNextServer(localSupabase) {
  const port = await findFreePort();
  const nextBin = fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url));
  const server = spawn(
    process.execPath,
    [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: localSupabase.apiUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: localSupabase.anonKey,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let serverExited = false;

  // Drain logs without recording or exposing environment/configuration data.
  server.stdout.resume();
  server.stderr.resume();
  server.once("close", () => {
    serverExited = true;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (serverExited) {
      throw new Error("The local Next.js server exited before becoming ready");
    }

    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status < 500) {
        return {
          server,
          baseUrl,
          stop: async () => stopServer(server),
        };
      }
    } catch {
      // The dev server is still compiling/listening.
    }

    await delay(250);
  }

  await stopServer(server);
  fail(`The local Next.js server did not become ready within ${SERVER_START_TIMEOUT_MS}ms`);
}

async function stopServer(server) {
  if (server.exitCode !== null) {
    return;
  }

  server.kill();
  await delay(500);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
}

function orderPayload(fixture, { quantity, orderInstructions, itemInstructions }) {
  return {
    restaurant_slug: fixture.restaurantSlug,
    table_token: fixture.tableToken,
    items: [
      {
        menu_item_id: fixture.menuItemId,
        quantity,
        special_instructions: itemInstructions,
      },
    ],
    special_instructions: orderInstructions,
  };
}

async function postOrder(baseUrl, request) {
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": request.key,
    },
    body: JSON.stringify(request.payload),
  });
  let body = null;

  try {
    body = await response.json();
  } catch {
    // The API contract is JSON; retain a null body so the assertion reports the failure.
  }

  return {
    participant: request.participant,
    status: response.status,
    body,
  };
}

async function runConcurrentHttpPair(baseUrl, requests) {
  let readyCount = 0;
  let release;
  const launchBarrier = new Promise((resolve) => {
    release = resolve;
  });

  const workers = requests.map(async (request) => {
    readyCount += 1;
    if (readyCount === requests.length) {
      release();
    }

    await launchBarrier;
    return postOrder(baseUrl, request);
  });

  return Promise.all(workers);
}

function responseOrderId(result) {
  return result.body && typeof result.body === "object" && "order_id" in result.body
    ? result.body.order_id
    : null;
}

function responseReplayFlag(result) {
  return result.body && typeof result.body === "object" && "replayed" in result.body
    ? result.body.replayed
    : null;
}

async function scenarioSamePayload(baseUrl, fixture, runNumber) {
  const key = `api-same-${fixture.runId}-${runNumber}`;
  const requests = [
    {
      participant: "a",
      key,
      payload: orderPayload(fixture, {
        quantity: 2,
        orderInstructions: "Same HTTP order instructions",
        itemInstructions: "Same HTTP item instructions",
      }),
    },
    {
      participant: "b",
      key,
      payload: orderPayload(fixture, {
        quantity: 2,
        orderInstructions: "Same HTTP order instructions",
        itemInstructions: "Same HTTP item instructions",
      }),
    },
  ];
  const responses = await runConcurrentHttpPair(baseUrl, requests);
  const state = lastJsonLine((await runPsql(stateSql(fixture, key))).stdout);
  const created = responses.filter((response) => response.status === 201);
  const replays = responses.filter((response) => response.status === 200);

  assert(created.length === 1, `HTTP Scenario A run ${runNumber}: expected exactly one HTTP 201 response`);
  assert(replays.length === 1, `HTTP Scenario A run ${runNumber}: expected exactly one HTTP 200 response`);
  assert(responseReplayFlag(created[0]) === false, `HTTP Scenario A run ${runNumber}: the 201 response must be replayed=false`);
  assert(responseReplayFlag(replays[0]) === true, `HTTP Scenario A run ${runNumber}: the 200 response must be replayed=true`);
  assert(responseOrderId(created[0]) === responseOrderId(replays[0]), `HTTP Scenario A run ${runNumber}: responses must identify the same order_id`);
  assert(state.orders.length === 1, `HTTP Scenario A run ${runNumber}: exactly one order must exist for the key`);
  assert(state.items.length === 1, `HTTP Scenario A run ${runNumber}: exactly one order item must exist`);
  assert(Number(state.orders[0].total_amount) === 25, `HTTP Scenario A run ${runNumber}: total must be 25.00`);
  assert(state.items[0].quantity === 2, `HTTP Scenario A run ${runNumber}: item quantity must be 2`);
  assert(Number(state.items[0].unit_price_snapshot) === 12.5, `HTTP Scenario A run ${runNumber}: item price snapshot must be 12.50`);
  assert(Number(state.items[0].line_total) === 25, `HTTP Scenario A run ${runNumber}: item line total must be 25.00`);

  return {
    statuses: responses.map((response) => response.status).sort((a, b) => a - b),
    orderId: responseOrderId(created[0]),
  };
}

async function scenarioDifferentPayloads(baseUrl, fixture, runNumber) {
  const key = `api-conflict-${fixture.runId}-${runNumber}`;
  const requests = [
    {
      participant: "a",
      key,
      payload: orderPayload(fixture, {
        quantity: 1,
        orderInstructions: "HTTP payload A",
        itemInstructions: "HTTP item A",
      }),
    },
    {
      participant: "b",
      key,
      payload: orderPayload(fixture, {
        quantity: 3,
        orderInstructions: "HTTP payload B",
        itemInstructions: "HTTP item B",
      }),
    },
  ];
  const responses = await runConcurrentHttpPair(baseUrl, requests);
  const state = lastJsonLine((await runPsql(stateSql(fixture, key))).stdout);
  const created = responses.filter((response) => response.status === 201);
  const conflicts = responses.filter((response) => response.status === 409);

  assert(created.length === 1, `HTTP Scenario B run ${runNumber}: expected exactly one HTTP 201 response`);
  assert(conflicts.length === 1, `HTTP Scenario B run ${runNumber}: expected exactly one HTTP 409 response`);
  assert(responseReplayFlag(created[0]) === false, `HTTP Scenario B run ${runNumber}: the winning response must be replayed=false`);
  assert(conflicts[0].body?.error === "This checkout attempt conflicts with another request. Please start a new order.", `HTTP Scenario B run ${runNumber}: conflict response body is incorrect`);
  assert(state.orders.length === 1, `HTTP Scenario B run ${runNumber}: exactly one order must exist for the key`);
  assert(state.items.length === 1, `HTTP Scenario B run ${runNumber}: the losing request must create no additional item`);

  const winningRequest = requests.find((request) => request.participant === created[0].participant);
  assert(winningRequest, `HTTP Scenario B run ${runNumber}: could not identify the winning payload`);

  const winningItem = winningRequest.payload.items[0];
  const expectedTotal = winningItem.quantity * 12.5;
  assert(Number(state.orders[0].total_amount) === expectedTotal, `HTTP Scenario B run ${runNumber}: stored total does not match the winning payload`);
  assert(state.items[0].quantity === winningItem.quantity, `HTTP Scenario B run ${runNumber}: stored quantity does not match the winning payload`);
  assert(state.items[0].special_instructions === winningItem.special_instructions, `HTTP Scenario B run ${runNumber}: stored item instructions do not match the winning payload`);

  return {
    statuses: responses.map((response) => response.status).sort((a, b) => a - b),
    winner: created[0].participant,
    orderId: responseOrderId(created[0]),
  };
}

async function main() {
  const runs = parseRuns(process.argv.slice(2));
  localDatabaseIsRunning();
  const localSupabase = getLocalSupabaseEnvironment();
  const fixture = makeFixture();
  let setupComplete = false;
  let localServer = null;

  try {
    await runPsql(setupSql(fixture));
    setupComplete = true;
    localServer = await startLocalNextServer(localSupabase);

    console.log("HTTP concurrency target verified: local loopback Next.js server with local Supabase API overrides.");

    for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
      const samePayload = await scenarioSamePayload(localServer.baseUrl, fixture, runNumber);
      const differentPayloads = await scenarioDifferentPayloads(localServer.baseUrl, fixture, runNumber);

      console.log(
        `run ${runNumber}/${runs}: Scenario A PASS (HTTP ${samePayload.statuses.join("/ ")}; order ${samePayload.orderId}); ` +
          `Scenario B PASS (HTTP ${differentPayloads.statuses.join("/")}; winner ${differentPayloads.winner}; order ${differentPayloads.orderId})`,
      );
    }

    console.log(`HTTP concurrency test PASS: ${runs} consecutive run${runs === 1 ? "" : "s"} succeeded for both scenarios.`);
  } finally {
    if (localServer) {
      await localServer.stop();
    }
    if (setupComplete) {
      await runPsql(cleanupSql(fixture));
    }
  }
}

main().catch((error) => {
  console.error(`HTTP concurrency test FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
