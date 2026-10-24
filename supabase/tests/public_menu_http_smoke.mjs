import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const LOCAL_DB_CONTAINER = "supabase_db_altiora-mvp";
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
    ["inspect", "--format", "{{.State.Running}}", LOCAL_DB_CONTAINER],
    { encoding: "utf8", windowsHide: true },
  );

  if (result.error) {
    fail(`Could not inspect Docker: ${result.error.message}`);
  }

  if (result.status !== 0 || result.stdout.trim() !== "true") {
    fail(
      `Local Supabase database container ${LOCAL_DB_CONTAINER} is not running. ` +
        "Start the local Supabase stack first.",
    );
  }
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
    fail(
      "Local Supabase status could not be read. Refusing to start the HTTP smoke test without local-target verification.",
    );
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
  assert(
    apiUrl.protocol === "http:" && loopbackHosts.has(apiUrl.hostname),
    "Refusing to run the HTTP smoke test against a non-loopback Supabase API URL",
  );

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

function makeFixture() {
  const suffix = randomUUID().replaceAll("-", "");
  const shortSuffix = suffix.slice(0, 16);
  return {
    restaurantId: randomUUID(),
    categoryId: randomUUID(),
    menuItemId: randomUUID(),
    activeTableId: randomUUID(),
    inactiveTableId: randomUUID(),
    restaurantSlug: `http-menu-${shortSuffix}`,
    activeToken: `http-menu-active-${shortSuffix}`,
    inactiveToken: `http-menu-inactive-${shortSuffix}`,
    missingToken: `http-menu-missing-${shortSuffix}`,
    missingRestaurantSlug: `http-menu-missing-restaurant-${shortSuffix}`,
  };
}

