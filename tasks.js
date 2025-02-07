const { writeFileSync, readFileSync } = require('node:fs');

const socket = require.resolve('@iobroker/ws').replace(/\\/g, '/');
writeFileSync(`${__dirname}/dist/lib/socket.io.js`, readFileSync(socket));
