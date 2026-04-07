#!/usr/bin/env node
/**
 * Runs all 7 real-world scenario fixtures in sequence.
 *
 * Usage:
 *   node scripts/run-scenarios.js
 *   node scripts/run-scenarios.js --base-url http://localhost:54321/functions/v1
 *   node scripts/run-scenarios.js --only 3   # run only scenario 3
 *
 * Prerequisites:
 *   - Supabase edge functions running (local or remote)
 *   - SUPABASE_SERVICE_ROLE_KEY set (or hardcoded default used)
 *   - For outbound assertions: Twilio toll-free verification complete
 *
 * Each scenario uses unique phone prefixes (+1555121xxxx through +1555127xxxx)
 * so they don't collide if run back-to-back without cleanup.
 */
const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const onlyScenario = onlyIdx !== -1 ? parseInt(args[onlyIdx + 1]) : null;

const baseUrlIdx = args.indexOf('--base-url');
const baseUrlArg = baseUrlIdx !== -1 ? `--base-url ${args[baseUrlIdx + 1]}` : '';

const SCENARIOS = [
  { id: 1, file: 'scenario_1_late_joiner.json', name: 'The Late Joiner' },
  { id: 2, file: 'scenario_2_indecisive_group.json', name: 'The Indecisive Group' },
  { id: 3, file: 'scenario_3_budget_blowup.json', name: 'Budget Blowup' },
  { id: 4, file: 'scenario_4_ghost.json', name: 'The Ghost' },
  { id: 5, file: 'scenario_5_split_midtrip.json', name: 'SPLIT Mid-Trip' },
  { id: 6, file: 'scenario_6_keyword_gauntlet.json', name: 'Full Keyword Gauntlet' },
  { id: 7, file: 'scenario_7_conversation_chaos.json', name: 'Real Conversation Chaos' },
];

const toRun = onlyScenario
  ? SCENARIOS.filter((s) => s.id === onlyScenario)
  : SCENARIOS;

if (toRun.length === 0) {
  console.error(`No scenario found with id ${onlyScenario}`);
  process.exit(1);
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Rally SMS Bot — ${toRun.length} Scenario${toRun.length > 1 ? 's' : ''}`);
console.log(`${'═'.repeat(60)}\n`);

const results = [];

const cleanupScript = path.join(__dirname, 'cleanup-between-scenarios.js');

for (const scenario of toRun) {
  const fixturePath = path.join(__dirname, 'fixtures', scenario.file);
  const cmd = `node ${path.join(__dirname, 'simulate.js')} --script ${fixturePath} ${baseUrlArg}`.trim();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Scenario ${scenario.id}: ${scenario.name}`);
  console.log(`${'─'.repeat(50)}`);

  try {
    // Clean up between scenarios to prevent session state pollution
    // Also add a 3s pause to let edge function connections settle
    execSync(`node ${cleanupScript} && sleep 3`, { encoding: 'utf8', timeout: 15_000, env: process.env });
    console.log('  (sessions cleaned up)');
  } catch { /* ignore cleanup errors */ }

  try {
    // 5 min per scenario. Was 120s, which was tight even pre-classifier and
    // caused scenarios 4 & 6 to flake in bulk runs when accumulated network
    // latency pushed execution past 2 minutes. Each Haiku classifier call
    // adds ~500ms-2s, so scenarios with 20+ noisy messages can now legitimately
    // take 90-180s. 300s gives comfortable headroom without masking real hangs.
    const output = execSync(cmd, {
      encoding: 'utf8',
      timeout: 300_000,
      env: process.env,
    });
    console.log(output);
    results.push({ ...scenario, passed: true });
  } catch (err) {
    console.log(err.stdout || '');
    console.error(err.stderr || '');
    results.push({ ...scenario, passed: false });
  }
}

// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log('  RESULTS');
console.log(`${'═'.repeat(60)}\n`);

const passed = results.filter((r) => r.passed);
const failed = results.filter((r) => !r.passed);

for (const r of results) {
  const icon = r.passed ? '✅' : '❌';
  console.log(`  ${icon} Scenario ${r.id}: ${r.name}`);
}

console.log(`\n  ${passed.length}/${results.length} passed\n`);

if (failed.length > 0) process.exit(1);
