/**
 * The docs for this can be found in `mailapi/wakelocks.js`.
 *
 * This file runs on the main thread, receiving messages sent from a
 * SmartWakeLock instance -> through the router -> to this file.
 */
define(function () {
  'use strict';

  var nextId = 1;
  var locks = new Map();

  function requestWakeLock(type) {
    var lock;
    if (navigator.requestWakeLock) {
      lock = navigator.requestWakeLock(type);
    }
    var id = nextId++;
    locks.set(id, lock);
    return id;
  }

  var self = {
    name: 'wakelocks',
    sendMessage: null,
    process: function (uid, cmd, args) {
      switch (cmd) {
        case 'requestWakeLock':
          var type = args[0];
          self.sendMessage(uid, cmd, [requestWakeLock(type)]);
          break;
        case 'unlock':
          var id = args[0];
          var lock = locks.get(id);
          if (lock) {
            lock.unlock();
            locks.delete(id);
          }
          self.sendMessage(uid, cmd, []);
          break;
        default:
          break;
      }
    },

    // Expose the request method locally so that cronsync-main can acquire a
    // wake-lock to hand off to the back-end.
    requestWakeLock
  };
  return self;
});
