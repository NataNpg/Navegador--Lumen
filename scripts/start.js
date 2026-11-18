'use strict';

// Electron refuses to start a GUI when ELECTRON_RUN_AS_NODE is inherited from
// the environment (common in agent shells), so strip it before launching.
const { spawn } = require('node:child_process');
const path = require('node:path');

const electronPath = require('electron');
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [process.cwd(), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  process.exit(typeof code === 'number' ? code : 0);
}); 