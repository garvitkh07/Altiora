import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const LOCAL_DB_CONTAINER = "supabase_db_altiora-mvp";
const DEFAULT_RUNS = 5;
const PROCESS_TIMEOUT_MS = 30_000;

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

  assert(line, `The psql worker did not return a JSON result: ${stdout}`);

  try {
    return JSON.parse(line);
  } catch (error) {
    fail(`The psql worker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
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
    barrierTable: `altiora_concurrency_barrier_${suffix}`,
    resultsTable: `altiora_concurrency_results_${suffix}`,
    restaurantId: randomUUID(),
    categoryId: randomUUID(),
    menuItemId: randomUUID(),
    tableId: randomUUID(),
    restaurantSlug: `concurrency-${shortSuffix}`,
    tableToken: `concurrency-token-${shortSuffix}`,
  };
}

function setupSql(fixture) {
  const barrier = sqlIdentifier(fixture.barrierTable);
  const results = sqlIdentifier(fixture.resultsTable);

  return `
begin;

create table ${barrier} (
  participant text primary key,
  ready boolean not null default false
);

insert into ${barrier} (participant)
values ('a'), ('b');

create table ${results} (
  run_id text not null,
  participant text not null,
  outcome text not null,
  backend_pid integer not null,
  order_id uuid,
  replayed boolean,
  total_amount numeric(12, 2),
  error_code text,
  error_message text,
  primary key (run_id, participant)
);

insert into public.restaurants (id, name, slug, currency)
values (${sqlString(fixture.restaurantId)}, 'Concurrency Test Restaurant', ${sqlString(fixture.restaurantSlug)}, 'INR');

insert into public.categories (id, restaurant_id, name)
values (${sqlString(fixture.categoryId)}, ${sqlString(fixture.restaurantId)}, 'Concurrency Test Category');

insert into public.menu_items (id, restaurant_id, category_id, name, price, is_veg, is_available)
values (${sqlString(fixture.menuItemId)}, ${sqlString(fixture.restaurantId)}, ${sqlString(fixture.categoryId)}, 'Concurrency Test Item', 12.50, true, true);

insert into public.restaurant_tables (id, restaurant_id, label, qr_token)
values (${sqlString(fixture.tableId)}, ${sqlString(fixture.restaurantId)}, 'Concurrency Test Table', ${sqlString(fixture.tableToken)});

commit;
`;
}

function resetBarrierSql(fixture) {
  const barrier = sqlIdentifier(fixture.barrierTable);
  const results = sqlIdentifier(fixture.resultsTable);

  return `
truncate table ${barrier}, ${results};
insert into ${barrier} (participant)
values ('a'), ('b');
`;
}

function participantSql({ fixture, participant, key, orderInstructions, itemInstructions, quantity }) {
  const barrier = sqlIdentifier(fixture.barrierTable);
  const results = sqlIdentifier(fixture.resultsTable);
  const items = `jsonb_build_array(jsonb_build_object(
    'menu_item_id', ${sqlString(fixture.menuItemId)},
    'quantity', ${quantity},
    'special_instructions', ${sqlString(itemInstructions)}
  ))`;

  return `
update ${barrier}
set ready = true
where participant = ${sqlString(participant)};

do $$
declare
  ready_count integer;
begin
  loop
    select count(*) into ready_count
    from ${barrier}
    where ready;

    exit when ready_count = 2;
    perform pg_sleep(0.005);
  end loop;

  perform pg_sleep(0.020);
end;
$$;

begin;

do $$
declare
  result_row record;
begin
  begin
    select *
      into result_row
    from public.create_order(
      ${sqlString(fixture.restaurantSlug)},
      ${sqlString(fixture.tableToken)},
      ${items},
      ${sqlString(orderInstructions)},
      ${sqlString(key)}
    );

    insert into ${results} (
      run_id, participant, outcome, backend_pid, order_id, replayed, total_amount
    ) values (
      ${sqlString(fixture.runId)},
      ${sqlString(participant)},
      'success',
      pg_backend_pid(),
      result_row.order_id,
      result_row.replayed,
      result_row.total_amount
    );
  exception when others then
    insert into ${results} (
      run_id, participant, outcome, backend_pid, error_code, error_message
    ) values (
      ${sqlString(fixture.runId)},
      ${sqlString(participant)},
      'error',
      pg_backend_pid(),
      sqlstate,
      sqlerrm
    );
  end;
end;
$$;

commit;

select json_build_object(
  'run_id', run_id,
  'participant', participant,
  'outcome', outcome,
  'backend_pid', backend_pid,
  'order_id', order_id,
  'replayed', replayed,
  'total_amount', total_amount,
  'error_code', error_code,
  'error_message', error_message
)::text
from ${results}
where run_id = ${sqlString(fixture.runId)}
  and participant = ${sqlString(participant)};
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
  const barrier = sqlIdentifier(fixture.barrierTable);
  const results = sqlIdentifier(fixture.resultsTable);

  return `
begin;
delete from public.orders
where restaurant_id = ${sqlString(fixture.restaurantId)};
delete from public.restaurants
where id = ${sqlString(fixture.restaurantId)};
drop table if exists ${barrier};
drop table if exists ${results};
commit;
`;
}

async function runConcurrentPair(fixture, requests) {
  await runPsql(resetBarrierSql(fixture));

  const workers = requests.map((request) =>
    runPsql(participantSql({ fixture, ...request })),
  );
  const settled = await Promise.allSettled(workers);
  const rejected = settled.find((result) => result.status === "rejected");

  if (rejected?.status === "rejected") {
    throw rejected.reason;
  }

  return settled.map((result) => lastJsonLine(result.value.stdout));
}

function assertIndependentConnections(results, label) {
  const backendPids = new Set(results.map((result) => result.backend_pid));
  assert(backendPids.size === 2, `${label}: workers did not use two independent PostgreSQL backend connections`);
}

async function scenarioSamePayload(fixture, runNumber) {
  const key = `concurrency-same-${fixture.runId}-${runNumber}`;
  const requests = [
    {
      participant: "a",
      key,
      orderInstructions: "Same order instructions",
      itemInstructions: "Same item instructions",
      quantity: 2,
    },
    {
      participant: "b",
      key,
      orderInstructions: "Same order instructions",
      itemInstructions: "Same item instructions",
      quantity: 2,
    },
  ];
  const results = await runConcurrentPair(fixture, requests);
  const state = lastJsonLine((await runPsql(stateSql(fixture, key))).stdout);

  assertIndependentConnections(results, `Scenario A run ${runNumber}`);
  assert(results.every((result) => result.outcome === "success"), `Scenario A run ${runNumber}: both requests must succeed`);
  assert(results.filter((result) => result.replayed === false).length === 1, `Scenario A run ${runNumber}: exactly one request must be new`);
  assert(results.filter((result) => result.replayed === true).length === 1, `Scenario A run ${runNumber}: exactly one request must be a replay`);
  assert(new Set(results.map((result) => result.order_id)).size === 1, `Scenario A run ${runNumber}: responses must share one order_id`);
  assert(state.orders.length === 1, `Scenario A run ${runNumber}: exactly one order must exist for the key`);
  assert(state.items.length === 1, `Scenario A run ${runNumber}: exactly one order item must exist`);
  assert(Number(state.orders[0].total_amount) === 25, `Scenario A run ${runNumber}: total must be 25.00`);
  assert(state.items[0].quantity === 2, `Scenario A run ${runNumber}: item quantity must be 2`);
  assert(Number(state.items[0].unit_price_snapshot) === 12.5, `Scenario A run ${runNumber}: item price snapshot must be 12.50`);
  assert(Number(state.items[0].line_total) === 25, `Scenario A run ${runNumber}: item line total must be 25.00`);

  return {
    results,
    orderId: results[0].order_id,
    backendPids: results.map((result) => result.backend_pid),
  };
}

async function scenarioDifferentPayloads(fixture, runNumber) {
  const key = `concurrency-conflict-${fixture.runId}-${runNumber}`;
  const requests = [
    {
      participant: "a",
      key,
      orderInstructions: "Payload A",
      itemInstructions: "Item A",
      quantity: 1,
    },
    {
      participant: "b",
      key,
      orderInstructions: "Payload B",
      itemInstructions: "Item B",
      quantity: 3,
    },
  ];
  const results = await runConcurrentPair(fixture, requests);
  const state = lastJsonLine((await runPsql(stateSql(fixture, key))).stdout);
  const successful = results.filter((result) => result.outcome === "success");
  const conflicts = results.filter((result) => result.outcome === "error" && result.error_code === "PZ001");

  assertIndependentConnections(results, `Scenario B run ${runNumber}`);
  assert(successful.length === 1, `Scenario B run ${runNumber}: exactly one request must succeed`);
  assert(conflicts.length === 1, `Scenario B run ${runNumber}: exactly one request must return PZ001`);
  assert(successful[0].replayed === false, `Scenario B run ${runNumber}: the winner must be a new order`);
  assert(state.orders.length === 1, `Scenario B run ${runNumber}: exactly one order must exist for the key`);
  assert(state.items.length === 1, `Scenario B run ${runNumber}: the loser must create no extra item`);

  const winningRequest = requests.find((request) => request.participant === successful[0].participant);
  assert(winningRequest, `Scenario B run ${runNumber}: could not identify the winning payload`);

  const expectedTotal = winningRequest.quantity * 12.5;
  assert(Number(state.orders[0].total_amount) === expectedTotal, `Scenario B run ${runNumber}: stored total does not match the winning payload`);
  assert(state.items[0].quantity === winningRequest.quantity, `Scenario B run ${runNumber}: stored quantity does not match the winning payload`);
  assert(state.items[0].special_instructions === winningRequest.itemInstructions, `Scenario B run ${runNumber}: stored item instructions do not match the winning payload`);

  return {
    results,
    winner: successful[0].participant,
    orderId: successful[0].order_id,
    backendPids: results.map((result) => result.backend_pid),
  };
}

async function main() {
  const runs = parseRuns(process.argv.slice(2));
  localDatabaseIsRunning();

  const fixture = makeFixture();
  let setupComplete = false;

  try {
    await runPsql(setupSql(fixture));
    setupComplete = true;

    for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
      const samePayload = await scenarioSamePayload(fixture, runNumber);
      const differentPayloads = await scenarioDifferentPayloads(fixture, runNumber);

      console.log(
        `run ${runNumber}/${runs}: Scenario A PASS (order ${samePayload.orderId}; backend pids ${samePayload.backendPids.join(", ")}); ` +
          `Scenario B PASS (winner ${differentPayloads.winner}; backend pids ${differentPayloads.backendPids.join(", ")})`,
      );
    }

    console.log(`Concurrency test PASS: ${runs} consecutive run${runs === 1 ? "" : "s"} succeeded for both scenarios.`);
  } finally {
    if (setupComplete) {
      await delay(25);
      await runPsql(cleanupSql(fixture));
    }
  }
}

main().catch((error) => {
  console.error(`Concurrency test FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
