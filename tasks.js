const { writeFileSync, readFileSync, copyFileSync} = require('node:fs');

const socket = require.resolve('@iobroker/ws').replace(/\\/g, '/');
writeFileSync(`${__dirname}/dist/lib/socket.io.js`, readFileSync(socket));

copyFileSync(`${__dirname}/src/types.d.ts`, `${__dirname}/dist/types.d.ts`);