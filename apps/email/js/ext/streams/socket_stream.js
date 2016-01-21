define(function (require) {
  'use strict';

  const util = require('util');

  /**
   * A Stream built from a mozTCPSocket. Data arrives in chunks to the readable
   * side of the stream; to send data, write to the writable side.
   */
  return function SocketStream(socket) {
    var socket = util.makeEventTarget(socket);

    function maybeCloseSocket() {
      if (socket.readyState !== 'closing' && socket.readyState !== 'closed') {
        socket.close();
      }
    }

    var out;

    this.readable = new streams.ReadableStream({
      start: function (c) {
        out = c;
        socket.addEventListener('data', function (evt) {
          c.enqueue(new Uint8Array(evt.data));
        });
        socket.addEventListener('close', function () {
          try {
            c.close();
          } catch (e) {
            // The stream has already been closed.
          }
        });
        socket.addEventListener('error', function (evt) {
          return c.error(evt.data || evt);
        });
      },
      cancel: function () {
        maybeCloseSocket();
      }
    });

    this.writable = new streams.WritableStream({
      start: function (error) {
        socket.addEventListener('error', function (evt) {
          return error(evt.data || evt);
        });
      },
      write: function (chunk) {
        socket.send(chunk);
        // We don't know when send completes, so this is synchronous.
      },
      close: function () {
        maybeCloseSocket();
      }
    });
  };
});
