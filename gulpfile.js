'use strict';

const gulp      = require('gulp');
const fs        = require('fs');

gulp.task('copySocketIo', done => {
    const socket = require.resolve('@iobroker/ws').replace(/\\/g, '/');
    fs.writeFileSync(__dirname + '/lib/socket.io.js', fs.readFileSync(socket));
    done();
});

gulp.task('default', gulp.series('copySocketIo'));