function setupSql(fixture) {
  return `
begin;

insert into public.restaurants (id, name, slug, currency)
values (${sqlString(fixture.restaurantId)}, 'HTTP Menu Smoke Restaurant', ${sqlString(fixture.restaurantSlug)}, 'INR');

insert into public.categories (id, restaurant_id, name, description)
values (${sqlString(fixture.categoryId)}, ${sqlString(fixture.restaurantId)}, 'Smoke Category', 'HTTP menu smoke category');

insert into public.menu_items (id, restaurant_id, category_id, name, description, price, is_veg, is_available)
values (${sqlString(fixture.menuItemId)}, ${sqlString(fixture.restaurantId)}, ${sqlString(fixture.categoryId)}, 'Smoke Item', 'HTTP menu smoke item', 19.50, true, true);

insert into public.restaurant_tables (id, restaurant_id, label, qr_token, is_active)
values
  (${sqlString(fixture.activeTableId)}, ${sqlString(fixture.restaurantId)}, 'Smoke Active Table', ${sqlString(fixture.activeToken)}, true),
  (${sqlString(fixture.inactiveTableId)}, ${sqlString(fixture.restaurantId)}, 'Smoke Inactive Table', ${sqlString(fixture.inactiveToken)}, false);

commit;
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

select json_build_object(
  'restaurants', (select count(*) from public.restaurants where id = ${sqlString(fixture.restaurantId)}),
  'categories', (select count(*) from public.categories where id = ${sqlString(fixture.categoryId)}),
  'menu_items', (select count(*) from public.menu_items where id = ${sqlString(fixture.menuItemId)}),
  'active_table', (select count(*) from public.restaurant_tables where id = ${sqlString(fixture.activeTableId)}),
  'inactive_table', (select count(*) from public.restaurant_tables where id = ${sqlString(fixture.inactiveTableId)})
)::text;
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

function menuUrl(baseUrl, restaurantSlug, tableToken) {
  return `${baseUrl}/api/restaurants/${encodeURIComponent(restaurantSlug)}/table/${encodeURIComponent(tableToken)}`;
}

function redactedUrl(url) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/");
  segments[segments.length - 1] = "<redacted-table-token>";
  parsed.pathname = segments.join("/");
  return parsed.toString();
}

async function getMenu(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  let body = null;

  try {
    body = JSON.parse(text);
  } catch {
    // Keep the raw response unavailable in assertion failures; the route is
    // expected to return JSON for both success and error responses.
  }

  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    body,
  };
}

function assertErrorResponse(result, name) {
  assert(result.status === 404, `${name}: expected HTTP 404, received ${result.status}`);
  assert(result.contentType.includes("application/json"), `${name}: expected a JSON response`);
  assert(
    JSON.stringify(result.body) === JSON.stringify({
      error: "This menu or table is not available",
      message: "This menu or table is not available",
    }),
    `${name}: unexpected safe error response`,
  );
}

function assertSafePublicMenu(result, fixture, name) {
  assert(result.status === 200, `${name}: expected HTTP 200, received ${result.status}`);
  assert(result.contentType.includes("application/json"), `${name}: expected a JSON response`);
  assert(result.body && typeof result.body === "object", `${name}: expected a JSON object`);

  const topLevelKeys = Object.keys(result.body).sort();
  assert(
    JSON.stringify(topLevelKeys) === JSON.stringify(["categories", "currency", "items", "restaurant", "table"]),
    `${name}: response contains unexpected top-level fields`,
  );

  assert(result.body.currency === "INR", `${name}: currency is incorrect`);
  assert(result.body.restaurant?.slug === fixture.restaurantSlug, `${name}: restaurant slug is incorrect`);
  assert(result.body.table?.id === fixture.activeTableId, `${name}: table id is incorrect`);
  assert(result.body.table?.label === "Smoke Active Table", `${name}: table label is incorrect`);
  assert(Array.isArray(result.body.categories), `${name}: categories must be an array`);
  assert(Array.isArray(result.body.items), `${name}: items must be an array`);
  assert(result.body.items.length === 1, `${name}: expected one menu item`);

  const itemKeys = Object.keys(result.body.items[0]).sort();
  assert(
    JSON.stringify(itemKeys) === JSON.stringify([
      "allergens",
      "categoryId",
      "categoryName",
      "description",
      "id",
      "imageUrl",
      "isAvailable",
      "isVegetarian",
      "name",
      "originalPrice",
      "price",
    ]),
    `${name}: menu item contains unexpected fields`,
  );

  const serialized = JSON.stringify(result.body);
  assert(!serialized.includes(fixture.activeToken), `${name}: active raw qr_token leaked`);
  assert(!serialized.includes(fixture.inactiveToken), `${name}: inactive raw qr_token leaked`);
  assert(
    !/qr_token|service[_-]?role|access[_-]?token|password|permission|request_fingerprint|idempotency_key/i.test(serialized),
    `${name}: response contains secret or internal authorization metadata`,
  );
}

async function main() {
  localDatabaseIsRunning();
  const localSupabase = getLocalSupabaseEnvironment();
  const fixture = makeFixture();
  let setupComplete = false;
  let localServer = null;
  let testError = null;

  try {
    await runPsql(setupSql(fixture));
    setupComplete = true;
    localServer = await startLocalNextServer(localSupabase);

    const cases = [
      {
        name: "valid active table",
        url: menuUrl(localServer.baseUrl, fixture.restaurantSlug, fixture.activeToken),
        expected: "success",
      },
      {
        name: "invalid table token",
        url: menuUrl(localServer.baseUrl, fixture.restaurantSlug, "invalid-token"),
        expected: "error",
      },
      {
        name: "inactive table",
        url: menuUrl(localServer.baseUrl, fixture.restaurantSlug, fixture.inactiveToken),
        expected: "error",
      },
      {
        name: "missing table",
        url: menuUrl(localServer.baseUrl, fixture.restaurantSlug, fixture.missingToken),
        expected: "error",
      },
      {
        name: "missing restaurant",
        url: menuUrl(localServer.baseUrl, fixture.missingRestaurantSlug, fixture.activeToken),
        expected: "error",
      },
    ];

    for (const testCase of cases) {
      const result = await getMenu(testCase.url);
      if (testCase.expected === "success") {
        assertSafePublicMenu(result, fixture, testCase.name);
      } else {
        assertErrorResponse(result, testCase.name);
      }

      console.log(`${testCase.name}: GET ${redactedUrl(testCase.url)} -> HTTP ${result.status} PASS`);
    }

    console.log("Public menu HTTP smoke test PASS: all local route cases succeeded.");
  } catch (error) {
    testError = error;
  } finally {
    if (localServer) {
      await localServer.stop();
    }

    if (setupComplete) {
      const cleanupState = lastJsonLine((await runPsql(cleanupSql(fixture))).stdout);
      assert(
        cleanupState.restaurants === 0 &&
          cleanupState.categories === 0 &&
          cleanupState.menu_items === 0 &&
          cleanupState.active_table === 0 &&
          cleanupState.inactive_table === 0,
        "Fixture cleanup did not remove all generated rows",
      );
      console.log("Fixture cleanup PASS: generated restaurant, catalog, table, and dependent rows removed.");
    }
  }

  if (testError) {
    throw testError;
  }
}

main().catch((error) => {
  console.error(`Public menu HTTP smoke test FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
