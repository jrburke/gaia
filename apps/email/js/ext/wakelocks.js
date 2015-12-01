define(function (require) {
  'use strict';

  const logic = require('logic');

  const $router = require('./worker-router');
  const sendWakeLockMessage = $router.registerCallbackType('wakelocks');

  /**
   * SmartWakeLock: A renewable, failsafe Wake Lock manager.
   *
   * Example:
   *   var lock = new SmartWakeLock({ locks: ['cpu', 'screen'] });
   *   // do things; if we do nothing, the lock expires eventually.
   *   lock.renew(); // Keep the lock around for a while longer.
   *   // Some time later...
   *   lock.unlock();
   *
   * Grab a set of wake locks, holding on to them until either a
   * failsafe timeout expires, or you release them.
   *
   * @param {int} opts.timeout
   *   Timeout, in millseconds, to hold the lock if you fail to call
   *   .unlock().
   * @param {String[]} opts.locks
   *   Array of strings, e.g. ['cpu', 'wifi'], representing the locks
   *   you wish to acquire.
   * @param {Function} [opts.imminentDoomHandler]
   *   A function you can provide that we'll call when the timeout occurs.
   *   We'll invoke it immediately prior to performing the unlock so that you
   *   can front-run our removal of the wake-lock.  You can also clobber this
   *   onto us later on or clear it.
   */
  function SmartWakeLock(opts) {
    var _this = this;

    logic.defineScope(this, 'SmartWakeLock', { types: opts.locks });

    var locks = this.locks = {}; // map of lockType -> wakeLockInstance
    this.timeoutMs = opts.timeout || SmartWakeLock.DEFAULT_TIMEOUT_MS;
    this._timeout = null; // The ID returned from our setTimeout.
    this.imminentDoomHandler = opts.imminentDoomHandler || null;

    // magic path for use by wrapMainThreadAcquiredWakelock ONLY
    if (opts.__existingLockId) {
      this.locks[opts.locks[0]] = opts.__existingLockId;
      logic(this, 'reusedMainthreadLock');
      this._readyPromise = Promise.resolve();
      this.renew(); // start the clock ticking!
      return;
    }

    // Since we have to fling things over the bridge, requesting a
    // wake lock here is asynchronous. Using a Promise to track when
    // we've successfully acquired the locks (and blocking on it in
    // the methods on this class) ensures that folks can ignore the
    // ugly asynchronous parts and not worry about when things happen
    // under the hood.
    logic(this, 'requestLock', { durationMs: this.timeoutMs });
    this._readyPromise = Promise.all(opts.locks.map(function (type) {
      return sendWakeLockMessage('requestWakeLock', [type]).then(function (lockId) {
        locks[type] = lockId;
      });
    })).then(function () {
      logic(_this, 'locked', {});
      // For simplicity of implementation, we reuse the `renew` method
      // here to add the initial `opts.timeout` to the unlock clock.
      _this.renew(); // Start the initial timeout.
    });
  }

  SmartWakeLock.DEFAULT_TIMEOUT_MS = 45000;

  SmartWakeLock.prototype = {
    /**
     * Renew the timeout, if you're certain that you still need to hold
     * the locks longer.
     */
    renew: function ( /* optional */reason) {
      var _this2 = this;

      // Wait until we've successfully acquired the wakelocks, then...
      return this._readyPromise.then(function () {
        // If we've already set a timeout, we'll clear that first.
        // (Otherwise, we're just loading time on for the first time,
        // and don't need to clear or log anything.)
        if (_this2._timeout) {
          clearTimeout(_this2._timeout);
          logic(_this2, 'renew', {
            reason,
            renewDurationMs: _this2.timeoutMs,
            durationLeftMs: _this2.timeoutMs - (Date.now() - _this2._timeLastRenewed)
          });
        }

        _this2._timeLastRenewed = Date.now(); // Solely for debugging.

        _this2._timeout = setTimeout(function () {
          logic(_this2, 'timeoutUnlock');
          if (_this2.imminentDoomHandler) {
            try {
              // doomity doom doom!
              _this2.imminentDoomHandler();
            } catch (ex) {
              // do nothing, we just don't want to fail to unlock the wakelock.
            }
          }
          _this2.unlock('timeout');
        }, _this2.timeoutMs);
      });
    },

    /**
     * Unlock all the locks. This happens asynchronously behind the
     * scenes; if you want to block on completion, hook onto the
     * Promise returned from this function.
     */
    unlock: function ( /* optional */reason) {
      var _this3 = this;

      // Make sure weve been locked before we try to unlock. Also,
      // return the promise, throughout the chain of calls here, so
      // that listeners can listen for completion if they need to.
      return this._readyPromise.then(function () {
        var locks = _this3.locks;
        _this3.locks = {}; // Clear the locks.
        clearTimeout(_this3._timeout);
        _this3._timeout = null;

        logic(_this3, 'unlock', { reason });
        // Wait for all of them to successfully unlock.
        return Promise.all(Object.keys(locks).map(function (type) {
          return sendWakeLockMessage('unlock', [locks[type]], function () {
            return type;
          });
        })).then(function () {
          logic(_this3, 'unlocked', { reason });
        });
      });
    },

    toString: function () {
      return Object.keys(this.locks).join('+') || '(no locks)';
    }
  };

  /**
   * If your main-thread helper called wakelocks-main.js's requestWakeLock
   * method and handed you the id, this is where you convert that id into your
   * very own `SmartWakeLock` just like you had new'ed it.
   *
   * This method exists to make things very explicit and to avoid the subtle
   * breakage that might occur if our contract was to use a dictionary arg
   * (which can get typo'd or missed in a renaming pass, etc.).
   */
  function wrapMainThreadAcquiredWakelock({ wakelockId, timeout,
    imminentDoomHandler }) {
    return new SmartWakeLock({
      locks: ['mainthread-acquired'],
      timeout,
      imminentDoomHandler,
      __existingLockId: wakelockId
    });
  }

  return {
    SmartWakeLock,
    wrapMainThreadAcquiredWakelock
  };
});
