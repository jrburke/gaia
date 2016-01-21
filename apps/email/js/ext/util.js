/**
 *
 **/

define(['exports', 'evt'], function (exports, evt) {
  'use strict';

  /**
   * Header info comparator that orders messages in order of numerically
   * decreasing date and UIDs.  So new messages come before old messages,
   * and messages with higher UIDs (newer-ish) before those with lower UIDs
   * (when the date is the same.)
   */
  exports.cmpHeaderYoungToOld = function cmpHeaderYoungToOld(a, b) {
    var delta = b.date - a.date;
    if (delta) {
      return delta;
    }
    // favor larger UIDs because they are newer-ish.
    return b.id - a.id;
  };

  /**
   * Perform a binary search on an array to find the correct insertion point
   *  in the array for an item.  From deuxdrop; tested in
   *  deuxdrop's `unit-simple-algos.js` test.
   *
   * @return[Number]{
   *   The correct insertion point in the array, thereby falling in the inclusive
   *   range [0, arr.length].
   * }
   */
  exports.bsearchForInsert = function bsearchForInsert(list, seekVal, cmpfunc) {
    if (!list.length) {
      return 0;
    }
    var low = 0,
        high = list.length - 1,
        mid,
        cmpval;
    while (low <= high) {
      mid = low + Math.floor((high - low) / 2);
      cmpval = cmpfunc(seekVal, list[mid]);
      if (cmpval < 0) {
        high = mid - 1;
      } else if (cmpval > 0) {
        low = mid + 1;
      } else {
        break;
      }
    }
    if (cmpval < 0) {
      return mid; // insertion is displacing, so use mid outright.
    } else if (cmpval > 0) {
        return mid + 1;
      } else {
        return mid;
      }
  };

  exports.bsearchMaybeExists = function bsearchMaybeExists(list, seekVal, cmpfunc, aLow, aHigh) {
    var low = aLow === undefined ? 0 : aLow,
        high = aHigh === undefined ? list.length - 1 : aHigh,
        mid,
        cmpval;
    while (low <= high) {
      mid = low + Math.floor((high - low) / 2);
      cmpval = cmpfunc(seekVal, list[mid]);
      if (cmpval < 0) {
        high = mid - 1;
      } else if (cmpval > 0) {
        low = mid + 1;
      } else {
        return mid;
      }
    }
    return null;
  };

  exports.formatAddresses = function (nameAddrPairs) {
    var addrstrings = [];
    for (var i = 0; i < nameAddrPairs.length; i++) {
      var pair = nameAddrPairs[i];
      // support lazy people providing only an e-mail... or very careful
      // people who are sure they formatted things correctly.
      if (typeof pair === 'string') {
        addrstrings.push(pair);
      } else if (!pair.name) {
        addrstrings.push(pair.address);
      } else {
        addrstrings.push('"' + pair.name.replace(/["']/g, '') + '" <' + pair.address + '>');
      }
    }

    return addrstrings.join(', ');
  };

  /**
   * Monkeypatch the given object to add a pseudo-EventTarget interface,
   * i.e. 'addEventListener' and 'removeEventListener'. This was added to make
   * it easier to work with mozTCPSocket, which does not currently inherit
   * from EventEmitter per <https://bugzil.la/882123>.
   */
  exports.makeEventTarget = function makeEventTarget(obj) {
    if (!obj.addEventListener) {
      var emitter = new evt.Emitter();
      obj.addEventListener = function (type, fn) {
        var onType = 'on' + type;
        if (!obj[onType]) {
          obj[onType] = function (evt) {
            emitter.emit(type, evt);
          };
        }
        emitter.on(type, fn);
      };
      obj.removeEventListener = function (type, fn) {
        emitter.removeListener(type, fn);
      };
    }
    return obj;
  };

  /**
   * Concatenate multiple ArrayBuffers, returning the result.
   */
  exports.concatBuffers = function () {
    var totalLength = 0;
    for (var i = 0; i < arguments.length; i++) {
      totalLength += arguments[i].byteLength;
    }
    var buffer = new Uint8Array(totalLength);
    for (var i = 0, offset = 0; i < arguments.length; i++) {
      buffer.set(arguments[i], offset);
      offset += arguments[i].byteLength;
    }
    return buffer;
  };

  /**
   * Strip surrounding angle brackets from the given string/array.
   * If null, return null.
   */
  exports.stripArrows = function (s) {
    if (Array.isArray(s)) {
      return s.map(exports.stripArrows);
    } else if (s && s[0] === '<') {
      return s.slice(1, -1);
    } else {
      return s;
    }
  };

  /**
   * Ridiculously simple shallow clone operation that just directly propagates the
   * keys/values of a simple data-only JS object with only Object.prototype in
   * its prototype chain.
   */
  exports.shallowClone = function (sourceObj) {
    var destObj = {};
    for (var key in sourceObj) {
      destObj[key] = sourceObj[key];
    }
    return destObj;
  };
}); // end define
