const { writeFileSync, readFileSync } = require('fs');

const socket = require.resolve('@iobroker/ws').replace(/\\/g, '/');
writeFileSync(`${__dirname}/lib/socket.io.js`, readFileSync(socket));
