❯ autoloop run autoqa -b kiro "qa the acp changes that landed"
[autoloops] [info] loop start run_id=run-mnnjjs3r-d3a0 max_iterations=100
file:///Users/mobrienv/Code/autoloop/dist/backend/kiro-bridge.js:42
        throw new Error("Failed to init kiro session: " + result.error);
              ^

Error: Failed to init kiro session: unknown command: undefined
    at initKiroSession (file:///Users/mobrienv/Code/autoloop/dist/backend/kiro-bridge.js:42:15)
    at Module.run (file:///Users/mobrienv/Code/autoloop/dist/harness/index.js:38:28)
    at dispatchRun (file:///Users/mobrienv/Code/autoloop/dist/commands/run.js:28:13)
    at dispatch (file:///Users/mobrienv/Code/autoloop/dist/main.js:31:13)
    at main (file:///Users/mobrienv/Code/autoloop/dist/main.js:19:5)
    at file:///Users/mobrienv/Code/autoloop/dist/main.js:116:1
    at ModuleJob.run (node:internal/modules/esm/module_job:413:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:660:26)

Node.js v24.12.0
