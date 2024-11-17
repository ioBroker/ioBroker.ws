const { copyFileSync } = require('node:fs');

const socket = require.resolve('@iobroker/ws').replace(/\\/g, '/');
copyFileSync(socket, `${__dirname}/lib/socket.io.js`);
